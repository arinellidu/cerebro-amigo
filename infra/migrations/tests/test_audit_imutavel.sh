#!/usr/bin/env bash
# Verifica a migration 0007 (imutabilidade do audit trail) num Postgres EFÊMERO.
# Não toca em nenhum banco real — sobe um container Postgres descartável, aplica
# só os triggers sobre tabelas mínimas e assere o comportamento append-only.
#
# Uso:   bash infra/migrations/tests/test_audit_imutavel.sh
# Requer: Docker em execução.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
MIGRATION="$ROOT/infra/migrations/0007_audit_trail_imutavel.sql"
CONTAINER="ca_audit_pg_test_$$"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "[setup] subindo Postgres efêmero ($CONTAINER)"
docker run -d --rm --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=test -e POSTGRES_DB=audit_test \
  postgres:16-alpine >/dev/null
for i in $(seq 1 30); do
  docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done

psql() { docker exec -i "$CONTAINER" psql -U postgres -d audit_test -v ON_ERROR_STOP=1 -qtAX "$@"; }

echo "[setup] tabelas mínimas + migration 0007"
psql <<'SQL' >/dev/null
CREATE TABLE protocolos_crise_acionados (id serial PRIMARY KEY, gatilho text, criado_em timestamptz DEFAULT now());
CREATE TABLE notificacoes_medico (id serial PRIMARY KEY, titulo text, mensagem text, lida bool DEFAULT false, lida_em timestamptz, criada_em timestamptz DEFAULT now());
CREATE TABLE agente_execucoes (id serial PRIMARY KEY, agente text, iniciado_em timestamptz DEFAULT now(), metadata jsonb, concluido_em timestamptz, sucesso bool, erro text, insight_id int, tokens_in int, tokens_out int, custo_usd numeric, modelo text);
SQL
docker cp "$MIGRATION" "$CONTAINER:/tmp/0007.sql" >/dev/null
psql -f /tmp/0007.sql >/dev/null 2>&1

psql <<'SQL' >/dev/null
INSERT INTO protocolos_crise_acionados (gatilho) VALUES ('ideacao_ativa');
INSERT INTO notificacoes_medico (titulo, mensagem) VALUES ('crise', 'paciente em risco');
INSERT INTO agente_execucoes (agente, metadata) VALUES ('adesao', '{"janela":7}');
SQL

PASS=0; FAIL=0
expect_ok()   { if psql -c "$2" >/dev/null 2>&1; then echo "  PASS  $1"; PASS=$((PASS+1)); else echo "  FAIL  $1 (esperava sucesso)"; FAIL=$((FAIL+1)); fi; }
expect_fail() { if psql -c "$2" >/dev/null 2>&1; then echo "  FAIL  $1 (esperava bloqueio)"; FAIL=$((FAIL+1)); else echo "  PASS  $1"; PASS=$((PASS+1)); fi; }

echo "[protocolos_crise_acionados — append-only total]"
expect_ok   "INSERT permitido"            "INSERT INTO protocolos_crise_acionados (gatilho) VALUES ('plano');"
expect_fail "UPDATE bloqueado"            "UPDATE protocolos_crise_acionados SET gatilho='x' WHERE id=1;"
expect_fail "DELETE bloqueado"            "DELETE FROM protocolos_crise_acionados WHERE id=1;"

echo "[notificacoes_medico — só lida/lida_em mutáveis]"
expect_ok   "UPDATE lida permitido"       "UPDATE notificacoes_medico SET lida=true, lida_em=now() WHERE id=1;"
expect_fail "UPDATE conteúdo bloqueado"   "UPDATE notificacoes_medico SET mensagem='adulterado' WHERE id=1;"
expect_fail "DELETE bloqueado"            "DELETE FROM notificacoes_medico WHERE id=1;"

echo "[agente_execucoes — só ciclo de vida mutável]"
expect_ok   "UPDATE resultado permitido"  "UPDATE agente_execucoes SET concluido_em=now(), sucesso=true, tokens_in=10 WHERE id=1;"
expect_fail "UPDATE identidade bloqueado"  "UPDATE agente_execucoes SET agente='outro' WHERE id=1;"
expect_fail "UPDATE metadata bloqueado"    "UPDATE agente_execucoes SET metadata='{}'::jsonb WHERE id=1;"
expect_fail "DELETE bloqueado"             "DELETE FROM agente_execucoes WHERE id=1;"

echo
echo "Resultado: $PASS passaram, $FAIL falharam"
[ "$FAIL" -eq 0 ]
