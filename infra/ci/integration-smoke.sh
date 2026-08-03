#!/usr/bin/env bash
# =============================================================================
# G-6 — Smoke de integração entre serviços (CI)
# =============================================================================
# Exercita a cadeia REAL HTTP → api-gateway → Postgres e orchestrator-py →
# Postgres, com os serviços de verdade (dotnet run + uvicorn) e as migrations
# aplicadas — a classe de falha que teste unitário não vê (DSN, DI, JWT,
# policy, rate limit no banco, validação de prompt). Sem LLM: nenhum passo
# chama a Anthropic (ANTHROPIC_API_KEY é dummy).
#
# Pré-condições (ver job `integration` no ci.yml): Postgres com migrations
# aplicadas + seed (medico.ci / admin.ci / owner.ci com senha bcrypt), gateway em $GW,
# orchestrator em $ORCH.
# =============================================================================
set -euo pipefail

GW=${GW:-http://localhost:5050}
ORCH=${ORCH:-http://localhost:8081}
SENHA=${CI_SENHA:-senha-ci-123}

fail() { echo "✗ $*" >&2; exit 1; }
ok() { echo "✓ $*"; }

wait_http() {
  for _ in $(seq 1 60); do
    curl -sf --max-time 5 "$1" >/dev/null 2>&1 && return 0
    sleep 2
  done
  fail "timeout esperando $1"
}

json_field() { python3 -c "import json,sys; print(json.load(sys.stdin)[sys.argv[1]])" "$1"; }

# ─── 1. Health/ready dos dois serviços (DB de verdade dos dois lados) ───────
wait_http "$GW/health"
curl -sf "$GW/ready" >/dev/null || fail "gateway /ready"
ok "gateway health+ready (Postgres ok)"

wait_http "$ORCH/health"
curl -sf "$ORCH/ready" >/dev/null || fail "orchestrator /ready"
ok "orchestrator health+ready (asyncpg pool ok)"

# ─── 2. Login do médico + /me (HTTP → gateway → bcrypt → Postgres → JWT) ────
LOGIN=$(curl -sf -X POST "$GW/api/v1/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"medico.ci@example.com\",\"senha\":\"$SENHA\"}") || fail "login do médico"
TOKEN=$(echo "$LOGIN" | json_field token)
[ -n "$TOKEN" ] || fail "login não devolveu token"
curl -sf "$GW/api/v1/auth/me" -H "Authorization: Bearer $TOKEN" >/dev/null \
  || fail "/me com o JWT emitido"
ok "login + /me"

# ─── 3. Rate limit distribuído (T1-1) — estado no Postgres via HTTP real ────
for i in $(seq 1 5); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$GW/api/v1/auth/login" \
    -H 'Content-Type: application/json' \
    -d '{"email":"rl-smoke@example.com","senha":"errada"}')
  [ "$CODE" = "401" ] || fail "tentativa $i deveria ser 401, veio $CODE"
done
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$GW/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"rl-smoke@example.com","senha":"errada"}')
[ "$CODE" = "429" ] || fail "6ª tentativa deveria ser 429 (bloqueio T1-1), veio $CODE"
ok "rate limit de login bloqueia na 6ª tentativa (tabela login_rate_limits)"

# ─── 4. Validação de prompt (T4-2) via HTTP com OWNER ───────────────────────
# Editor de prompts é owner-only (T0-6/ADR-068): admin_financeiro NÃO edita prompts.
OWNER_TOKEN=$(curl -sf -X POST "$GW/api/v1/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"owner.ci@example.com\",\"senha\":\"$SENHA\"}" | json_field token) \
  || fail "login do owner"

# 4a. prompt formatado com JSON sem escape → 422
CODE=$(curl -s -o /tmp/prompt-invalido.json -w '%{http_code}' -X POST "$GW/api/v1/prompts" \
  -H "Authorization: Bearer $OWNER_TOKEN" -H 'Content-Type: application/json' \
  -d '{"agente":"orchestrator","nome":"response_generation","conteudo":"Oi {nome_paciente} {sintomas_resumo}. JSON: {\"humor\": 1}"}')
[ "$CODE" = "422" ] || fail "prompt quebrado deveria ser 422, veio $CODE: $(cat /tmp/prompt-invalido.json)"
ok "prompt com chave solta rejeitado (422, T4-2)"

# 4b. prompt cru válido → cria e ativa
RESP=$(curl -sf -X POST "$GW/api/v1/prompts" \
  -H "Authorization: Bearer $OWNER_TOKEN" -H 'Content-Type: application/json' \
  -d '{"agente":"agents","nome":"resumidor","conteudo":"Você é o resumidor de teste de integração."}') \
  || fail "criar prompt válido"
PROMPT_ID=$(echo "$RESP" | json_field id)
curl -sf -X POST "$GW/api/v1/prompts/$PROMPT_ID/ativar" \
  -H "Authorization: Bearer $OWNER_TOKEN" >/dev/null || fail "ativar prompt válido"
ok "prompt válido criado e ativado (id $PROMPT_ID)"

# 4c. prompt travado (ADR-035) continua barrado → 409
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$GW/api/v1/prompts" \
  -H "Authorization: Bearer $OWNER_TOKEN" -H 'Content-Type: application/json' \
  -d '{"agente":"orchestrator","nome":"crisis_detection","conteudo":"x"}')
[ "$CODE" = "409" ] || fail "prompt travado deveria ser 409, veio $CODE"
ok "salvaguarda ADR-035 segue travada (409)"

# 4d. admin_financeiro é BARRADO no editor de prompts → 403 (T0-6/ADR-068)
ADMIN_TOKEN=$(curl -sf -X POST "$GW/api/v1/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"admin.ci@example.com\",\"senha\":\"$SENHA\"}" | json_field token) \
  || fail "login do admin"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$GW/api/v1/prompts" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"agente":"agents","nome":"resumidor","conteudo":"x"}')
[ "$CODE" = "403" ] || fail "admin em /prompts deveria ser 403 (T0-6), veio $CODE"
ok "admin_financeiro barrado no editor de prompts (403, T0-6/ADR-068)"

# ─── 5. Auth interna do orchestrator (sem LLM: só a rejeição) ────────────────
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$ORCH/internal/conversation/run" \
  -H 'Content-Type: application/json' -H 'Authorization: Bearer token-errado' \
  -d '{"paciente_id":"00000000-0000-0000-0000-000000000000","mensagem":"x","idempotency_key":"k"}')
[ "$CODE" = "401" ] || fail "internal sem token válido deveria ser 401, veio $CODE"
ok "INTERNAL_API_TOKEN rejeita token errado (401)"

echo
echo "integração OK — gateway↔Postgres, orchestrator↔Postgres, T1-1, T4-2, ADR-035, T0-6"
