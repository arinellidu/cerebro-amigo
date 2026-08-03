---
name: python-ai-services
description: >-
  Convenções dos serviços Python do Cérebro Amigo V3 (orchestrator-py, agents-py,
  notifier-py). Use ao criar ou alterar: nó/grafo LangGraph, fluxo conversacional,
  qualquer chamada ao Claude (via client LLM unificado provider-switchável,
  LLM_PROVIDER; vigente: Anthropic API direta — ADR-044), client/SDK de LLM,
  roteamento de modelo (Haiku/Sonnet/Opus), agente analítico, job do APScheduler,
  Web Push (pywebpush), endpoint FastAPI desses serviços, ou config do LangSmith.
  Use TAMBÉM, e com PRIORIDADE, quando o pedido for "migrar o LLM para o Bedrock",
  "trocar a chave/provider do LLM", "conectar à IA da AWS" ou mexer em região/IAM
  do Bedrock — atenção: o vigente é Anthropic (ADR-044) e flipar o provider exige
  novo ADR; leia references/bedrock-client.md antes de tocar no client.
---

# Serviços Python — orchestrator / agents / notifier

Três FastAPI. **Única camada que fala com o LLM**, via **client unificado provider-switchável** (`LLM_PROVIDER`) — vigente: **Anthropic API direta** (ADR-044); Bedrock reservado atrás da flag (ADR-015).

## Regra de ouro

Toda decisão sobre paciente passa pelos guardrails clínicos. Antes de escrever prompt, fluxo de crise, ou resposta ao paciente, **leia a skill `clinical-safety`**. O LLM extrai/organiza fato relatado; não decide clínica.

## orchestrator-py (:8081) — LangGraph

IA conversacional + protocolo de crise. Grafo stateful: recebe mensagem → detecta crise → extrai sintomas → audita → responde (SSE). 

- **Crise:** detecção (Haiku) → texto **literal** de `crisis_copy.py` → registra `protocolos_crise_acionados` → notifica médico → pausa automação. Nunca gere texto de crise com LLM.
- **Auditoria:** `audit_response` antes de qualquer texto chegar ao paciente; `escalate_to_human` quando necessário.
- **Streaming:** responde por SSE; o api-gateway faz proxy para o cliente.

## agents-py (:8082) — APScheduler

5 agentes analíticos (não conversacionais), agendados (`SCHEDULER_INTERVAL_SECONDS`). Rodam em **`SHADOW_MODE`** antes de agir em produção: logam o que fariam, sem efeito. Cada execução vai para `agente_execucoes` (append-only). Modelo pesado (Opus) só onde o raciocínio justifica; o resto em Haiku/Sonnet por custo/latência.

## notifier-py (:8083) — Web Push

Push de check-in via `pywebpush` + VAPID (`VAPID_*`). Sem conteúdo clínico no payload do push — só gatilho para abrir o app. Respeita `NOTIFIER_MODE`.

## LLM via client unificado (ADR-015 + ADR-044)

A camada de LLM é **provider-switchável por uma env var** `LLM_PROVIDER` ∈ {`anthropic`, `bedrock`}. Os call-sites só chamam `haiku()` / `sonnet()` / `with_schema()` / `ainvoke_structured()` — **não sabem** qual provider está ativo (factory `build_chat_model`, import do SDK lazy). Código real: `orchestrator-py/app/conversation/llm.py` e `agents-py/app/core/llm.py`.

- **Vigente: `LLM_PROVIDER=anthropic`** (ADR-044). `ChatAnthropic` (langchain-anthropic); auth por **`ANTHROPIC_API_KEY`** (SSM SecureString — **nunca** em código/imagem/log). Modelos: `ANTHROPIC_MODEL_HAIKU/SONNET/OPUS`.
- **Reservado: `LLM_PROVIDER=bedrock`** (ADR-015, atrás da flag). `ChatBedrockConverse` (langchain-aws); auth por **IAM role** (prod) / `AWS_PROFILE` (dev); `BEDROCK_MODEL_*`. **Hoje inativo** — o acesso aos modelos Anthropic no Bedrock **não foi aprovado pela AWS** e o ADR-008 (Bedrock-only) está **suspenso**.
- **Por que não Bedrock:** a residência LGPD que justificaria Bedrock-in-region **não se concretiza** — os model-ids que rodam em `sa-east-1` são perfis `global.` que processam fora do BR (ADR-015). Anthropic API e Bedrock-global são equivalentes em residência; vence a simplicidade.
- 🔒 **Não migre de volta para Bedrock** — nem "corrija" o código para Bedrock por causa de doc/skill antigo — **sem um novo ADR aprovado**. Auth é fail-fast no startup (`anthropic` exige a key; `bedrock` exige região).
- **Detalhes, código e envs: leia `references/bedrock-client.md`.**

## Roteamento de modelo por etapa

O helper fixa o **tier**; o model-id concreto vem do **provider ativo** (`resolve_model_id`).

| Etapa | Helper (tier) | Env (vigente / reservado) |
| --- | --- | --- |
| Detecção de crise, classificação, auditoria | `haiku()` | `ANTHROPIC_MODEL_HAIKU` / `BEDROCK_MODEL_HAIKU` |
| Extração de sintomas, resposta ao paciente | `sonnet()` | `ANTHROPIC_MODEL_SONNET` / `BEDROCK_MODEL_SONNET` |
| Resumo pré-consulta denso / análise de padrões | tier Opus | `ANTHROPIC_MODEL_OPUS` / `BEDROCK_MODEL_OPUS` |

Custo por chamada é estimado em `pricing.py` (`PRICE_MAP[(provider, tier)]`) e grava `custo_usd` em `mensagens`/`agente_execucoes`.

## LangSmith

Tracing ligado, mas com `PII_REDACTION_ENABLED=true`. Nunca trace conteúdo clínico cru. Amostre se o custo por volume subir.

## FastAPI — convenções

- `GET /health` e `GET /ready` em todos os três.
- Autenticação entre serviços por `INTERNAL_API_TOKEN` (header Bearer).
- Python 3.12. Dependências por serviço (não monolito de requirements).

## Não-regressão (migração V2→V3 concluída)

A migração já está em produção — não recrie nada disso. Invariantes a preservar em qualquer mudança:

- **Client LLM é unificado** (ADR-015/044): mexeu no transporte → passe pela factory `build_chat_model`; nunca instancie SDK direto no call-site. Vigente Anthropic; **não** reverter para Bedrock sem novo ADR.
- **Sem `AZURE_*`** (Azure OpenAI/Whisper saíram — não reintroduzir).
- Preserve `crisis_copy.py` (texto de crise literal), os gates de `SHADOW_MODE` e a estrutura do grafo.
