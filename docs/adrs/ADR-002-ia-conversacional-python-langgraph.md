# ADR-002: IA conversacional em Python com LangGraph

**Status:** Accepted
**Data:** 2026-05-21
**Decisores:** Equipe de engenharia
**Categoria:** Stack

## Contexto

A camada conversacional do Cérebro Amigo é responsável pelo fluxo de mensagens
entre paciente (via PWA) e o sistema, com decisões em múltiplas etapas:

1. Carregamento de contexto (paciente, conversa aberta, check-in pendente)
2. **Detecção de crise** (classificação de risco de auto-extermínio, ideação,
   desesperança aguda)
3. **Protocolo de crise** (texto fixo pré-aprovado, sem geração por LLM)
4. Classificação de resposta a check-in de medicação
5. Atualização estruturada de tomada de medicação
6. Extração estruturada de sintomas (humor, ansiedade, sono, energia, etc.)
7. Geração de resposta empática ao paciente
8. **Auditoria pré-envio** (segunda passagem por LLM verificando se a
   resposta gerada respeita regras clínicas)
9. Persistência e envio (no caso da PWA, via Server-Sent Events streaming)

Esta camada é estruturalmente uma **máquina de estado conversacional com
múltiplos branches condicionais e chamadas LLM intercaladas**. Não é um
chatbot de uma chamada, e não é puro fluxo HTTP — é orquestração de
agente com estado persistente entre interações do paciente.

Há também requisitos atravessadores: tracing fim-a-fim das chamadas LLM
(custo, latência, prompt versionado, output), idempotência por mensagem,
checkpointing (resumir grafo após falha sem reprocessar nós já concluídos),
e streaming de tokens para a interface do paciente.

A implementação inicial era em Go (`apps/orchestrator/`). Esta ADR documenta
a decisão de **migrar essa camada para Python**, especificamente com
LangGraph como framework de orquestração.

## Decisão

**Implementar a camada de IA conversacional em Python (FastAPI + LangGraph),
com migração progressiva substituindo o orchestrator Go atual.**

Concretamente:
- Serviço `apps/orchestrator-py/` em FastAPI executa o grafo conversacional.
- LangGraph define nós (cada chamada LLM ou efeito) e edges condicionais.
- `AsyncPostgresSaver` (oficial do LangGraph) faz checkpointing na mesma DB
  Postgres do produto, em tabelas dedicadas (`checkpoints*`).
- LangSmith captura traces e métricas das chamadas LLM (com restrições
  detalhadas no ADR-004).
- O `apps/orchestrator/` em Go será desligado após validação em shadow
  mode (período em que ambos rodam paralelos para comparação) e cutover
  gradual por feature flag.

## Alternativas consideradas

### Alternativa A — Manter orchestrator em Go com bibliotecas LLM em Go

Esta foi a alternativa mais forte, e merece argumentação cuidadosa.

**Argumentos a favor de manter Go:**

1. **Já funciona em produção.** Sunk cost real. Migrar custa tempo e
   introduz risco.

2. **Go é melhor que Python em concorrência massiva I/O.** Goroutines vs
   asyncio: Go vence em throughput sustentado de webhooks/segundo. Embora
   o produto não tenha esse volume, é um argumento estrutural.

3. **Auditabilidade por código próprio.** Não depende de framework externo
   (LangGraph) que pode mudar comportamento entre versões, deprecar
   features, ou tornar debug indireto.

4. **Footprint menor.** Binário Go é ~30MB vs container Python ~200MB. Em
   escala de muitos containers Azure Container Apps, custo é diferente.

5. **Tipagem estática rígida sem custo de runtime.** Mais segurança contra
   regressões durante manutenção.

**Por que rejeitamos apesar desses argumentos:**

1. **O ecossistema LLM em Go é imaturo.** Não há equivalente Go a:
   LangGraph (orquestração de grafo), LangSmith (observability LLM
   first-class), Pydantic-based structured outputs com retries automáticos,
   Instructor/Outlines (constrained generation), DSPy (prompt optimization).
   Implementar cada um desses manualmente em Go consome tempo de engenharia
   que poderia estar focado em produto. Estimativa conservadora:
   3-4 semanas para replicar funcionalidades básicas que vêm de graça em
   Python, mais manutenção contínua.

2. **Estado-da-arte se move mais rápido em Python.** Padrões novos (agentic
   loops, multi-agent, RAG complexo, tool use) aparecem em Python primeiro
   e demoram para chegar em Go — quando chegam. Para produto que vai
   competir em qualidade clínica da IA, ficar atrás do estado-da-arte é
   risco competitivo.

3. **O argumento de concorrência não se aplica.** O Cérebro Amigo é
   limitado por throughput de Anthropic API (segundos por resposta), não
   por throughput do orquestrador. Goroutines vs asyncio é irrelevante
   nesta carga.

4. **Auditabilidade clínica vem da DB, não do código.** O que importa em
   auditoria regulatória é: qual prompt rodou, qual modelo, qual output,
   quando. Tudo isso está em `mensagens`, `protocolos_crise_acionados`,
   `agente_execucoes` — não no framework. LangGraph adicionar ou remover
   features não afeta a auditoria registrada no DB.

5. **Footprint não importa nesta escala.** Diferença de custo cloud é
   centavos por mês até escala muito maior que a esperada.

### Alternativa B — Python sem LangGraph (FastAPI + chamadas Anthropic diretas)

**Argumentos a favor:**

1. **Sem dependência de framework opaco.** Você escreve o switch/case
   explícito; cada decisão é visível no código próprio.

2. **Mais leve.** Sem camadas de abstração entre o seu código e a Anthropic
   API.

3. **Mais auditável teoricamente** — você controla todo o caminho do
   código.

**Por que rejeitamos para o caso conversacional (mas aceitamos para
agentes analíticos — ver ADR-003):**

1. **Checkpointing é trabalhoso de implementar corretamente.** Resumir
   um grafo após falha sem reprocessar passos custosos exige modelo de
   estado serializado, ID de thread para idempotência, tabela versionada.
   O `AsyncPostgresSaver` do LangGraph entrega isso testado e mantido.

2. **Streaming SSE com eventos por nó.** Emitir `event: node start/end` por
   passo do grafo + `event: token` do LLM exige instrumentação que o
   LangGraph faz via `astream_events(v2)`. Reimplementar é viável mas
   tedioso e propenso a bugs sutis.

3. **Edges condicionais explícitas.** O grafo conversacional tem ramos
   (crise → protocolo / medicação → update / geral → símtomas+resposta) e
   loops (audit → reescrever). Escrever isso como if/else funciona, mas
   o LangGraph oferece declaração de grafo que é mais legível e
   visualizável (`mermaid` diagram do grafo).

4. **Custo de manter.** Substituir LangGraph por código próprio significa
   manter ~500-1000 linhas adicionais. Bug de checkpointer custo seu;
   bug de LangGraph é fix da comunidade.

A Alternativa B é aceita para os **agentes analíticos** (ver ADR-003) que
são chamadas únicas de LLM sem máquina de estado conversacional.

### Alternativa C — Outro framework Python (DSPy, LlamaIndex, AutoGen)

**Argumentos contra:**

- **DSPy:** focado em otimização de prompts via meta-aprendizagem; não é
  framework de orquestração de fluxo conversacional. Útil para
  evals (pode ser reconsiderado depois), não substitui LangGraph.

- **LlamaIndex:** focado em RAG/data ingestion. Não cobre o caso de uso.

- **AutoGen (Microsoft):** focado em multi-agent conversational frameworks.
  Mais pesado, voltado para padrões de "vários LLMs conversando". Excessivo
  para nosso caso de uso atual.

LangGraph é o framework com melhor fit para "máquina de estado conversacional
com persistência" em Python hoje.

### Alternativa D — Híbrido: Go para orchestration core, Python para
chamadas LLM

**Argumento a favor:** Manter o core orchestration em Go (mais rápido,
mais estável) e chamar serviços Python via HTTP só para as chamadas LLM
específicas.

**Argumentos contra:**

1. **Acopla dois serviços por rede.** Cada nó do grafo vira RPC ida e
   volta. Latência cumulativa fica pior que ter tudo num processo.

2. **Estado distribuído.** Checkpointing entre Go e Python complica
   recovery e consistência.

3. **Duas implementações para manter.** Pior dos dois mundos.

## Consequências aceitas

1. **Dependência de framework externo.** LangGraph + LangChain são
   mantidos pela LangChain Inc. Risco: breaking changes, mudanças de
   licença, instabilidade. Mitigação: travar versões em pyproject.toml,
   ler changelog antes de upgrade, manter testes de regressão sobre os
   fluxos críticos (especialmente detecção de crise).

2. **Curva de aprendizado para a equipe.** Devs futuros precisam aprender
   LangGraph além de FastAPI. Estimativa: 2-3 dias para produtividade.
   Documentação oficial é boa.

3. **Logs de tracing detalhados.** LangSmith captura prompt + completion
   por chamada. Em saúde mental (LGPD categoria especial), isso exige
   tratamento cuidadoso — ver ADR-004.

4. **Não-determinismo aceito como característica do sistema.** LLMs com
   `temperature > 0` produzem outputs diferentes para a mesma entrada.
   Para o auditor (`temperature=0`) e classificador de crise
   (`temperature=0`), o sistema é mais determinístico mas não 100%.
   Auditoria deve refletir essa realidade — registrar input + modelo +
   versão de prompt permite reproduzir aproximadamente, não exatamente.

5. **Acoplamento ao Anthropic.** Os prompts e schemas são otimizados para
   Claude. Trocar de provider exigiria reajustes. Trade-off aceito por
   qualidade superior atual do Claude em PT-BR clínico.

## Gatilhos de revisão

Esta decisão deveria ser reavaliada se:

- **LangGraph adotar mudança disruptiva** (rewrite incompatível,
  abandono do checkpointer Postgres, mudança de licença para não-OSS).

- **Latência ponta-a-ponta exceder limites toleráveis para UX clínica**
  (objetivo: p95 < 8s; gatilho de revisão: p95 sustentado > 12s sem
  causa atribuível a LLM).

- **Bug de framework causar incidente de segurança clínica** (ex.: o
  checkpointer perder estado em momento crítico, causando duplicação
  de protocolo de crise ou perda de mensagem).

- **A comunidade Go alcançar paridade de ferramentas LLM** (improvável
  no curto prazo, mas vale monitorar).

- **A equipe sofrer rotatividade que tire competência Python sustentada.**

- **Volume de mensagens crescer 1000x** e o argumento de concorrência
  passar a importar (cenário: integração com EHR hospitalar streaming).

## Resposta a uma posição alternativa registrada

Foi sugerido externamente (por outro assistente de IA consultado): "invista
no Go orchestrator que você já tem; LangGraph está na moda; é abstração
pesada e opaca para sistema que exige transparência médica e auditabilidade".

Resposta documentada:

- O argumento de transparência confunde "código fonte próprio" com
  "auditabilidade clínica". Auditabilidade vem do que o sistema registra
  no DB (prompts, modelos, outputs, timestamps), não da origem do código
  que orquestra. Tanto LangGraph quanto código próprio podem ser
  auditáveis ou não dependendo do design de logging.

- "Moda" é caracterização imprecisa: LangGraph é a convergência
  da indústria para orquestração de IA em Python (2024-2026), usado por
  Anthropic, OpenAI cookbooks, e startups de IA clínica como Hippocratic
  AI. Estado-da-arte, não trend passageiro.

- "Pesada e opaca" é matéria de grau. O grafo é declarado em ~150 linhas
  legíveis (`graph.py`). Alternativa em Go puro estimada em 800-1200
  linhas. "Pesado" é o que precisa ser mantido pela equipe, não as
  dependências externas estáveis.

- "Sunk cost" do Go é argumento válido para velocidade da migração (não
  precisa ser imediata) mas não para direção final.

## Referências

- ADR-001: backend transacional em .NET — separação de responsabilidades.
- ADR-003: agentes analíticos em Python sem LangGraph — onde o framework
  não se justifica.
- ADR-004: tratamento de LGPD em traces de LangSmith.
- LangGraph docs: https://langchain-ai.github.io/langgraph/
