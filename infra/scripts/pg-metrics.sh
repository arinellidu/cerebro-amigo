#!/usr/bin/env bash
# Coletor de métricas do Postgres self-hosted → CloudWatch (ADR-077).
# O stack de observabilidade do projeto é CloudWatch (não há Prometheus/Grafana);
# este coletor faz o papel do postgres_exporter/node_exporter para o que importa.
# Roda por systemd timer a cada 1 min (cerebro-pg-metrics.timer).
# Role de banco: cerebro_monitor (read-only, GRANT pg_monitor) via socket local do container.
# Namespace: Cerebro/Postgres. Publica mesmo com o postgres caído (PgUp=0 + host metrics).
set -uo pipefail

PG_CONTAINER="${PG_CONTAINER:-cerebro-amigo-v3-postgres-1}"
REGION="sa-east-1"
NS="Cerebro/Postgres"
S3_PREFIX="s3://cerebro-amigo-db-backups/postgres"
STATE_DIR="/var/lib/cerebro-backup"
DATA_MOUNT="/data/postgres"

q() { docker exec "$PG_CONTAINER" psql -U cerebro_monitor -d cerebro_v3 -tA -c "$1" </dev/null 2>/dev/null; }

METRICS=()
add() { METRICS+=("{\"MetricName\":\"$1\",\"Value\":$2,\"Unit\":\"$3\"}"); }

# ── disponibilidade ──────────────────────────────────────────────────────────
if docker exec "$PG_CONTAINER" pg_isready -U cerebro_monitor -q </dev/null 2>/dev/null; then
  UP=1
else
  UP=0
fi
add PgUp "$UP" Count

# ── métricas de banco (só com o pg de pé) ────────────────────────────────────
if [ "$UP" = "1" ]; then
  add ConnectionsTotal   "$(q 'SELECT count(*) FROM pg_stat_activity' || echo 0)" Count
  add ConnectionsActive  "$(q "SELECT count(*) FROM pg_stat_activity WHERE state = 'active'" || echo 0)" Count
  add CacheHitRatio      "$(q "SELECT COALESCE(round(100.0*sum(blks_hit)/nullif(sum(blks_hit)+sum(blks_read),0),2),100) FROM pg_stat_database WHERE datname='cerebro_v3'" || echo 0)" Percent
  add DbSizeBytes        "$(q "SELECT pg_database_size('cerebro_v3')" || echo 0)" Bytes
  add LocksWaiting       "$(q 'SELECT count(*) FROM pg_locks WHERE NOT granted' || echo 0)" Count
  add DeadlocksTotal     "$(q "SELECT deadlocks FROM pg_stat_database WHERE datname='cerebro_v3'" || echo 0)" Count
fi

# ── host: disco do volume de dados + swap ────────────────────────────────────
DISK=$(df --output=pcent "$DATA_MOUNT" 2>/dev/null | tail -1 | tr -dc '0-9' || echo 0)
add DataDiskUsedPercent "${DISK:-0}" Percent
SWAP=$(free | awk '/Swap/ {if ($2>0) printf "%.1f", $3/$2*100; else print 0}')
add SwapUsedPercent "${SWAP:-0}" Percent

# ── OOM kills no kernel (janela do timer) ────────────────────────────────────
OOM=$(journalctl -k --since "70 seconds ago" 2>/dev/null | grep -ciE "out of memory|oom-kill" || true)
add OomKills "${OOM:-0}" Count

# ── idade do backup (S3 last-success) e resultado do test-restore ────────────
LS=$(aws s3 cp "$S3_PREFIX/last-success" - --region "$REGION" 2>/dev/null || true)
if [ -n "$LS" ]; then
  AGE_H=$(( ( $(date -u +%s) - $(date -u -d "$LS" +%s) ) / 3600 ))
  add BackupAgeHours "$AGE_H" Count
fi
if [ -f "$STATE_DIR/last-restore-test" ]; then
  grep -q "PASS" "$STATE_DIR/last-restore-test" && RT=1 || RT=0
  add RestoreTestOk "$RT" Count
fi

# ── publica em uma chamada ───────────────────────────────────────────────────
DATA="[$(IFS=,; echo "${METRICS[*]}")]"
aws cloudwatch put-metric-data --region "$REGION" --namespace "$NS" --metric-data "$DATA"
