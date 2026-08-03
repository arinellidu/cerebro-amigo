#!/usr/bin/env bash
# Teste de restore do backup mais recente (ADR-077): backup não testado é loteria.
#
# Uso: test-restore.sh <s3-prefix>          (ex.: s3://cerebro-amigo-db-backups/postgres)
#
# Fluxo: baixa o daily/ mais recente → confere SHA256SUMS → sobe container pgvector
# efêmero em 127.0.0.1:5433 → pg_restore de cada dump → valida contagens contra o
# manifesto → SELECT com operador de distância do pgvector → destrói o container.
#
# Regra de validação (origem viva, trilhas insert-only): restaurado == manifesto → OK;
# restaurado > manifesto → OK com aviso (drift entre manifesto e dump);
# restaurado < manifesto → FALHA (perda de dados no pipeline).
#
# Resultado observável: /var/lib/cerebro-backup/last-restore-test + <prefix>/last-restore-test.
# Agendamento: systemd timer cerebro-db-restore-test.timer (semanal, dom 05:00 BRT).
set -euo pipefail

S3_PREFIX="${1:?uso: test-restore.sh <s3-prefix>}"
S3_PREFIX="${S3_PREFIX%/}"
IMAGE="pgvector/pgvector:0.8.4-pg16"
NAME="cerebro-restore-test"
PORT=5433
STATE_DIR="/var/lib/cerebro-backup"
# roles da origem pré-criadas (NOLOGIN) p/ policies RLS/GRANTs restaurarem limpo
PRECREATE_ROLES="${PRECREATE_ROLES:-cerebroadmin cerebro_gateway cerebro_workers checkup_app}"
STAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
WORKDIR=$(mktemp -d /tmp/pg-restore-test.XXXXXX)
FAILURES=0
DRIFTS=0
RESULT_SET=0

log() { echo "[test-restore] $*"; }

result() {
  RESULT_SET=1
  mkdir -p "$STATE_DIR"
  echo "$STAMP $1" > "$STATE_DIR/last-restore-test"
  echo "$STAMP $1" | aws s3 cp - "$S3_PREFIX/last-restore-test" 2>/dev/null || true
  log "$1"
}

cleanup() {
  local rc=$?
  if [ "$rc" -ne 0 ] && [ "$RESULT_SET" -eq 0 ]; then
    result "FAIL: abortou (rc=$rc)"
  fi
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

# pg: SEM -i (chamado dentro de while-read; -i consumiria o stream do loop).
# pg_in: COM -i, só para comandos que recebem dados por stdin (pg_restore < dump).
pg() { docker exec "$NAME" "$@" </dev/null; }
pg_in() { docker exec -i "$NAME" "$@"; }

LATEST=$(aws s3 ls "$S3_PREFIX/daily/" | awk '{print $2}' | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}/$' | sort | tail -1 | tr -d '/')
[ -n "$LATEST" ] || { result "FAIL: nenhum backup em $S3_PREFIX/daily/"; exit 1; }
log "backup mais recente: $LATEST"

aws s3 cp "$S3_PREFIX/daily/$LATEST/" "$WORKDIR/" --recursive --only-show-errors
( cd "$WORKDIR" && sha256sum -c --quiet SHA256SUMS ) || { result "FAIL: sha256 divergente em $LATEST"; exit 1; }
log "sha256 íntegro"

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -p "127.0.0.1:$PORT:5432" \
  -e POSTGRES_PASSWORD="restore-test-$(date +%s)" "$IMAGE" >/dev/null
for _ in $(seq 1 30); do
  pg pg_isready -U postgres -q 2>/dev/null && break
  sleep 2
done
pg pg_isready -U postgres -q || { result "FAIL: container efêmero não subiu"; exit 1; }

for role in $PRECREATE_ROLES; do
  pg psql -U postgres -q -c "CREATE ROLE \"$role\" NOLOGIN" 2>/dev/null || true
done

for dump in "$WORKDIR"/*.dump; do
  db=$(basename "$dump" .dump)
  target="restore_$db"
  log "restaurando $db → $target"
  pg psql -U postgres -q -c "CREATE DATABASE \"$target\""
  pg_in pg_restore -U postgres -d "$target" --no-owner < "$dump" \
    || { log "FALHA no pg_restore de $db"; FAILURES=$((FAILURES + 1)); continue; }

  manifest="$WORKDIR/$db.manifest.tsv"
  [ -f "$manifest" ] || { log "manifesto de $db ausente"; FAILURES=$((FAILURES + 1)); continue; }
  while IFS=$'\t' read -r sch tbl _bytes rows; do
    case "$sch" in \#*|schema|"") continue ;; esac
    [ "$rows" = "erro" ] && continue
    actual=$(pg psql -U postgres -d "$target" -tA -c "SELECT count(*) FROM \"$sch\".\"$tbl\"" 2>/dev/null || echo "ERRO")
    if [ "$actual" = "$rows" ]; then
      :
    elif [ "$actual" != "ERRO" ] && [ "$actual" -gt "$rows" ] 2>/dev/null; then
      log "drift tolerado $db $sch.$tbl: manifesto=$rows restaurado=$actual (origem viva)"
      DRIFTS=$((DRIFTS + 1))
    else
      log "MISMATCH $db $sch.$tbl: manifesto=$rows restaurado=$actual"
      FAILURES=$((FAILURES + 1))
    fi
  done < "$manifest"
done

# pgvector funcional no restaurado
DIST=$(pg psql -U postgres -tA -c "CREATE EXTENSION IF NOT EXISTS vector" -c "SELECT '[1,2,3]'::vector <-> '[1,2,4]'::vector" | tail -1)
if [ "$DIST" = "1" ]; then
  log "pgvector ok (distância L2 = $DIST)"
else
  log "FALHA no pgvector (resultado: '$DIST')"
  FAILURES=$((FAILURES + 1))
fi

if [ "$FAILURES" -eq 0 ]; then
  result "PASS: backup $LATEST restaurável ($(ls "$WORKDIR"/*.dump | wc -l | tr -d ' ') db(s), $DRIFTS drift(s) tolerado(s))"
else
  result "FAIL: backup $LATEST com $FAILURES falha(s)"
  exit 1
fi
