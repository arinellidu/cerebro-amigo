#!/bin/sh
set -eu

: "${POSTGRES_HOST:?POSTGRES_HOST ausente}"
: "${POSTGRES_DATABASE:?POSTGRES_DATABASE ausente}"
: "${POSTGRES_ADMIN_USER:?POSTGRES_ADMIN_USER ausente}"
: "${POSTGRES_ADMIN_PASSWORD:?POSTGRES_ADMIN_PASSWORD ausente}"
: "${DB_GATEWAY_PASSWORD:?DB_GATEWAY_PASSWORD ausente}"
: "${DB_WORKERS_PASSWORD:?DB_WORKERS_PASSWORD ausente}"

POSTGRES_ADMIN_DSN="host=${POSTGRES_HOST} port=5432 dbname=${POSTGRES_DATABASE} user=${POSTGRES_ADMIN_USER} password=${POSTGRES_ADMIN_PASSWORD} sslmode=require"
export POSTGRES_ADMIN_DSN

for migration in $(find /migrations -maxdepth 1 -type f -name '*.sql' | sort); do
  echo "Aplicando $(basename "$migration")"
  psql "$POSTGRES_ADMIN_DSN" -v ON_ERROR_STOP=1 -f "$migration"
done

psql "$POSTGRES_ADMIN_DSN" \
  -v ON_ERROR_STOP=1 \
  --set=gateway_password="$DB_GATEWAY_PASSWORD" \
  --set=workers_password="$DB_WORKERS_PASSWORD" <<'SQL'
ALTER ROLE cerebro_gateway PASSWORD :'gateway_password';
ALTER ROLE cerebro_workers PASSWORD :'workers_password';
SQL

echo 'Migrations e credenciais least-privilege aplicadas.'
