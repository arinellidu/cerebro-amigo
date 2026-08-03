#!/usr/bin/env bash
# =============================================================================
# Health watchdog — alerta por e-mail (Resend) quando um serviço cai.
# =============================================================================
# Roda por cron no EC2 (a cada 3min). Checa os 5 /health locais. Alerta SÓ na
# MUDANÇA de estado (não spam): cai → e-mail vermelho; volta → e-mail verde.
# Estado em /var/tmp/cerebro-health-state. Lê segredos do .env do compose.
#
# Instalar (via SSM):
#   crontab -l 2>/dev/null | grep -q health-watchdog || \
#   (crontab -l 2>/dev/null; echo "*/3 * * * * bash /opt/cerebro-amigo-v3/infra/aws/health-watchdog.sh") | crontab -
# =============================================================================
set -uo pipefail

ENV_FILE=/opt/cerebro-amigo-v3/.env
STATE=/var/tmp/cerebro-health-state

val() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'; }
RESEND_KEY=$(val RESEND_API_KEY)
FROM=$(val EMAIL_FROM)
TO=$(val ALERT_EMAIL); [ -z "$TO" ] && TO="alerts@arinelli.com"

check() { curl -sf --max-time 5 "$1" >/dev/null 2>&1 && echo ok || echo DOWN; }

# nome:url (web checa a raiz; backend tem /health)
SERVICES="api-gateway=http://localhost:5050/health
orchestrator-py=http://localhost:8081/health
agents-py=http://localhost:8082/health
notifier-py=http://localhost:8083/health
web=http://localhost:3000/"

down=""
while IFS='=' read -r name url; do
  [ -z "$name" ] && continue
  [ "$(check "$url")" = DOWN ] && down="$down $name"
done <<< "$SERVICES"

now="${down# }"
prev=$(cat "$STATE" 2>/dev/null || echo "__init__")

# Sem mudança → nada a fazer (evita spam).
[ "$now" = "$prev" ] && exit 0
echo "$now" > "$STATE"

# 1ª execução (prev=__init__) só registra baseline; só alerta se já estiver down.
[ "$prev" = "__init__" ] && [ -z "$now" ] && exit 0

if [ -n "$now" ]; then
  subj="🔴 Cérebro Amigo: serviço(s) DOWN —$now"
  body="Watchdog detectou indisponibilidade em:$now (host i-057860cd97edafefb, $(date -u +'%Y-%m-%d %H:%M UTC')). Cheque: docker compose ps / logs."
else
  subj="🟢 Cérebro Amigo: serviços recuperados"
  body="Todos os 5 serviços voltaram a responder ($(date -u +'%Y-%m-%d %H:%M UTC'))."
fi

[ -z "$RESEND_KEY" ] && { echo "sem RESEND_API_KEY — não enviou"; exit 0; }
curl -s -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer $RESEND_KEY" -H "Content-Type: application/json" \
  -d "{\"from\":\"$FROM\",\"to\":[\"$TO\"],\"subject\":\"$subj\",\"text\":\"$body\"}" >/dev/null \
  && echo "alerta enviado: $subj"
