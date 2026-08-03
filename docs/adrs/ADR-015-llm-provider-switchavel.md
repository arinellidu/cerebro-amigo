# ADR-015: Camada LLM provider-switchável (Anthropic API ⇄ Bedrock)

**Status:** Accepted
**Data:** 2026-06-01
**Decisores:** Patrick Arinelli, Adonai Arinelli
**Categoria:** Stack / Compliance
**Supersede:** [ADR-008](ADR-008-llm-bedrock-nao-anthropic-api.md) (Bedrock-only)
**Relaciona:** ADR-002 (IA em Python/LangGraph), ADR-004 (LGPD em traces)

## Contexto

O ADR-008 fixou "Bedrock-only" com a justificativa central de **residência de
dado no Brasil** (LGPD categoria especial): inferência via AWS Bedrock In-Region
`sa-east-1` manteria o dado no país, evitando transferência internacional.

Na prática essa premissa **não se concretiza**:

- Os model-ids que funcionam no Converse de `sa-east-1` são **perfis de
  inferência `global.`** (`global.anthropic.claude-*`). Perfis `global.`
  roteiam a requisição para a região com capacidade — **processam dados fora do
  Brasil**, sem garantia de residência.
- **Não existe** perfil in-region / Geo da América do Sul para esses modelos em
  `sa-east-1`. On-demand puro (`anthropic.*`) dá `ValidationException` no Converse.

Logo, **Anthropic API direta e Bedrock-global são equivalentes em residência**
(ambos processam fora do BR). O benefício que justificava Bedrock-only some, e
sobra o **custo operacional do Bedrock** neste estágio: quota zerada na conta
(ver `docs/aws-bedrock-quota-support-case.md`), Marketplace/perfis a configurar,
auth IAM. Esse custo não se paga enquanto a residência não é um diferencial real.

Quando o critério deixa de ser residência, ele vira **simplicidade** — e
simplicidade aponta para a API direta da Anthropic (uma env var + uma key,
sem quota/Marketplace/perfil/IAM para o caminho de inferência).

Ao mesmo tempo, há valor em **não jogar fora** o caminho Bedrock: um futuro
cliente pode exigir AWS-only (contrato, compliance interno do cliente). Manter
Bedrock atrás de uma flag preserva essa opção sem custo de manutenção divergente.

## Decisão

**Tornar a camada de acesso ao LLM provider-switchável por uma única env var
`LLM_PROVIDER` ∈ {`anthropic`, `bedrock`}, com `anthropic` como default
operacional.** Trocar de provider é mudança de configuração, não rewrite.

Concretamente (apenas a camada de transporte/cliente — prompts, thresholds
clínicos, lógica de grafo e de agentes **inalterados**):

- Enums `LLMProvider {ANTHROPIC, BEDROCK}` e `ModelTier {HAIKU, SONNET, OPUS}`.
- Factory `build_chat_model(tier, *, temperature, max_tokens)` que despacha pelo
  `LLM_PROVIDER` (lido 1× da config): `ChatAnthropic` (langchain-anthropic) ou
  `ChatBedrockConverse` (langchain-aws). Import do SDK é **lazy** — só o provider
  ativo precisa estar instalado. Os call-sites seguem chamando `haiku()` /
  `sonnet()` / `with_schema()` / `ainvoke_structured()` — não sabem qual provider
  está ativo.
- `resolve_model_id(provider, tier)` lê o id da config, sem mágica de string.

Mapeamento de modelos (exatos):

| Tier | Anthropic (`anthropic`) | Bedrock (`bedrock`) |
|---|---|---|
| HAIKU | `claude-haiku-4-5-20251001` | `global.anthropic.claude-haiku-4-5-20251001-v1:0` |
| SONNET | `claude-sonnet-4-6` | `global.anthropic.claude-sonnet-4-6` |
| OPUS | `claude-opus-4-8` | `global.anthropic.claude-opus-4-8` |

- **Auth fail-fast** (`@model_validator` no startup): `anthropic` exige
  `ANTHROPIC_API_KEY`; `bedrock` exige região AWS. App falha cedo com mensagem
  clara, nunca silenciosamente.
- **Custo provider-aware:** `pricing.py` com `PRICE_MAP[(provider, tier)]`
  ($/Mtoken) e `compute_cost(provider, model_id, tokens_in, tokens_out)`. A
  coluna `custo_usd` (em `mensagens` e `agente_execucoes`), que era **sempre
  NULL**, passa a ser preenchida com a estimativa do provider ativo.

### O que NÃO está nesta decisão

- **Gate diário de custo (`MAX_DAILY_LLM_USD`) não existe e não é construído
  aqui.** A variável estava só no `.env.example`, sem código que a lesse — nunca
  houve teto funcional. Construir um gate que **bloqueia chamadas** ao estourar
  orçamento gatearia a detecção de crise por custo (inaceitável) ou exigiria
  isenção explícita do caminho de crise — decisão clínica que merece ADR próprio.
  Este ADR só torna o **price map ciente de provider** e popula `custo_usd`;
  a agregação/enforcement fica para trabalho futuro.

## Alternativas consideradas

### A — Manter Bedrock-only (ADR-008)
Rejeitada: a residência LGPD que a justificava não se concretiza em `sa-east-1`
(perfis `global.` processam fora do BR). Resta só o custo operacional do Bedrock
sem o benefício.

### B — Trocar para Anthropic-only (remover Bedrock)
Rejeitada: jogaria fora a opção AWS-only para um futuro cliente que a exija. O
custo de manter o caminho Bedrock atrás de uma flag é baixo (factory + lazy
import); o de reintroduzi-lo depois, alto.

### C — Abstrair com `init_chat_model` (string mágica do LangChain)
Rejeitada: esconde a resolução de model-id e auth atrás de convenção de string,
dificultando o fail-fast e o price map por provider. A factory explícita é mais
auditável — requisito num sistema clínico.

## Consequências aceitas

1. **Default operacional muda para Anthropic API.** Produção passa a depender de
   `ANTHROPIC_API_KEY` (secret manager / env), não de IAM role, para inferência.
2. **Dado de inferência continua fora do BR** — igual ao Bedrock-global de hoje.
   Sem regressão de residência (não havia residência real a perder). O
   tratamento LGPD de traces (ADR-004, redação PII) permanece intacto.
3. **Nova dependência** `langchain-anthropic` nos dois serviços Python.
4. **`custo_usd` deixa de ser NULL.** Valores do `PRICE_MAP` são estimativas de
   list-price — confirmar nas páginas de preço antes de tratar como exato.
5. **Bedrock segue suportado** atrás de `LLM_PROVIDER=bedrock`; o caminho não
   pode ser quebrado em refactors futuros sem novo ADR.

## Invariantes preservadas (clinical-safety)

- **Streaming/SSE do caminho de crise** idêntico nos dois providers (LangChain
  normaliza chunks; o tradutor de eventos já tratava `content` `str|list`).
- **Redação de PII** (ADR-004) é hook de trace do LangSmith — provider-agnóstica;
  o refactor não cria caminho que a pule.
- **Protocolo de crise** com texto fixo (`crisis_copy.py`) e detecção fail-safe
  (ADR-006) inalterados — só o transporte do classificador muda.
- **Structured output** via `with_structured_output` funciona nos dois.

## Gatilhos de revisão

- **AWS publicar perfil in-region / Geo da América do Sul** para os modelos que
  usamos em `sa-east-1` (residência real no BR) → reavaliar default para Bedrock.
- **Cliente exigir AWS-only** → flipar `LLM_PROVIDER=bedrock` (já suportado).
- **Necessidade de teto de custo que bloqueie chamadas** → ADR próprio definindo
  o comportamento do caminho de crise sob estouro de orçamento.

## Referências

- ADR-008 (superseded): Bedrock In-Region, não ANTHROPIC_API_KEY.
- ADR-004: tratamento de LGPD em traces LangSmith.
- ADR-006: fail-safe do classificador de crise.
- `docs/aws-bedrock-quota-support-case.md`: quota Bedrock zerada na conta.
