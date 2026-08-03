#!/usr/bin/env bash
# Smoke do portal do paciente (Tier 1+2+3) — gateway + BFF + páginas.
set -euo pipefail

GW=${GW:-http://localhost:5050}
WEB=${WEB:-http://localhost:3000}
EMAIL=${PORTAL_SMOKE_EMAIL:-paciente.e2e@local}
SENHA=${PORTAL_SMOKE_SENHA:-SmokeTest123#}

fail() { echo "✗ $*" >&2; exit 1; }
ok() { echo "✓ $*"; }

echo "=== SMOKE PORTAL (Tier 1+2+3) ==="
echo "gateway=$GW web=$WEB paciente=$EMAIL"
echo

curl -sf "$GW/health" >/dev/null || fail "gateway /health"
curl -sf "$GW/ready" >/dev/null || fail "gateway /ready"
ok "gateway health+ready"

curl -sf -o /dev/null "$WEB/p/entrar" || fail "web /p/entrar"
ok "web /p/entrar"

LOGIN=$(curl -sf -X POST "$GW/api/v1/auth/paciente/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"senha\":\"$SENHA\"}") || fail "login paciente"
TOKEN=$(echo "$LOGIN" | python3 -c "import json,sys; print(json.load(sys.stdin)['token'])")
[ -n "$TOKEN" ] || fail "token vazio"
ok "login paciente (gateway)"

AUTH="Authorization: Bearer $TOKEN"

HOME=$(curl -sf "$GW/api/v1/portal/paciente/home" -H "$AUTH") || fail "GET /home"
echo "$HOME" | python3 -c "
import json,sys
h=json.load(sys.stdin)
for k in ('perfil','tomadasHoje','proxConsulta','ultimoHumor','jaRegistrouHumorHoje','checkinsPendentes'):
    assert k in h, f'campo ausente: {k}'
assert isinstance(h['checkinsPendentes'], int)
print(f\"  checkins={h['checkinsPendentes']} humor_hoje={h['jaRegistrouHumorHoje']}\")
"
ok "GET /home + checkinsPendentes"

CONV=$(curl -sf "$GW/api/v1/portal/paciente/conversa" -H "$AUTH") || fail "GET /conversa"
N=$(echo "$CONV" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))")
ok "GET /conversa ($N msgs)"

CODE=$(curl -s -o /dev/null -w '%{http_code}' "$GW/api/v1/portal/paciente/checkins" -H "$AUTH")
[ "$CODE" = "200" ] || fail "GET /checkins HTTP $CODE"
ok "GET /checkins"

curl -sf "$GW/api/v1/portal/paciente/perfil" -H "$AUTH" >/dev/null || fail "GET /perfil"
ok "GET /perfil"

CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$GW/api/v1/portal/paciente/onboarding/concluido" -H "$AUTH")
[ "$CODE" = "204" ] || [ "$CODE" = "200" ] || [ "$CODE" = "404" ] && ok "POST /onboarding/concluido (HTTP $CODE)" || fail "POST onboarding HTTP $CODE"

# BFF: injeta cookie httpOnly (login real é Server Action em /p/entrar)
JAR=$(mktemp)
trap 'rm -f "$JAR"' EXIT
printf 'localhost\tFALSE\t/\tTRUE\t0\tpaciente_token\t%s\n' "$TOKEN" > "$JAR"

CODE=$(curl -s -b "$JAR" -o /tmp/bff-home.json -w '%{http_code}' "$WEB/api/paciente/home")
[ "$CODE" = "200" ] || fail "BFF home HTTP $CODE"
python3 -c "import json; h=json.load(open('/tmp/bff-home.json')); assert 'checkinsPendentes' in h"
ok "BFF GET /api/paciente/home (cookie injetado)"

CODE=$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' "$WEB/api/paciente/conversation")
[ "$CODE" = "200" ] || fail "BFF conversation HTTP $CODE"
ok "BFF GET /api/paciente/conversation"

for path in /p /p/humor /p/conversa /p/checkins /p/agenda /p/medicacoes /p/diario; do
  CODE=$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' "$WEB$path")
  [ "$CODE" = "200" ] || fail "GET $path HTTP $CODE"
  ok "GET $path → 200"
done

HTML=$(curl -s -b "$JAR" "$WEB/p")
echo "$HTML" | grep -q "Seu dia" || fail "FaixaDoDia ausente"
ok "home contém FaixaDoDia"

echo "$HTML" | grep -q "portal-rise-in" || fail "stagger CSS ausente"
ok "home contém stagger CSS"

OFF=$(curl -sf "$WEB/offline.html")
echo "$OFF" | grep -q "#07070D" || fail "offline.html sem theme-noir"
ok "offline.html theme-noir"

CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$GW/api/v1/portal/paciente/humor" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"humor":7,"ansiedade":4,"nota":null}')
[ "$CODE" = "204" ] || [ "$CODE" = "200" ] || fail "POST humor HTTP $CODE"
ok "POST /humor"

CODE=$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' "$WEB/api/paciente/escalas/phq9")
[ "$CODE" = "200" ] || fail "escalas/phq9 HTTP $CODE"
ok "BFF GET escalas/phq9"

echo
echo "SMOKE PORTAL OK — Tier 1+2+3"
