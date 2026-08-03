#!/bin/bash
# Init/upgrade do banco clínico no box (ADR-079). Idempotente — roda a cada deploy.
# Cria roles least-privilege (senhas via SSM→.env), aplica migrations clínicas
# pendentes (controle em public.schema_migrations) e confere extensões.
# Migrations do schema `checkup` (0039/0040/0042/0044/0059/0061) NÃO entram aqui:
# o checkup tem banco próprio no box dele (ADR-078) — isolamento de dados.
set -euo pipefail
cd "$(dirname "$0")"
# O .env NÃO é sourceável: POSTGRES_DSN (formato Npgsql) contém `;`, que o shell
# interpreta como fim de comando. Extrai só as chaves necessárias.
env_val() { sed -n "s/^$1=//p" .env | head -1; }
DB_SUPERUSER_PASSWORD=$(env_val DB_SUPERUSER_PASSWORD)
DB_GATEWAY_PASSWORD=$(env_val DB_GATEWAY_PASSWORD)
DB_WORKERS_PASSWORD=$(env_val DB_WORKERS_PASSWORD)

# Todas as migrations clínicas, em ordem. Gap 0008 é histórico (nunca existiu).
MIGRATIONS=(
  0001_init.sql
  0002_fix_agente_execucoes.sql
  0003_add_automacao_pausada.sql
  0004_diario_audio.sql
  0005_align_agente_execucoes_sintomas.sql
  0006_crise_diario.sql
  0007_audit_trail_imutavel.sql
  0009_prompts.sql
  0010_admin.sql
  0011_conduta_automacao.sql
  0012_medico_config.sql
  0013_notificacao_entregas.sql
  0014_notificacoes_medico_metadata.sql
  0015_medico_invite_tokens.sql
  0016_memed.sql
  0017_crm_validacao.sql
  0018_agenda.sql
  0019_consulta_lembretes.sql
  0020_usuarios_desativado.sql
  0021_teleconsulta_video.sql
  0022_rag_chunks.sql
  0023_exames_monitoramento.sql
  0024_social.sql
  0025_chat.sql
  0026_moderacao.sql
  0027_social_presenca.sql
  0028_receita_renovacao.sql
  0029_interacao_catalogo.sql
  0030_monetizacao.sql
  0031_cobranca_medico_asaas.sql
  0032_acessos_prontuario.sql
  0033_solicitacoes_titular.sql
  0034_escriba_teleconsulta.sql
  0035_crise_alerta_eventos.sql
  0036_least_privilege_roles.sql
  0037_rls_tenant.sql
  0038_rls_tenant_iteracao2.sql
  0041_medicos_signup_attribution.sql
  0043_login_rate_limits.sql
  0045_assinatura_prazo_pagamento.sql
  0046_prescricoes_precisa_confirmar.sql
  0047_medicacoes_em_uso.sql
  0048_inbound_messages_v3.sql
  0049_inbound_messages_onconflict_fix.sql
  0050_mensagens_audio.sql
  0051_newsletter_inscricoes.sql
  0052_medico_documentos.sql
  0053_conta_extras.sql
  0054_eventos_conta.sql
  0055_token_version.sql
  0056_medicamentos_origem_anvisa.sql
  0056_paciente_perfil_contato.sql
  0057_medicacoes_em_uso_portal_read.sql
  0058_teleconsulta_link_expira.sql
  0060_escriba_presencial.sql
)

psql_db() {
  docker compose exec -T -e PGPASSWORD="${DB_SUPERUSER_PASSWORD}" postgres \
    psql -U postgres -d cerebro_v3 -v ON_ERROR_STOP=1 "$@"
}

# Aguarda o Postgres aceitar conexão
for i in $(seq 1 30); do
  docker compose exec -T postgres pg_isready -U postgres && break
  sleep 2
done

# Controle de migrations (a maioria das clínicas NÃO é idempotente — aplicar 1x).
psql_db <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename   TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
SQL

# As migrations foram escritas para rodar como `cerebroadmin` (master do RDS,
# dono de todos os objetos): 0036 declara ALTER DEFAULT PRIVILEGES FOR ROLE
# cerebroadmin, e ALTERs posteriores exigem ownership. No container o role não
# existe — cria NOLOGIN (ninguém conecta; é só executor/dono) e transfere o
# ownership do que já existir (idempotente: filtra owner='postgres').
psql_db <<'SQL'
DO $do$
BEGIN
  -- 0036 cria as roles de app, inclusive cerebro_workers BYPASSRLS — o criador
  -- precisa de CREATEROLE e BYPASSRLS (o master do RDS tinha ambos). NOLOGIN:
  -- ninguém conecta como cerebroadmin no box; é só executor/dono das migrations.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cerebroadmin') THEN
    CREATE ROLE cerebroadmin NOLOGIN CREATEROLE BYPASSRLS;
  ELSE
    ALTER ROLE cerebroadmin CREATEROLE BYPASSRLS;
  END IF;
END
$do$;
ALTER DATABASE cerebro_v3 OWNER TO cerebroadmin;
ALTER SCHEMA public OWNER TO cerebroadmin;
DO $do$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables
           WHERE schemaname='public' AND tableowner='postgres' LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO cerebroadmin', r.tablename);
  END LOOP;
  FOR r IN SELECT sequencename FROM pg_sequences
           WHERE schemaname='public' AND sequenceowner='postgres' LOOP
    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO cerebroadmin', r.sequencename);
  END LOOP;
  FOR r IN SELECT viewname FROM pg_views v JOIN pg_roles o ON o.rolname=v.viewowner
           WHERE schemaname='public' AND o.rolname='postgres' LOOP
    EXECUTE format('ALTER VIEW public.%I OWNER TO cerebroadmin', r.viewname);
  END LOOP;
  FOR r IN SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
           JOIN pg_roles o ON o.oid = p.proowner
           WHERE n.nspname='public' AND o.rolname='postgres'
             AND NOT EXISTS (SELECT 1 FROM pg_depend d
                             WHERE d.objid = p.oid AND d.deptype = 'e') LOOP
    EXECUTE format('ALTER FUNCTION public.%I(%s) OWNER TO cerebroadmin', r.proname, r.args);
  END LOOP;
END
$do$;
SQL

for m in "${MIGRATIONS[@]}"; do
  applied=$(psql_db -tA -c "SELECT 1 FROM schema_migrations WHERE filename = '${m}'")
  if [ "$applied" = "1" ]; then
    continue
  fi
  echo ">> aplicando ${m}"
  # SET ROLE cerebroadmin: objetos novos nascem com o dono certo e os DEFAULT
  # PRIVILEGES do 0036 se aplicam (mesma semântica do RDS).
  psql_db --single-transaction -c "SET ROLE cerebroadmin" -f /dev/stdin < "../migrations/${m}"
  psql_db -c "INSERT INTO schema_migrations (filename) VALUES ('${m}')"
done

# Senhas das roles de aplicação (0036 cria as roles SEM senha — não logam até aqui).
# cerebro_gateway: NOBYPASSRLS (fronteira de enforcement, RLS vale).
# cerebro_workers: BYPASSRLS (scheduler global; gate INTERNAL_API_TOKEN).
psql_db <<SQL
ALTER ROLE cerebro_gateway WITH LOGIN PASSWORD '${DB_GATEWAY_PASSWORD}';
ALTER ROLE cerebro_workers WITH LOGIN PASSWORD '${DB_WORKERS_PASSWORD}';
SQL

# Sanidade: extensões e RLS no lugar.
psql_db -c "SELECT extname FROM pg_extension ORDER BY 1"
psql_db -tA -c "SELECT count(*) FROM pg_policies" | xargs echo "policies RLS:"

echo "init-db OK"
