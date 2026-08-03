#!/usr/bin/env bash
# =============================================================================
# Crisis classifier watchdog — alerta quando o detector de crise cai no FAIL-SAFE.
# =============================================================================
# Plano de seguranca P0-1 / ADR-063 camada 4 (caminho SEM Sentry, que esta off).
#
# O no detect_crisis (orchestrator) tem fail-safe: se a LLM/key falha, TODA
# mensagem vira crise (gatilho='classifier_error'). O incidente de 2026-06-17
# (ANTHROPIC_API_KEY revogada) ficou ~18 dias SILENCIOSO -> medico inundado de
# crise falsa, crise real soterrada. Este watchdog fecha o gap de deteccao.
#
# Sinal: linhas em protocolos_crise_acionados com gatilho='classifier_error' na
# janela (default 20min). >=1 = o classificador esta sistemicamente fora.
# Roda por systemd timer no EC2 (a cada 5min; o host NAO tem cron). Alerta SO na
# mudanca de estado (sem spam). Le segredos do .env do compose. Conecta como
# cerebro_workers (BYPASSRLS, ve todos os tenants) em read-only.
#
# Instalar (via SSM, como root) — espelha cerebro-watchdog/video-watchdog:
#   cat > /etc/systemd/system/cerebro-crisis-watchdog.service <<'UNIT'
#   [Unit]
#   Description=Cerebro Amigo crisis classifier watchdog (P0-1 / ADR-063)
#   [Service]
#   Type=oneshot
#   ExecStart=/usr/bin/bash -c '/opt/cerebro-amigo-v3/infra/aws/crisis-classifier-watchdog.sh >> /var/log/cerebro-crisis-watchdog.log 2>&1'
#   UNIT
#   cat > /etc/systemd/system/cerebro-crisis-watchdog.timer <<'UNIT'
#   [Unit]
#   Description=Roda o crisis classifier watchdog a cada 5min
#   [Timer]
#   OnBootSec=3min
#   OnUnitActiveSec=5min
#   AccuracySec=30s
#   [Install]
#   WantedBy=timers.target
#   UNIT
#   systemctl daemon-reload && systemctl enable --now cerebro-crisis-watchdog.timer
# =============================================================================
set -uo pipefail

ENV_FILE=/opt/cerebro-amigo-v3/.env
STATE=/var/tmp/cerebro-crisis-classifier-state
WINDOW_MIN=20

val() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'; }
RESEND_KEY=$(val RESEND_API_KEY)
FROM=$(val EMAIL_FROM)
TO=$(val ALERT_EMAIL); [ -z "$TO" ] && TO="alerts@arinelli.com"
DSN=$(val POSTGRES_DSN_URL)   # cerebro_workers — BYPASSRLS, enxerga todos os tenants

[ -z "$DSN" ] && { echo "sem POSTGRES_DSN_URL — abortou"; exit 0; }

CNT=$(PGCONNECT_TIMEOUT=8 psql "$DSN" -tAc \
  "SELECT count(*) FROM protocolos_crise_acionados WHERE gatilho='classifier_error' AND criado_em > now() - interval '${WINDOW_MIN} minutes'" 2>/dev/null | tr -d '[:space:]')

# DB inacessivel / query falhou -> nao altera estado, sai quieto (evita falso alarme).
[ -z "$CNT" ] && { echo "query falhou (DB inacessivel?) — sem acao"; exit 0; }

if [ "$CNT" -gt 0 ]; then now="alert"; else now="ok"; fi
prev=$(cat "$STATE" 2>/dev/null || echo "__init__")

[ "$now" = "$prev" ] && exit 0            # sem mudanca -> nada
echo "$now" > "$STATE"
[ "$prev" = "__init__" ] && [ "$now" = "ok" ] && exit 0   # baseline saudavel

if [ "$now" = "alert" ]; then
  subj="🔴 Cérebro Amigo: classificador de crise em FAIL-SAFE ($CNT falsos/${WINDOW_MIN}min)"
  body="O detector de crise esta caindo no fail-safe (gatilho=classifier_error): $CNT protocolo(s) de crise FALSOS nos ultimos ${WINDOW_MIN}min. Causa provavel: ANTHROPIC_API_KEY invalida/expirada ou Anthropic fora. Efeito: TODA mensagem de paciente vira crise falsa (medico inundado, crise real soterrada). Acao: verificar a key + logs do orchestrator (crisis.detect.failed). Host i-057860cd97edafefb, $(date -u +'%Y-%m-%d %H:%M UTC')."
else
  subj="🟢 Cérebro Amigo: classificador de crise recuperado"
  body="Sem novos fail-safe (classifier_error) nos ultimos ${WINDOW_MIN}min ($(date -u +'%Y-%m-%d %H:%M UTC'))."
fi

[ -z "$RESEND_KEY" ] && { echo "sem RESEND_API_KEY — nao enviou"; exit 0; }
curl -s -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer $RESEND_KEY" -H "Content-Type: application/json" \
  -d "{\"from\":\"$FROM\",\"to\":[\"$TO\"],\"subject\":\"$subj\",\"text\":\"$body\"}" >/dev/null \
  && echo "alerta enviado: $subj"
