#!/bin/bash
# Deploy do checkup no box único (roda NO box, via SSM).
# Busca segredos no SSM Parameter Store (SecureString) e sobe o compose.
set -euo pipefail
cd "$(dirname "$0")"

REGION=sa-east-1
get_param() {
  aws ssm get-parameter --region "$REGION" --name "$1" --with-decryption \
    --query Parameter.Value --output text
}

ANTHROPIC_API_KEY=$(get_param /cerebro-amigo/checkup/anthropic-api-key)
CHECKUP_DB_PASSWORD=$(get_param /cerebro-amigo/checkup/db-password)
CHECKUP_METRICS_TOKEN=$(get_param /cerebro-amigo/checkup/metrics-token)
# Superuser local só p/ migrations/backup; app conecta como checkup_app.
DB_SUPERUSER_PASSWORD=$(get_param /cerebro-amigo/checkup/db-superuser-password)

umask 077
cat > .env <<EOF
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
CHECKUP_DB_PASSWORD=${CHECKUP_DB_PASSWORD}
CHECKUP_METRICS_TOKEN=${CHECKUP_METRICS_TOKEN}
DB_SUPERUSER_PASSWORD=${DB_SUPERUSER_PASSWORD}
EOF

docker compose up -d --build db
./init-db.sh
docker compose up -d --build checkup caddy
docker compose ps
