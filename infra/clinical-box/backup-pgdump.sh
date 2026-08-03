#!/bin/bash
# Backup diário do banco clínico → S3 (box único = dado local; backup é parte
# OBRIGATÓRIA do deploy, não opcional — ADR-079, mesmo racional do ADR-078).
# Instalado como systemd timer (clinical-backup.timer). Role EC2 tem RW em
# s3://cerebro-amigo-db-backups/postgres/*.
set -euo pipefail
cd /opt/cerebro-amigo-v3/src/infra/clinical-box
# .env não é sourceável (DSNs contêm `;`) — extrai só a senha.
DB_SUPERUSER_PASSWORD=$(sed -n 's/^DB_SUPERUSER_PASSWORD=//p' .env | head -1)

STAMP=$(date -u +%Y-%m-%dT%H%M%SZ)
docker compose exec -T -e PGPASSWORD="${DB_SUPERUSER_PASSWORD}" postgres \
  pg_dump -U postgres -d cerebro_v3 --no-owner | gzip \
  | aws s3 cp - "s3://cerebro-amigo-db-backups/postgres/clinical/cerebro_v3-${STAMP}.sql.gz" \
      --region sa-east-1 --expected-size 524288000
echo "backup OK: cerebro_v3-${STAMP}.sql.gz"
