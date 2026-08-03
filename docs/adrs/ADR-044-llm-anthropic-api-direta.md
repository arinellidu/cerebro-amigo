# ADR-044: LLM via Anthropic API direta (vigente) — Bedrock suspenso por não-aprovação da AWS

**Status:** Accepted (formaliza decisão já em produção — ver nota de formalização no fim)
**Data:** 2026-06-13
**Decisores:** Patrick Arinelli, Adonai Arinelli
**Categoria:** Stack / Compliance / Operação
**Complementa:** [ADR-015](ADR-015-llm-provider-switchavel.md) (camada provider-switchável)
**Mantém suspenso:** [ADR-008](ADR-008-llm-bedrock-nao-anthropic-api.md) (Bedrock-only — já *superseded* pelo ADR-015)
**Relaciona:** ADR-002 (IA em Python/LangGraph), ADR-004 (LGPD em traces), ADR-018 (cifragem em repouso), ADR-028 (RAG/embeddings Bedrock in-region), ADR-045/052 (infra e isolamento do Check-up), ADR-048 (escalas — entrada estruturada), ADR-050 (Check-up longitudinal)

## Contexto

O [ADR-015](ADR-015-llm-provider-switchavel.md) tornou a camada de acesso ao LLM
**provider-switchável** (`LLM_PROVIDER` ∈ {`anthropic`, `bedrock`}), com `anthropic`
como default, *supersedendo* o ADR-008 (Bedrock-only). A justificativa foi dupla:
a residência LGPD que motivava o Bedrock-in-region **não se concretiza** em
`sa-east-1` (os model-ids que funcionam no Converse são perfis `global.`, que
processam fora do BR) e, sem o benefício de residência, vence a **simplicidade**
da API direta.

Desde então, dois fatos consolidaram a API direta como **vigente** — não apenas um
default de conveniência, mas o único caminho operável hoje:

1. **A AWS não aprovou o acesso aos modelos Anthropic no Bedrock** para esta conta:
   a quota on-demand está zerada e o caminho via Marketplace/perfis não foi liberado
   (ver `docs/aws-bedrock-quota-support-case.md`). O caminho `bedrock` está, portanto,
   **factualmente indisponível** — não é só preterido; não dá para ligar.
2. O lançamento do **Check-up Mental** (`apps/checkup`, superfície pública anônima)
   introduziu uma **segunda** chamada de LLM, fora dos serviços Python clínicos — os
   Route Handlers do próprio app chamando a Anthropic API para a devolutiva da triagem.
   Isso precisa ser registrado e cercado, pois é exceção à regra "LLM só em Python".

O ADR-008 segue **suspenso**; o caminho `bedrock` permanece no código atrás de
`LLM_PROVIDER` para reativação futura por configuração, sem custo de manutenção
divergente (garantido pelo ADR-015).

## Decisão

1. **`LLM_PROVIDER=anthropic` é o provider vigente** em todos os serviços que falam
   com o LLM. A inferência clínica (orchestrator-py, agents-py) usa o client unificado
   (`ChatAnthropic` via factory `build_chat_model`; ADR-015). O caminho `bedrock`
   continua suportado e testado, porém **inativo** até a AWS aprovar o acesso **e** um
   novo ADR flipar o default.

2. **`ANTHROPIC_API_KEY` somente por ambiente** — SSM Parameter Store SecureString,
   injetada no deploy. **Nunca** em código, imagem ou log. (Reintroduz a key que o
   ADR-008 havia eliminado — ela volta a existir, mas exclusivamente via secret manager.)

3. **Modelos por env**, defaults na família `claude-*` atual: `ANTHROPIC_MODEL_HAIKU`
   (default de custo), `ANTHROPIC_MODEL_SONNET`, `ANTHROPIC_MODEL_OPUS`. O mapeamento
   exato por tier (e os equivalentes Bedrock reservados) vive no ADR-015 e na skill
   `python-ai-services`.

4. **Embeddings/RAG continuam no Bedrock in-region** (`cohere.embed-multilingual-v3`),
   **independentemente** do `LLM_PROVIDER` (ADR-028). Embedding nunca foi o objeto do
   ADR-008/015/044 e permanece in-region por LGPD. Este ADR trata só do LLM generativo.

## Exceção registrada: LLM no Check-up (apps/checkup)

- **Regra geral:** LLM nos fluxos clínicos só em Python, via client unificado; nunca do
  gateway nem do front clínico.
- **Exceção (a única):** o `apps/checkup` chama a Anthropic API **nos Route Handlers do
  próprio app** (server-side; **nunca** no client/browser), enviando **somente dados
  estruturados de triagem** (escala/escore/faixa) — **jamais** conteúdo clínico cru ou
  PII. O Check-up **não** passa pelo orchestrator (isolamento clínico ⇄ público,
  ADR-045/052).
- **Cercas:** entrada estruturada apenas; rate-limit por sessão nas rotas de LLM; spend
  limit no Console da Anthropic; **key própria** em workspace separado (CK-6, SSM
  `/cerebro-amigo/checkup/anthropic-api-key`); fallback estático em abuso/erro. **Não
  criar outras exceções.**

## Alternativas consideradas

### A — Ligar o Bedrock agora (o ADR-015 já o suporta)
Rejeitada: **impossível** no presente — acesso não aprovado pela AWS / quota zerada.

### B — Anthropic-only puro (remover o caminho Bedrock)
Rejeitada: jogaria fora a opção AWS-only de um futuro cliente que a exija. O custo de
manter o caminho atrás da flag é baixo (ADR-015, alternativa B); o de reintroduzi-lo, alto.

### C — Rotear o Check-up pelo orchestrator (reusar a única camada de LLM)
Rejeitada: violaria o **isolamento clínico ⇄ público**. O Check-up é superfície pública
anônima e não pode importar nem atravessar serviços clínicos. Uma exceção controlada
(entrada estruturada, key isolada, fallback estático) é mais segura que furar o isolamento.

## Consequências aceitas

1. **Produção depende de `ANTHROPIC_API_KEY`** (secret manager) para inferência, não de
   IAM role. (É o estado atual.)
2. **Dado de inferência continua fora do BR** — igual ao Bedrock-global. Sem regressão de
   residência (não havia residência real a perder; ADR-015). O tratamento LGPD de traces
   (ADR-004) e a minimização permanecem; com LLM em API externa, a minimização **vale
   dobrado** — nunca enviar identificadores diretos do paciente junto de conteúdo clínico.
3. **Duas superfícies chamam a Anthropic API:** serviços Python clínicos (key clínica) e
   Check-up (key própria isolada, CK-6). Contabilidade e limite de gasto separados.
4. **O caminho Bedrock segue suportado** atrás da flag e **não pode ser quebrado** em
   refactors sem novo ADR (herdado do ADR-015).

## Invariantes preservadas (clinical-safety)

- LLM **nunca** dá orientação clínica, diagnóstico ou ajuste de dose; só organiza/rascunha.
- Protocolo de crise fixo, texto **literal** de `crisis_copy.py` — nunca gerado por LLM.
  No Check-up vale o equivalente: tela de crise estática (`docs/CRISIS-PROTOCOL.md`).
- Minimização LGPD com LLM externo: nunca enviar identificadores diretos do paciente junto
  de conteúdo clínico. No Check-up, só dados estruturados de triagem.
- Médico no loop nos fluxos clínicos; trilhas de auditoria imutáveis intactas.
- Streaming/SSE, redação de PII e structured output são provider-agnósticos (ADR-015).

## Gatilhos de revisão

- **AWS aprovar o acesso aos modelos Anthropic no Bedrock** + publicar perfil in-region /
  Geo da América do Sul → reavaliar o default para `bedrock` (residência real no BR), por
  novo ADR.
- **Cliente exigir AWS-only** → flipar `LLM_PROVIDER=bedrock` (já suportado), após a
  aprovação da AWS.
- **Estender o teto de custo ao plano interativo** (hoje o ADR-011 só gateia o batch) →
  exige ADR próprio definindo o comportamento sob estouro: o caminho de detecção de crise
  **não** pode ser gateado por custo.

## Referências

- [ADR-015](ADR-015-llm-provider-switchavel.md) — camada provider-switchável; mapeamento de modelos.
- [ADR-008](ADR-008-llm-bedrock-nao-anthropic-api.md) — Bedrock In-Region (suspenso).
- ADR-004 (LGPD em traces) · ADR-018 (cifragem em repouso) · ADR-028 (RAG/embeddings Bedrock in-region).
- ADR-045/052 (infra e isolamento do Check-up) · ADR-048 (escalas; entrada estruturada) · ADR-050 (Check-up longitudinal).
- `docs/aws-bedrock-quota-support-case.md` — quota Bedrock zerada na conta.
- Skill `python-ai-services` + `references/bedrock-client.md` · `apps/checkup/CLAUDE.md`.

## Nota de formalização

Este ADR foi **redigido em 2026-06-13** para formalizar uma decisão **já vigente em
produção**: o rótulo "ADR-044" já era citado no `CLAUDE.md` e nos ADRs 045/046/048/050,
mas o arquivo estava **ausente**. O conteúdo foi reconstruído a partir dessas fontes, do
ADR-015 e do código (`config.py`, `conversation/llm.py`, `conversation/pricing.py`). **Não
há mudança de comportamento** — o documento descreve o estado atual e fecha a referência
pendente.
