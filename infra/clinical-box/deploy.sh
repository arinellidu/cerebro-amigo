#!/bin/bash
# Deploy do stack clínico no box único (ADR-079). Roda NO box, via SSM.
# Busca segredos no SSM Parameter Store (SecureString), monta o .env, gera o
# cert TLS do Postgres, builda as imagens SEQUENCIALMENTE (RAM do t3.medium) e
# sobe o compose com health checks.
set -euo pipefail
cd "$(dirname "$0")"

REGION=sa-east-1
EIP_PUBLICO="${EIP_PUBLICO:-$(curl -sf http://169.254.169.254/latest/meta-data/public-ipv4 || true)}"

get_param() {
  aws ssm get-parameter --region "$REGION" --name "$1" --with-decryption \
    --query Parameter.Value --output text
}
# Segredos opcionais: sem o param, a feature fica desligada (fail-closed nas apps).
get_param_opt() {
  aws ssm get-parameter --region "$REGION" --name "$1" --with-decryption \
    --query Parameter.Value --output text 2>/dev/null || echo ""
}

JWT_SECRET=$(get_param /cerebro-amigo/clinical/jwt-secret)
INTERNAL_API_TOKEN=$(get_param /cerebro-amigo/clinical/internal-api-token)
ENCRYPTION_KEY=$(get_param /cerebro-amigo/clinical/encryption-key)
EDGE_AUTH_SECRET=$(get_param /cerebro-amigo/clinical/edge-auth-secret)
DB_SUPERUSER_PASSWORD=$(get_param /cerebro-amigo/clinical/db-superuser-password)
DB_GATEWAY_PASSWORD=$(get_param /cerebro-amigo/clinical/db-gateway-password)
DB_WORKERS_PASSWORD=$(get_param /cerebro-amigo/clinical/db-workers-password)
VAPID_PUBLIC_KEY=$(get_param /cerebro-amigo/clinical/vapid-public-key)
VAPID_PRIVATE_KEY=$(get_param /cerebro-amigo/clinical/vapid-private-key)
TURN_SECRET=$(get_param /cerebro-amigo/clinical/turn-secret)
ANTHROPIC_API_KEY=$(get_param /cerebro-amigo/clinical/anthropic-api-key)
# Opcionais (pendências registradas no ADR-079; vazio = feature off, serviço sobe)
RESEND_API_KEY=$(get_param_opt /cerebro-amigo/clinical/resend-api-key)
ASAAS_API_KEY=$(get_param_opt /cerebro-amigo/clinical/asaas-api-key)
ASAAS_WEBHOOK_TOKEN=$(get_param_opt /cerebro-amigo/clinical/asaas-webhook-token)
INFOSIMPLES_TOKEN=$(get_param_opt /cerebro-amigo/clinical/infosimples-token)
TURNSTILE_SECRET_KEY=$(get_param_opt /cerebro-amigo/clinical/turnstile-secret-key)
TURNSTILE_SITE_KEY=$(get_param_opt /cerebro-amigo/clinical/turnstile-site-key)
LANGSMITH_API_KEY=$(get_param_opt /cerebro-amigo/clinical/langsmith-api-key)
SENTRY_DSN=$(get_param_opt /cerebro-amigo/clinical/sentry-dsn)
# Cockpit de Aquisição (ADR-050): mesmo token que o checkup valida (namespace dele).
CHECKUP_METRICS_TOKEN=$(get_param_opt /cerebro-amigo/checkup/metrics-token)

# Cert TLS self-signed do Postgres (fora do PGDATA; key 0600 uid 999 = postgres).
mkdir -p /data/pgcerts
if [ ! -f /data/pgcerts/server.crt ]; then
  openssl req -new -x509 -days 3650 -nodes -text \
    -out /data/pgcerts/server.crt -keyout /data/pgcerts/server.key \
    -subj "/CN=postgres"
fi
chown 999:999 /data/pgcerts/server.key /data/pgcerts/server.crt
chmod 600 /data/pgcerts/server.key

umask 077
cat > .env <<EOF
# GERADO pelo deploy.sh — NÃO editar à mão; fonte da verdade é o SSM.
# === Banco (Postgres self-hosted, ADR-077/ADR-079) ===
POSTGRES_DSN=Host=postgres;Port=5432;Database=cerebro_v3;Username=cerebro_gateway;Password=${DB_GATEWAY_PASSWORD};SSL Mode=Require;Trust Server Certificate=true
POSTGRES_DSN_URL=postgresql://cerebro_workers:${DB_WORKERS_PASSWORD}@postgres:5432/cerebro_v3?sslmode=require
DB_SUPERUSER_PASSWORD=${DB_SUPERUSER_PASSWORD}
DB_GATEWAY_PASSWORD=${DB_GATEWAY_PASSWORD}
DB_WORKERS_PASSWORD=${DB_WORKERS_PASSWORD}

# === Auth / serviço-a-serviço ===
JWT_SECRET=${JWT_SECRET}
INTERNAL_API_TOKEN=${INTERNAL_API_TOKEN}
EDGE_AUTH_SECRET=${EDGE_AUTH_SECRET}

# === Cifragem em repouso (ADR-018) ===
ENCRYPTION_KEY=${ENCRYPTION_KEY}

# === LLM (ADR-044 — Anthropic API direta) ===
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
ANTHROPIC_MODEL_HAIKU=claude-haiku-4-5-20251001
ANTHROPIC_MODEL_SONNET=claude-sonnet-4-6
ANTHROPIC_MODEL_OPUS=claude-opus-4-8

# === Bedrock (SÓ embeddings/RAG in-region — ADR-028; LLM segue Anthropic) ===
AWS_REGION=sa-east-1
BEDROCK_REGION=sa-east-1
EMBEDDINGS_ENABLED=true
BEDROCK_EMBED_MODEL=cohere.embed-multilingual-v3
RAG_TOP_K=8
RAG_INDEX_INTERVAL_HOURS=12

# === E-mail (Resend) — pendência: sem key, envio fica off ===
RESEND_API_KEY=${RESEND_API_KEY}
EMAIL_FROM=Cérebro Amigo <noreply@cerebroamigo.com.br>

# === URLs ===
API_GATEWAY_URL=http://api-gateway:5000
ORCHESTRATOR_PY_URL=http://orchestrator-py:8081
AGENTS_PY_URL=http://agents-py:8082
NOTIFIER_PY_URL=http://notifier-py:8083
FRONTEND_URL=https://www.cerebroamigo.com.br
PORTAL_PACIENTE_URL=https://www.cerebroamigo.com.br

# === Web Push (VAPID) ===
VAPID_PUBLIC_KEY=${VAPID_PUBLIC_KEY}
VAPID_PRIVATE_KEY=${VAPID_PRIVATE_KEY}
VAPID_SUBJECT=mailto:noreply@cerebroamigo.com.br
NEXT_PUBLIC_VAPID_PUBLIC_KEY=${VAPID_PUBLIC_KEY}

# === Áudio / Transcribe (diário de voz + escriba ADR-040/075) ===
S3_BUCKET_AUDIO=cerebro-amigo-audio-sa-east-1
S3_BUCKET_AUDIO_MSGS=cerebro-amigo-audio-msgs
S3_BUCKET_SOCIAL=cerebro-amigo-social
TRANSCRIBE_POLL_INTERVAL_S=2.0
TRANSCRIBE_TIMEOUT_S=600.0

# === Teleconsulta (ADR-026) ===
STUN_URLS=stun:stun.l.google.com:19302
TURN_URLS=turn:${EIP_PUBLICO}:3478?transport=udp,turn:${EIP_PUBLICO}:3478?transport=tcp
TURN_SECRET=${TURN_SECRET}
TURN_TTL_SECONDS=3600
TURN_REALM=cerebro-amigo
TURN_EXTERNAL_IP=${EIP_PUBLICO}

# === CFM / captcha / cobrança (opcionais — vazio = off/fail-closed) ===
INFOSIMPLES_TOKEN=${INFOSIMPLES_TOKEN}
INFOSIMPLES_CFM_URL=https://api.infosimples.com/api/v2/consultas/cfm/cadastro
CRM_VALIDATION_ENABLED=true
NEXT_PUBLIC_TURNSTILE_SITE_KEY=${TURNSTILE_SITE_KEY}
TURNSTILE_SECRET_KEY=${TURNSTILE_SECRET_KEY}
ASAAS_API_KEY=${ASAAS_API_KEY}
ASAAS_WEBHOOK_TOKEN=${ASAAS_WEBHOOK_TOKEN}
ASAAS_RECONCILE_INTERVAL_HORAS=24

# === MEMED (sandbox de homologação; emissão pausada na UI — ADR-070) ===
MEMED_API_BASE=https://integrations.api.memed.com.br/v1
MEMED_SCRIPT_URL=https://integrations.memed.com.br/modulos/plataforma.sinapse-prescricao/build/sinapse-prescricao.min.js

# === Observabilidade IA (LGPD: hide inputs/outputs por default, T0-4) ===
LANGSMITH_API_KEY=${LANGSMITH_API_KEY}
LANGSMITH_PROJECT=cerebro-amigo-v3
LANGSMITH_TRACING_V2=true
LANGSMITH_HIDE_INPUTS=true
LANGSMITH_HIDE_OUTPUTS=true
PII_REDACTION_ENABLED=true
SENTRY_DSN=${SENTRY_DSN}

# === Modos / flags ===
SHADOW_MODE=false
AGENTS_MODE=scheduled
NOTIFIER_MODE=scheduled
SCHEDULER_INTERVAL_SECONDS=60
HUMAN_IN_THE_LOOP=true
ENABLE_AUDIT_AGENT=true
MAX_DAILY_LLM_USD=5.00

# === Cockpit de Aquisição (ADR-050) ===
CHECKUP_METRICS_TOKEN=${CHECKUP_METRICS_TOKEN}
CHECKUP_METRICS_URL=https://checkup.cerebroamigo.com.br/api/funnel-metrics

# === Resiliência de crise (ADR-063) — LIGAR só após atestação clínica (T0-7) ===
CRISIS_RESILIENCE_ENABLED=false
EOF

export COMPOSE_PROFILES=turn

# Banco primeiro (migrations antes das apps), depois builds um a um (RAM).
docker compose up -d postgres
./init-db.sh
for svc in api-gateway orchestrator-py agents-py notifier-py web; do
  echo ">> build ${svc}"
  docker compose build "${svc}"
done
docker compose up -d
docker compose ps

# Health checks (dentro da rede do compose)
sleep 20
for svc in api-gateway:5000 orchestrator-py:8081 agents-py:8082 notifier-py:8083; do
  docker compose exec -T api-gateway curl -sf "http://${svc}/health" >/dev/null \
    && echo "health ${svc} OK" || echo "health ${svc} FALHOU"
done
docker compose exec -T web wget -qO- http://127.0.0.1:3000 >/dev/null \
  && echo "health web OK" || echo "health web FALHOU"
