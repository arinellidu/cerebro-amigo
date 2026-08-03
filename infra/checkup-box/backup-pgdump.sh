#!/bin/bash
# Backup diário do banco checkup → S3 (box único = dado local, backup é obrigatório).
# Instalado como systemd timer (checkup-backup.timer). Role EC2 tem RW em
# s3://cerebro-amigo-db-backups/postgres/*.
set -euo pipefail
cd /opt/checkup/src/infra/checkup-box
source .env

STAMP=$(date -u +%Y-%m-%dT%H%M%SZ)
docker compose exec -T -e PGPASSWORD="${DB_SUPERUSER_PASSWORD}" db \
  pg_dump -U postgres -d checkup --no-owner | gzip \
  | aws s3 cp - "s3://cerebro-amigo-db-backups/postgres/checkup/checkup-${STAMP}.sql.gz" \
      --region sa-east-1 --expected-size 104857600
echo "backup OK: checkup-${STAMP}.sql.gz"
