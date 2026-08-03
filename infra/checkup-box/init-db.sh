#!/bin/bash
# Cria role checkup_app + aplica migrations do schema checkup (idempotente).
# Roda como superuser local do container db. Migrations vêm de infra/migrations.
set -euo pipefail
cd "$(dirname "$0")"
source .env

MIGRATIONS=(
  0039_checkup_schema.sql
  0040_checkup_rate_limits.sql
  0042_checkup_funnel_events_rid.sql
  0044_checkup_tracking.sql
  0059_checkup_scale_id_widen.sql
  0061_checkup_event_type_widen.sql
)

psql_db() {
  docker compose exec -T -e PGPASSWORD="${DB_SUPERUSER_PASSWORD}" db \
    psql -U postgres -d checkup -v ON_ERROR_STOP=1 "$@"
}

# aguarda o Postgres aceitar conexão
for i in $(seq 1 30); do
  docker compose exec -T db pg_isready -U postgres -d checkup && break
  sleep 2
done

psql_db <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'checkup_app') THEN
    CREATE ROLE checkup_app LOGIN;
  END IF;
END
\$\$;
ALTER ROLE checkup_app WITH LOGIN PASSWORD '${CHECKUP_DB_PASSWORD}';
SQL

for m in "${MIGRATIONS[@]}"; do
  echo ">> ${m}"
  psql_db < "../migrations/${m}"
done

psql_db <<'SQL'
GRANT USAGE ON SCHEMA checkup TO checkup_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA checkup TO checkup_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA checkup TO checkup_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA checkup
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO checkup_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA checkup
  GRANT USAGE, SELECT ON SEQUENCES TO checkup_app;
SQL

echo "init-db OK"
