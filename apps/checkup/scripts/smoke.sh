#!/usr/bin/env bash
# Smoke E2E do checkup contra um servidor já no ar (BASE_URL, default localhost:3001).
# CI-safe: sem DB nem ANTHROPIC_API_KEY — devolutiva cai no fallback estático,
# /api/events retorna ok sem gravar, e o PDF (puro server-side) é o check que pegou
# o 500 do @react-pdf/renderer. Pode ser usado como gate antes da promoção Vercel.
set -uo pipefail
BASE="${1:-http://localhost:3001}"
UUID="00000000-0000-4000-8000-000000000000"
fail=0
ok()  { echo "  ✓ $1"; }
bad() { echo "  ✗ $1"; fail=1; }
code(){ curl -s -o /dev/null -w "%{http_code}" --max-time 25 "$1"; }
codepost(){ curl -s -o /dev/null -w "%{http_code}" --max-time 25 -X POST -H "Content-Type: application/json" -d "{}" "$1"; }
has() { curl -s --max-time 25 "$1" | grep -q "$2"; }

echo "Smoke checkup @ $BASE"

[ "$(code "$BASE/api/health")" = 200 ] && ok "health" || bad "health"
[ "$(code "$BASE/")" = 200 ] && ok "home" || bad "home"

# Headers de segurança (P1 hardening) — presentes em toda resposta (next.config headers()).
hdrs=$(curl -sI --max-time 25 "$BASE/")
if echo "$hdrs" | grep -qi "^content-security-policy:" && echo "$hdrs" | grep -qi "^strict-transport-security:"; then
  ok "security headers (CSP+HSTS)"
else
  bad "security headers (CSP/HSTS ausentes)"
fi

for p in depressao ansiedade tdah-adulto bipolaridade borderline alcool tabagismo drogas; do
  [ "$(code "$BASE/$p")" = 200 ] && ok "landing /$p" || bad "landing /$p"
done

# /crise renderiza CVV no HTML cru (SSR — não pode depender de JS)
{ [ "$(code "$BASE/crise")" = 200 ] && has "$BASE/crise" "tel:188"; } \
  && ok "/crise SSR (CVV no HTML)" || bad "/crise SSR"

for s in phq9 gad7 asrs18 audit mdq fagerstrom msi_bpd assist; do
  { [ "$(code "$BASE/teste/$s")" = 200 ] && has "$BASE/teste/$s" "Começar triagem"; } \
    && ok "/teste/$s quiz" || bad "/teste/$s quiz"
done

# eventos (sem DB → {ok:true}, não bloqueia)
ev=$(curl -s --max-time 25 -X POST "$BASE/api/events" -H "Content-Type: application/json" \
  -d "{\"event\":\"test_started\",\"sessionId\":\"$UUID\",\"scaleId\":\"phq9\"}")
echo "$ev" | grep -q '"ok":true' && ok "events ok" || bad "events ($ev)"

# evento keyed por rid (lado médico, migration 0042 / ADR-046) — sem sessionId → aceita
evr=$(curl -s --max-time 25 -X POST "$BASE/api/events" -H "Content-Type: application/json" \
  -d '{"event":"qr_scanned","rid":"smoke123"}')
echo "$evr" | grep -q '"ok":true' && ok "events por rid (0042)" || bad "events por rid ($evr)"

# funnel-metrics protegido: sem token configurado → 503 (fail-closed); com token mas sem
# header Authorization → 401. Ambos = não expõe métricas em superfície pública (ADR-050).
fmc=$(code "$BASE/api/funnel-metrics")
{ [ "$fmc" = 503 ] || [ "$fmc" = 401 ]; } && ok "funnel-metrics protegido ($fmc)" || bad "funnel-metrics protegido ($fmc)"

# acompanhamento longitudinal (ADR-050 Parte 2): DARK por padrão (flag off no CI) — o
# opt-in e o cron de envio respondem 404; a purga de retenção exige cron-token → 503.
[ "$(codepost "$BASE/api/tracking")" = 404 ] && ok "tracking opt-in dark (404)" || bad "tracking opt-in dark"
[ "$(codepost "$BASE/api/tracking/cron")" = 404 ] && ok "tracking cron dark (404)" || bad "tracking cron dark"
[ "$(codepost "$BASE/api/tracking/retention")" = 503 ] && ok "tracking retention sem token (503)" || bad "tracking retention sem token"
# páginas utilitárias por token (links de e-mail) renderizam (noindex)
[ "$(code "$BASE/evolucao")" = 200 ] && ok "/evolucao render" || bad "/evolucao render"
[ "$(code "$BASE/descadastrar")" = 200 ] && ok "/descadastrar render" || bad "/descadastrar render"

# devolutiva (sem Anthropic → fallback estático)
dev=$(curl -s -w "\n%{http_code}" --max-time 35 -X POST "$BASE/api/devolutiva" \
  -H "Content-Type: application/json" \
  -d '{"scaleId":"phq9","totalScore":12,"band":"moderate","bandLabel":"sintomas moderados"}')
{ [ "$(echo "$dev" | tail -1)" = 200 ] && echo "$dev" | grep -q acolhimento; } \
  && ok "devolutiva (fallback)" || bad "devolutiva"

# PDF — o check que pegou o 500 do react-pdf bundlado pelo Turbopack
for s in phq9 gad7 asrs18 audit mdq fagerstrom msi_bpd assist; do
  tmp=$(mktemp)
  c=$(curl -s -o "$tmp" -w "%{http_code}" --max-time 35 \
    "$BASE/api/pdf?scale=$s&score=12&band=informative&label=x&crisis=false&rid=ab")
  { [ "$c" = 200 ] && [ "$(head -c4 "$tmp")" = "%PDF" ]; } \
    && ok "PDF /$s (%PDF)" || bad "PDF /$s (http=$c)"
  rm -f "$tmp"
done

# /api/email-report (CK-4) — gera o mesmo PDF + envia por Resend. Sem RESEND_API_KEY
# (caso do CI) o resend.ts lança ANTES de qualquer HTTP → 502 fail-closed, NENHUM
# e-mail sai. Com a key viraria 200. Pega regressão de runtime (PDF/rota) sem enviar nada.
# scale=audit (expandida) de propósito: trava o enum completo — se voltar p/ só as 3
# escalas originais, AUDIT cai em 400 e este check quebra.
c=$(curl -s -o /dev/null -w "%{http_code}" --max-time 35 -X POST "$BASE/api/email-report" \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"00000000-0000-0000-0000-000000000000","email":"smoke@example.com","scale":"audit","score":12,"band":"moderate","label":"x","crisis":false}')
if [ "$c" = 502 ] || [ "$c" = 200 ]; then ok "email-report fail-closed/ok ($c)"; else bad "email-report (http=$c)"; fi

# Input inválido → 400 (Zod), sem tocar no envio.
c=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 -X POST "$BASE/api/email-report" \
  -H "Content-Type: application/json" -d '{"email":"not-an-email"}')
if [ "$c" = 400 ]; then ok "email-report valida input (400)"; else bad "email-report input (http=$c)"; fi

if [ "$fail" = 0 ]; then echo "SMOKE OK"; else echo "SMOKE FAILED"; fi
exit "$fail"
