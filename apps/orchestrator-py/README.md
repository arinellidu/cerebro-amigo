# Cérebro Amigo · orchestrator-py

Orquestrador conversacional em Python (FastAPI + LangGraph + LangSmith).
**Sem WhatsApp.** Interface é PWA do paciente via gateway .NET.

## Arquitetura

```
PWA (Next.js) ── POST /api/v1/portal/paciente/conversa/mensagem ──▶ Gateway (.NET)
                                                                       │ proxy SSE
                                                                       │ Authorization: Bearer ${INTERNAL_API_TOKEN}
                                                                       ▼
                                                              FastAPI orchestrator-py
                                                                       │
                                                                       │ app.astream_events(v2)
                                                                       ▼
                                                              LangGraph (Postgres checkpointer)
                                                                       │
                                                              SSE: { event: node|token|complete|error, data: {...} }
                                                                       ▲
                                                              PWA renderiza incremental
```

## Topologia do grafo

```
START
  ↓
load_context              (clientes+pacientes, conversa, mensagem do paciente)
  ↓
[automação pausada OU conversa não-aberta]  → END
  ↓
detect_crisis (Haiku 4.5)
  ↓
[crise] → crisis_protocol (TEXTO FIXO, sem LLM) → END
  ↓
classify_medication (Haiku 4.5)
  ↓
[é resposta] → update_intake → ack → finalize → END
  ↓
extract_symptoms (Sonnet 4.6)
  ↓
generate_response (Sonnet 4.6, streamed via SSE)
  ↓
audit_response (Haiku 4.5)
  ├── enviar     → finalize → END
  ├── reescrever → generate_response (até MAX_RETRY_AUDIT)
  └── bloquear   → escalate_to_human → END
```

## Estrutura

```
app/
├── main.py                    # FastAPI + lifespan
├── config.py                  # settings tipadas (pydantic-settings)
├── db.py                      # asyncpg pool
├── observability.py           # LangSmith + redação de PII brasileiras
├── api/portal.py              # POST /internal/portal/conversation/message (SSE)
├── conversation/
│   ├── __init__.py            # process_message() + stream_conversation()
│   ├── state.py               # ConversaState (TypedDict)
│   ├── schemas.py             # Saídas estruturadas Pydantic
│   ├── prompts.py             # Prompts versionados
│   ├── crisis_copy.py         # Texto fixo de crise (hash + versão)
│   ├── llm.py                 # Factories de ChatAnthropic
│   ├── graph.py               # Definição e compilação do grafo
│   ├── streaming.py           # Tradutor astream_events → eventos SSE
│   └── nodes/                 # Um nó por arquivo
migrations/                    # DDLs adicionais (045 = inbound_messages)
tests/                         # Roteamento + PII (sem LLM real)
scripts/eval_crisis.py         # Eval contra dataset no LangSmith
```

## SSE — formato dos eventos

Cada evento segue o padrão SSE bruto: `event: NAME\ndata: JSON\n\n`.

| event      | data                                                         | quando                                  |
|------------|--------------------------------------------------------------|-----------------------------------------|
| `node`     | `{name, status, summary?}`                                   | início/fim de cada nó                   |
| `token`    | `{delta: "..."}`                                             | streaming de tokens do `generate_response` |
| `complete` | `{conversa_id, resposta_final, crise, medicacao, sintomas, audit, trace_id}` | final do grafo                          |
| `error`    | `{message, type?, trace_id?}`                                | falha não tratada                       |

Idempotência: `idempotency_key` deve ser UUID/hash único por mensagem. A
tabela `inbound_messages` (migration 045) registra status (`in_progress`,
`completed`, `failed`) e bloqueia duplicatas com HTTP 409.

## Smoke test

```bash
TOKEN=$(docker compose exec -T orchestrator-py sh -c 'echo $INTERNAL_API_TOKEN' | tr -d '\r\n')

curl -N -X POST http://localhost:8081/internal/portal/conversation/message \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "paciente_id": "00000000-0000-0000-0000-000000000099",
    "mensagem": "tô meio ansiosa hoje, dormi 4h",
    "idempotency_key": "test-pwa-001",
    "canal": "pwa"
  }'
```

`-N` desabilita o buffering do curl pra ver os eventos chegando em tempo real.

## Variante síncrona (testes/eval)

`POST /internal/conversation/run` ainda existe para rodar o grafo sem SSE
(útil pra evals do LangSmith e testes).

## LGPD

Saúde mental é categoria especial (art. 11 LGPD). `LANGSMITH_HIDE_INPUTS` e
`LANGSMITH_HIDE_OUTPUTS` são **true por default** (DEBT T0-4): traces sobem só
com metadata. `PII_REDACTION_ENABLED=true` (redação de CPF/email/telefone/data
por regex) segue ativa como defesa em profundidade caso alguém abra os traces
em dev. Self-hosted LangSmith continua sendo a opção ideal de longo prazo.
Documente qualquer desvio no RIPD/DPIA.

## Texto de crise

`app/conversation/crisis_copy.py` tem versão + hash SHA-256. Cada
acionamento grava `copy_versao + copy_hash` em `notificacoes_medico.metadata`
para auditoria. Para mudar:

1. Nova constante `_TEXTO_V2` + atualização do `CRISIS_COPY`.
2. PR com aprovação registrada da psiquiatra responsável.
3. Dataset de regressão antes do merge.
