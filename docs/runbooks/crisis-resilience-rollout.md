# Runbook — Rollout da resiliência de crise (ADR-063 / T0-7)

**Gate de lançamento #1 (inegociável).** Liga as 4 camadas do ADR-063 que evitam o
incidente de 2026-06-17 (key Anthropic revogada → 401 → fail-safe floda crise em TODA
mensagem → ~18 dias silencioso, crise real perdida no ruído).

**Estado do código:** camadas 1-4 implementadas e testadas (`321926a`). Tudo **desligado**
por flags clínicas — não há código a escrever; o que falta é **atestação clínica (Adonai)**
+ flip de flag (ops). Owner clínico nunca é a engenharia (clinical-safety regra #1).

## O que já existe (não mexer)

| Camada | O quê | Onde |
|---|---|---|
| L1 | Screen determinístico (lista atestada, antes do LLM) | `crisis.py:239-248` (lista `227-236`) |
| L2 | Retry + backoff; classifica erro sistêmico × transitório | `crisis.py:292-324`, `_classify_llm_error:108-124` |
| L3 | Circuit breaker (limite=3) → `modo_degradado` | `crisis.py:162-206`; rota `graph.py:64-71`; node `degraded_response:499-570` |
| L4 | Alerta de ops (Sentry) quando o classificador cai | `_report_classifier_down:127-156` |

## Flags (defaults seguros — comportamento histórico)

- `CRISIS_RESILIENCE_ENABLED=False` — `config.py:37`
- `LISTA_ATESTADA=False` — `crisis.py:217` (`_TERMOS_CRISE_RAW` vazia, rascunho)
- `INSTABILIDADE_COPY.atestado=False` — `crisis_copy.py:85-86` (texto rascunho)
- `SHADOW_MODE=False` — `config.py:28-32`

## Passos

### Fase A — Atestação clínica (Adonai) — bloqueia tudo
1. Curar `_TERMOS_CRISE_RAW` (`crisis.py:219-224`): lista pt-BR explícita de ideação/autolesão. Validar precisão (evitar termo que dispara em citação/negação). Setar `LISTA_ATESTADA=True` (`:217`). PR com revisão clínica documentada.
2. Revisar texto de `INSTABILIDADE_COPY` (`crisis_copy.py:78-84`). Setar `atestado=True` (`:86`). PR documentada.

### Fase B — Validação em SHADOW (ops + Adonai) — antes do flip real
3. Em staging: `SHADOW_MODE=true` + `CRISIS_RESILIENCE_ENABLED=true`. Em shadow, L1-L3 rodam **idênticas** e gravam a trilha (`protocolos_crise_acionados`, `notificacoes_medico`), mas **`enviado=False`** — não notifica paciente/médico de verdade. Permite Adonai revisar os triggers sem impacto.
4. Smoke clínico: enviar msg com termo da lista → confirmar `crise detectada` + trilha gravada + `enviado=false`.
5. Smoke de outage (ops): invalidar `ANTHROPIC_API_KEY` temporariamente, enviar 3+ msgs → circuit breaker tripa, 4ª msg cai em `modo_degradado=true` SEM chamar LLM, sem flood.

### Fase C — Flip em prod (ops)
6. No EC2 (`/opt/cerebro-amigo-v3`), `.env`: `CRISIS_RESILIENCE_ENABLED=true` (deixar `SHADOW_MODE=false`).
7. `docker compose up -d --force-recreate orchestrator-py` (⚠ `--force-recreate` relê o `.env`; `restart` **não** relê).
8. `GET orchestrator-py:8080/ready` → 200. Conferir regra de alerta no Sentry mirando `component:crisis_classifier`.

### Rollback (segundos)
`CRISIS_RESILIENCE_ENABLED=false` no `.env` + `docker compose up -d --force-recreate orchestrator-py` → volta ao fail-safe histórico.

## Riscos (do ADR-063 — vigiar)
- `LISTA_ATESTADA=True` com lista imprecisa → falso-positivo no screen (escala humano à toa). Mitiga: curadoria + shadow.
- `INSTABILIDADE_COPY.atestado=True` com texto alarmante → paciente confuso em outage. Mitiga: revisão + shadow.
- Circuit breaker limite=3 (`crisis.py:208`) pode ser conservador/agressivo — calibrar empírico em staging.
- `modo_degradado` insere `notificacao_medico tipo='instabilidade_tecnica'` (severidade média) — distinta de crise real; se flood, cortar receptor no gateway.
- `enviado=false` em shadow: o gateway/BFF **precisa** respeitar a flag (não exibir). Confirmar na cadeia.
