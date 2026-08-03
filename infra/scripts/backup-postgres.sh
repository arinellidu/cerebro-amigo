#!/usr/bin/env bash
# Backup do Postgres → S3 (ADR-077): pg_dump -Fc por database + manifesto + sha256.
#
# Uso: backup-postgres.sh <DSN> <s3-prefix>
#   DSN: URL (postgresql://user:senha@host:5432/db — senha percent-encoded) OU
#        keyword (host=... port=... user=... password=... dbname=... — sem encoding).
#        O database inicial é só o de conexão — TODOS os não-template visíveis
#        são dumpados.
#   s3-prefix: s3://bucket/postgres  (sem barra final)
#
# Reusável para o dump do RDS na migração (runbook 01 Fase 1) — mesma interface.
#
# As ferramentas pg (pg_dump/psql) rodam DENTRO do container postgres do compose
# (env PG_CONTAINER, default cerebro-amigo-v3-postgres-1) — o host não tem client
# postgres. O AWS CLI roda no host (instance profile, policy CerebroAmigoDbBackupsS3).
#
# Layout no S3:  <prefix>/daily/YYYY-MM-DD/{<db>.dump,<db>.manifest.tsv,
#                <db>.schemaversions.txt,SHA256SUMS}
#                domingo: cópia server-side para <prefix>/weekly/YYYY-MM-DD/
#                (lifecycle: daily 30d, weekly 90d)
#
# Observabilidade (pluga no alerta P7):
#   falha   → exit != 0 + /var/lib/cerebro-backup/last-error + <prefix>/last-error
#   sucesso → <prefix>/last-success com timestamp + remove marcador local
#
# Agendamento: systemd timer cerebro-db-backup.timer (infra/systemd/), diário 03:30
# America/Sao_Paulo. Instalação: ver infra/systemd/README.md.
set -euo pipefail

DSN="${1:?uso: backup-postgres.sh <DSN-url> <s3-prefix>}"
S3_PREFIX="${2:?uso: backup-postgres.sh <DSN-url> <s3-prefix>}"
S3_PREFIX="${S3_PREFIX%/}"
PG_CONTAINER="${PG_CONTAINER:-cerebro-amigo-v3-postgres-1}"
# PG_DUMP_EXTRA_FLAGS: flags extras pro pg_dump (ex.: migração RDS usa
#   "--no-owner --no-acl --exclude-schema=checkup"). Default vazio = backup
#   diário completo com owners/ACLs.
PG_DUMP_EXTRA_FLAGS="${PG_DUMP_EXTRA_FLAGS:-}"
# BACKUP_ONLY_DBS: lista explícita de databases (separados por espaço); vazio =
#   autodescoberta. Necessário quando a role não lê algum db visível (ex.: V2).
BACKUP_ONLY_DBS="${BACKUP_ONLY_DBS:-}"
STATE_DIR="/var/lib/cerebro-backup"
STAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
DAY=$(date -u +%F)
WORKDIR=$(mktemp -d /tmp/pg-backup.XXXXXX)
MARKED=0

log() { echo "[backup-postgres] $*"; }

fail_marker() {
  MARKED=1
  mkdir -p "$STATE_DIR"
  echo "$STAMP $1" > "$STATE_DIR/last-error"
  echo "$STAMP $1" | aws s3 cp - "$S3_PREFIX/last-error" 2>/dev/null || true
  log "FALHA: $1"
}

on_exit() {
  local rc=$?
  if [ "$rc" -ne 0 ] && [ "$MARKED" -eq 0 ]; then
    fail_marker "backup abortou (rc=$rc)"
  fi
  rm -rf "$WORKDIR"
}
trap on_exit EXIT

# SEM -i: psql -c não lê stdin, e um exec interativo dentro de while-read
# consome o stream do loop (bug real: manifesto truncado na 1ª tabela).
psql_c() { docker exec "$PG_CONTAINER" psql "$1" -tA -v ON_ERROR_STOP=1 -c "$2" </dev/null; }

# troca o database da DSN (URL: path; keyword: token dbname=)
dsn_for() {
  local db="$1" core qs=""
  if [[ "$DSN" == postgresql://* || "$DSN" == postgres://* ]]; then
    core="${DSN%%\?*}"
    [ "$core" != "$DSN" ] && qs="?${DSN#*\?}"
    echo "${core%/*}/${db}${qs}"
  else
    echo "$(echo "$DSN" | sed -E 's/(^| )dbname=[^ ]*//g') dbname=${db}"
  fi
}

if [ -n "$BACKUP_ONLY_DBS" ]; then
  DBS="$BACKUP_ONLY_DBS"
  psql_c "$DSN" "SELECT 1" >/dev/null || { fail_marker "não conectou na origem"; exit 1; }
else
  DBS=$(psql_c "$DSN" "SELECT datname FROM pg_database WHERE NOT datistemplate AND datname <> 'rdsadmin' AND has_database_privilege(current_user, datname, 'CONNECT') ORDER BY 1") \
    || { fail_marker "não conectou na origem"; exit 1; }
fi
[ -n "$DBS" ] || { fail_marker "nenhum database visível na origem"; exit 1; }
log "databases: $(echo $DBS | tr '\n' ' ')"

for db in $DBS; do
  d=$(dsn_for "$db")

  log "pg_dump -Fc $db ${PG_DUMP_EXTRA_FLAGS:+($PG_DUMP_EXTRA_FLAGS)}"
  # shellcheck disable=SC2086 — flags extras são para expandir por palavra
  docker exec "$PG_CONTAINER" pg_dump -Fc --no-password $PG_DUMP_EXTRA_FLAGS "$d" </dev/null > "$WORKDIR/$db.dump"

  # Manifesto: top 20 tabelas por tamanho + count exato (base da validação do
  # test-restore). Gerado logo APÓS o dump — em banco vivo insert-only o
  # restaurado pode ficar ≤ manifesto; o test-restore trata drift.
  {
    printf '# manifesto %s · %s · origem %s\n' "$db" "$STAMP" "${DSN##*@}"
    printf 'schema\ttable\tbytes\trows\n'
    psql_c "$d" "SELECT n.nspname||E'\t'||c.relname||E'\t'||pg_total_relation_size(c.oid) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog','information_schema') ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 20" \
    | while IFS=$'\t' read -r sch tbl bytes; do
        [ -n "$sch" ] || continue
        rows=$(psql_c "$d" "SELECT count(*) FROM \"$sch\".\"$tbl\"" 2>/dev/null || echo "erro")
        printf '%s\t%s\t%s\t%s\n' "$sch" "$tbl" "$bytes" "$rows"
      done
  } > "$WORKDIR/$db.manifest.tsv"

  # SchemaVersions (DbUp) — últimas 5 entradas, se a tabela existir
  SV_REG=$(psql_c "$d" "SELECT COALESCE(to_regclass('public.\"SchemaVersions\"')::text, '')")
  if [ -n "$SV_REG" ]; then
    psql_c "$d" "SELECT * FROM public.\"SchemaVersions\" ORDER BY 1 DESC LIMIT 5" \
      > "$WORKDIR/$db.schemaversions.txt"
  else
    echo "(tabela SchemaVersions ausente neste database — migrations deste repo são SQL manual em infra/migrations/)" \
      > "$WORKDIR/$db.schemaversions.txt"
  fi
done

( cd "$WORKDIR" && sha256sum ./*.dump ./*.manifest.tsv ./*.schemaversions.txt > SHA256SUMS )

log "upload → $S3_PREFIX/daily/$DAY/"
aws s3 cp "$WORKDIR" "$S3_PREFIX/daily/$DAY/" --recursive --only-show-errors \
  || { fail_marker "upload S3 falhou"; exit 1; }

if [ "$(date -u +%u)" = "7" ]; then
  log "domingo — retenção estendida: cópia p/ weekly/$DAY/"
  aws s3 cp "$S3_PREFIX/daily/$DAY/" "$S3_PREFIX/weekly/$DAY/" --recursive --only-show-errors \
    || { fail_marker "cópia weekly falhou"; exit 1; }
fi

echo "$STAMP" | aws s3 cp - "$S3_PREFIX/last-success" --only-show-errors \
  || { fail_marker "gravação de last-success falhou"; exit 1; }
mkdir -p "$STATE_DIR"
rm -f "$STATE_DIR/last-error"
log "sucesso: $(echo $DBS | wc -w | tr -d ' ') database(s) em $S3_PREFIX/daily/$DAY/"
