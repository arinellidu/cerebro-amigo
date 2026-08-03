# ADR-003: Agentes analíticos em Python sem LangGraph

**Status:** Accepted
**Data:** 2026-05-21
**Decisores:** Equipe de engenharia
**Categoria:** Stack

## Contexto

Além da camada conversacional síncrona (paciente ↔ sistema, ver ADR-002),
o produto tem **agentes analíticos** que rodam em background:

- **`resumo_pre_consulta`** — gera resumo do paciente antes de cada consulta.
- **`adesao`** — analisa padrão de adesão à medicação.
- **`padroes`** — busca mudanças longitudinais em sintomas e relatos.
- **`diario`** — sumariza diário textual do paciente.
- **`risco_silencioso`** — detecta ausência súbita de contato + marcadores
  configuráveis (sinal de retraimento clínico).

Estes agentes têm padrão estrutural diferente do grafo conversacional:

- **Não são conversacionais.** Não há sequência de turnos com paciente; é
  varredura periódica de dados.
- **Tipicamente uma ou duas chamadas LLM por execução**, não uma cadeia
  de 4-5 chamadas como no grafo conversacional.
- **Sem necessidade de checkpoint resumível.** Se falhar no meio, basta
  rodar de novo no próximo tick — não há paciente esperando resposta.
- **Sem streaming.** Output é um insight persistido no DB, lido depois
  pela psiquiatra no dashboard.
- **Sem ramos condicionais complexos.** Carregar contexto → chamar LLM
  → estruturar output → persistir. Pipeline linear.

A natureza desses agentes é mais próxima de "ETL com chamada LLM no meio"
do que de "máquina de estado conversacional".

## Decisão

**Implementar os 5 agentes analíticos em Python "vanilla" (FastAPI +
APScheduler + asyncpg + ChatAnthropic + Pydantic), sem LangGraph.**

Concretamente:
- Serviço `apps/agents-py/` separado do `apps/orchestrator-py/`.
- Classe base `BaseAgent` define o contrato (`find_pending()`, `execute()`)
  e cuida automaticamente de trilha de execução (`agente_execucoes`),
  persistência em `insights` e dedup window por paciente.
- Cada agente concreto herda de `BaseAgent`, implementa os dois métodos.
- LLM via `ChatAnthropic` com `with_structured_output(SchemaPydantic)`.
- APScheduler dispara ticks periódicos; também há endpoints HTTP manuais
  para disparo sob demanda (psiquiatra clica "regenerar" no dashboard).

## Alternativas consideradas

### Alternativa A — Usar LangGraph para tudo (incluindo agentes analíticos)

**Argumento a favor:**

1. **Consistência arquitetural.** Mesmo framework em toda a camada de IA.
2. **Tracing uniforme.** LangSmith captura igual em ambos os contextos.
3. **Reuso de utilitários.** Schemas, prompts, factory de LLM compartilhados.

**Por que rejeitamos:**

1. **Overengineering para o caso de uso.** Cada agente é tipicamente uma
   ou duas chamadas LLM. Modelar como grafo com nós formais introduz
   verbosidade sem benefício — `find_pending` + `execute` é mais legível
   que `StateGraph` + `add_node` + `add_edge` para um pipeline linear.

2. **Custo de manutenção.** Mais dependências, mais surface area de
   framework. Em código que vai rodar sem supervisão (cron), simplicidade
   é virtude.

3. **Tracing já funciona sem LangGraph.** LangChain `ChatAnthropic`
   instrumenta chamadas automaticamente via callbacks. LangSmith pega
   tudo igual.

4. **Checkpointer Postgres do LangGraph é desperdiçado.** Para jobs cron
   sem turnos, checkpoint resumível não agrega — basta tratar falha como
   "tenta de novo no próximo tick" e marcar como `sucesso=false` em
   `agente_execucoes`.

### Alternativa B — Reusar tudo num único serviço (agents dentro do
orchestrator-py)

**Argumento a favor:**

1. Menos containers, menos configuração de deploy.
2. Pool de conexão DB compartilhado.

**Por que rejeitamos:**

1. **Mistura tipos de carga incompatíveis.** Orchestrator atende
   requests HTTP do paciente (latência crítica, baixa CPU). Agentes
   rodam jobs em background que podem consumir CPU sustained durante
   análise. Misturar afeta SLO do conversational.

2. **Escala diferente.** Orchestrator escala horizontal (várias réplicas
   atendendo SSE concorrente). Agentes escalam verticalmente (um vagão
   processando jobs em lote por tick). Containers separados permitem
   estratégias de escala diferentes em Azure Container Apps.

3. **Deploy independente.** Quero subir versão nova de agente sem
   reiniciar conexões SSE de pacientes ativos.

### Alternativa C — Manter agents em Go (não migrar)

**Argumento a favor:** Sunk cost — já existem 5 agentes em
`apps/agents/`.

**Por que rejeitamos:**

1. Os agentes precisam evoluir prompts, schemas e estratégias de extração
   conforme aprendemos clinicamente. Ecosystem Python (pandas, scipy
   para padrões longitudinais; pgvector + embeddings para similaridade
   de relatos) é dramaticamente melhor para esse tipo de trabalho do
   que Go.

2. Consistência com ADR-002: se a camada conversacional é Python, manter
   agents em Go duplica linguagem só para essa camada com pouco
   benefício.

3. Custo de migração é baixo — cada agente em Go atual é ~200-400 linhas;
   reescrever em Python com `BaseAgent` é ~100-150 linhas por agente
   (a base absorve o boilerplate).

### Alternativa D — Migrar em ritmo diferente

**Argumento a favor:** Manter Go até agente novo precisar ser adicionado,
aí escrever só novos em Python.

**Por que rejeitamos:**

1. Cria stack heterogêneo internamente nos agentes (alguns Go, alguns
   Python) sem motivo clínico. Pior que migrar todos.

2. A migração já está parcialmente decidida (orchestrator-py existe).
   Adicionar agents-py imediatamente prova o padrão `BaseAgent` antes
   dos próximos agentes serem implementados.

## Consequências aceitas

1. **Dois serviços Python no docker-compose** (`orchestrator-py` e
   `agents-py`). Cada um com seu Dockerfile, seu lifespan, sua
   configuração. Aceitável — não compete por recursos.

2. **Código compartilhado é duplicado entre os dois serviços** (config
   tipada, observability/PII, factory LLM). Ambos têm versões próprias.
   Duplicação aceita porque manter biblioteca interna versionada
   compartilhada introduz coordenação que não se paga nessa escala.

3. **Se um agente futuro precisar de máquina de estado** (ex.: agente
   que faz múltiplas iterações com tool use), pode migrar para LangGraph
   sem afetar os outros — `BaseAgent` é interface, implementação interna
   pode variar.

4. **APScheduler é in-process.** Se o container reinicia, o tick atual
   se perde. Mitigação: ticks são curtos (segundos), próximos varrem
   pendentes. Pacientes não percebem.

5. **Não há fila distribuída** (Celery/RQ/Redis). Aceitável até escala
   onde múltiplas réplicas paralelas processarem o mesmo agente. Quando
   chegarmos lá, o `find_pending()` precisará de locking ou
   `SELECT FOR UPDATE SKIP LOCKED` em Postgres — fácil de adicionar.

## Gatilhos de revisão

- **Algum agente passar a precisar de máquina de estado complexa.**
  Sinais: agentic loop, tool use múltiplo, recovery resumível.
  Nesse caso, esse agente específico migra para LangGraph.

- **APScheduler in-process tornar-se gargalo.** Sinais: ticks atrasando,
  ou múltiplas réplicas necessárias por volume → migrar para Celery
  beat + workers ou Azure Container Apps Jobs cron-trigger.

- **Pandas/scipy não bastarem para análise longitudinal.** Improvável,
  mas se algum agente precisar de ML sério (clustering, forecasting),
  isso muda a fronteira do agente — não a decisão Python vs LangGraph.

- **Volume de agentes crescer muito** (de 5 para 20+). Aí vale considerar
  framework de plugins com discovery automático em vez do registry
  manual em `AGENT_REGISTRY`.

## Referências

- ADR-002: a camada conversacional usa LangGraph (motivos detalhados lá).
- ADR-004: tratamento de LGPD em traces — aplica a ambos os serviços.
