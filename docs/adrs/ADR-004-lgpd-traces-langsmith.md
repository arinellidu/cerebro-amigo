# ADR-004: Tratamento de LGPD em traces de LangSmith

**Status:** Accepted
**Data:** 2026-05-21
**Decisores:** Equipe de engenharia + responsável clínico + DPO
**Categoria:** Compliance

## Contexto

LangSmith é a plataforma de observabilidade utilizada para tracing das
chamadas LLM (ver ADR-002 e ADR-003). Por design, LangSmith captura:

- Prompts completos enviados ao modelo
- Outputs completos retornados pelo modelo
- Metadata da execução (modelo, temperatura, latência, tokens)
- Estrutura hierárquica de chamadas aninhadas

No Cérebro Amigo, isso significa que mensagens textuais de pacientes com
sofrimento psíquico, classificações de crise, sintomas extraídos, e
respostas geradas passam pelos servidores do LangSmith hospedado
(SaaS da LangChain Inc., infraestrutura nos EUA).

A LGPD trata **dados de saúde** como **categoria especial** (art. 11),
exigindo bases legais específicas (em geral consentimento expresso e
explícito) e tratamento com **maior rigor de minimização e segurança**.
Saúde mental é especialmente sensível: estigmatização social, impacto
ocupacional, e relação privilegiada médico-paciente (sigilo profissional
do médico, art. 154 CP).

Sem tratamento específico, o uso default do LangSmith implica:

- Transferência internacional de dados pessoais sensíveis (BR → US).
- Armazenamento por terceiro fora da cadeia direta de responsabilidade
  do controlador (a psiquiatra titular da conta).
- Risco de exposição em incidente de segurança no fornecedor.
- Dependência do compromisso de privacidade do fornecedor (cláusulas
  contratuais, termos de uso) que podem mudar.

## Decisão

**Adotar uma estratégia de tratamento em camadas (defense-in-depth), com
escolha do nível de proteção definida por ambiente:**

### Camada 1 (sempre ativa) — Redação de PII brasileiras

`PII_REDACTION_ENABLED=true` ativa callbacks `hide_inputs` e `hide_outputs`
no cliente LangSmith. Antes de qualquer trace ser enviado, regex
conservadoras substituem:

- CPF (com ou sem pontuação) → `[CPF_REDACTED]`
- CNPJ → `[CNPJ_REDACTED]`
- Email → `[EMAIL_REDACTED]`
- Telefone brasileiro (DDD + celular/fixo) → `[PHONE_REDACTED]`
- Datas no formato dd/mm/aaaa → `[DATE_REDACTED]`

Isto **não é** anonimização completa — texto livre de paciente com seu
nome, contexto pessoal, e narrativa clínica permanece. Mas reduz a
exposição de identificadores diretos.

### Camada 2 (produção) — Ocultação total de inputs/outputs

`LANGSMITH_HIDE_INPUTS=true` e `LANGSMITH_HIDE_OUTPUTS=true` fazem com
que o LangSmith receba apenas metadata estrutural (modelo, latência,
tokens, tags, hierarquia de chamadas) — sem o conteúdo dos prompts ou
das respostas.

Trade-off: debug de qualidade de modelo fica mais difícil (não dá para
ver o prompt que produziu output ruim). Aceitamos esta limitação em
produção real com pacientes verdadeiros.

### Camada 3 (recomendada para escala maior) — LangSmith self-hosted

LangSmith oferece deploy self-hosted no plano Enterprise. Quando o
produto atingir escala que justifique (custo do plano), migrar para
self-hosted **dentro da mesma região e tenancy controlada pela
organização**, eliminando transferência internacional.

### Configuração por ambiente

| Ambiente | Camada 1 | Camada 2 | Camada 3 |
|---|---|---|---|
| **Development** (dados sintéticos ou de teste) | Sim | Não | N/A |
| **Staging** (dados sintéticos) | Sim | Não | N/A |
| **Production** (dados reais de paciente) | Sim | **Sim** | Recomendado quando viável |

Em produção, mesmo com hide_inputs/outputs ligados, o LangSmith ainda é
útil — métricas de latência, custo, falhas e estrutura de execução fluem
normalmente. O que se perde é o conteúdo textual para inspeção
qualitativa.

### Documentação no RIPD/DPIA

Esta decisão é documentada no Relatório de Impacto à Proteção de Dados
(RIPD) do produto, com:

- Finalidade do tratamento (observabilidade técnica de IA).
- Base legal (consentimento expresso do paciente nos termos de uso,
  vinculado a `clientes.contexto.consentimento`).
- Minimização aplicada (Camadas 1 + 2 em produção).
- Medidas de segurança (criptografia em trânsito, chave de API rotacionada,
  controle de acesso ao LangSmith por equipe restrita).
- Transferência internacional declarada com base nas garantias
  contratuais do fornecedor + minimização aplicada.

## Alternativas consideradas

### Alternativa A — Não usar tracing LLM em produção

**Argumento a favor:** Elimina totalmente a transferência internacional
e a exposição de dados sensíveis a terceiro.

**Por que rejeitamos:**

1. **Cego para problemas de qualidade.** Sem tracing, não conseguimos
   diagnosticar regressões na detecção de crise, deriva de modelo, ou
   problemas em produção.

2. **Bloqueia evolução do produto.** Sem dataset de evals, melhoria de
   prompts vira tentativa e erro.

3. **Conflita com responsabilidade clínica.** Sem evidência observável
   de como a IA está se comportando, fica mais difícil para a
   psiquiatra avaliar a ferramenta.

A Camada 2 (hide_inputs/outputs) já mitiga substancialmente o risco e
preserva métricas úteis.

### Alternativa B — Tracing alternativo self-hosted desde o início

Opções: Langfuse self-hosted, Phoenix (Arize) self-hosted, OpenTelemetry
genérico.

**Por que rejeitamos para a versão inicial:**

1. **Custo operacional.** Self-hosting de plataforma de observabilidade
   adiciona infra (Postgres dedicado, storage, monitoramento desse
   serviço também). Justifica em produção em escala, não em early stage.

2. **Maturidade.** LangSmith integra nativamente com LangChain/LangGraph.
   Alternativas exigem mais glue code e oferecem menos features
   (especialmente datasets de evals, prompt registry).

3. **Não é decisão final.** A Camada 3 da decisão acima prevê migração
   para self-hosted quando justificado.

### Alternativa C — Anonimização aggressive (NER + remoção semântica)

**Argumento a favor:** Mais robusto que regex — pega nomes, locais,
relações familiares que regex não capturam.

**Por que rejeitamos para a versão inicial:**

1. **Custo de implementação alto.** NER em português brasileiro
   requer modelo dedicado (BERTimbau ou spaCy pt_core_news_lg) com
   pipeline de inferência local antes de enviar trace. Latência
   extra por chamada.

2. **Falsos positivos quebram debug.** NER agressivo redige até nomes
   de medicamentos como nome próprio, tornando traces ilegíveis.

3. **Camada 2 (hide_inputs/outputs) é mais efetiva para o mesmo
   problema** — se o conteúdo nem é enviado, não importa o quanto seria
   anonimizado.

A NER pode ser adicionada como Camada 1.5 num futuro se Camada 2
sozinha for vista como excessivamente cega.

## Consequências aceitas

1. **Debug em produção é mais difícil que em dev.** Time precisa
   reproduzir issues localmente com dados sintéticos. Aceitamos.

2. **Datasets de eval só com dados sintéticos ou anonimizados.**
   Não podemos exportar conversas reais do LangSmith para criar dataset
   (pois em produção elas nem foram enviadas inteiras). Datasets
   precisam ser construídos a partir de casos sintéticos curados pela
   psiquiatra. Aceitamos — é a forma correta de fazer evals em
   produto clínico.

3. **A redação de PII (Camada 1) é defense-in-depth, não substituto.**
   Em produção, Camada 2 é obrigatória. Camada 1 protege em caso de
   incidente onde Camada 2 falhe por configuração.

4. **Custos atribuídos por modelo seguem expostos** (são metadata, não
   conteúdo). LangSmith continua útil para análise de cost-per-patient,
   cost-per-feature, e tendências.

5. **Dependência de Anthropic permanece.** A própria Anthropic recebe
   prompts e outputs. Isto é tratado separadamente nos termos de uso
   do produto e nas garantias contratuais da Anthropic (que tem
   compromissos próprios de não-treinamento sobre dados de cliente).

## Gatilhos de revisão

- **Incidente de segurança no LangSmith** (vazamento, comprometimento
  de credenciais). Trigger imediato para revisar e potencialmente
  acelerar Camada 3.

- **Mudança nos termos de privacidade do LangSmith** (especialmente
  qualquer cláusula sobre uso de dados de cliente para treinamento ou
  análise agregada).

- **Atualização da LGPD ou regulação da ANPD** sobre transferência
  internacional de dados de saúde, ou sobre IA em saúde
  especificamente.

- **Auditoria regulatória ou de M&A** apontar a configuração atual
  como insuficiente.

- **Escala atingir nível em que self-hosted vale o custo** (heurística:
  100+ psiquiatras pagantes ou volume mensal de chamadas > 1M).

## Referências

- LGPD art. 11 (dados sensíveis): https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm
- LangSmith data handling: https://docs.smith.langchain.com/observability/concepts/data_handling
- ADR-002, ADR-003: contextualizam onde LangSmith é usado.
