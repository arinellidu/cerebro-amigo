-- =============================================================================
-- 0036 — Roles least-privilege (Camada B / Estágio 0 do isolamento de tenant)
-- =============================================================================
--
-- Contexto (auditoria 2026-06-08, ver memória project-tenant-isolation):
-- HOJE todos os serviços conectam no RDS como `cerebroadmin` (RDS master =
-- rds_superuser E DONO de todas as tabelas). Isso é o pior cenário para RLS:
--   - dono de tabela BYPASSA RLS (mesmo com policy), salvo FORCE ROW LEVEL SECURITY;
--   - rds_superuser tem privilégio amplo → blast radius enorme se a credencial vazar.
-- Logo, antes de qualquer policy RLS valer, é PRÉ-REQUISITO que o serviço exposto
-- (gateway) conecte com um role NÃO-superuser e NÃO-dono. Esta migration cria os
-- roles; a TROCA do DSN é feita no runbook (docs/runbooks/swap-db-roles.md), com
-- rollback instantâneo (voltar o DSN para cerebroadmin).
--
-- DESENHO:
--   cerebro_gateway  — NOSUPERUSER, NOBYPASSRLS. Conecta o api-gateway (.NET).
--                      É a fronteira de enforcement: recebe id não-confiável do
--                      cliente. Quando o RLS (Estágio 2) for habilitado, as policies
--                      VALEM para este role.
--   cerebro_workers  — NOSUPERUSER, BYPASSRLS. Conecta os 3 serviços Python
--                      (agents-py / notifier-py / orchestrator-py). agents e notifier
--                      varrem TODOS os tenants por design (scheduler global); são
--                      internos (gate INTERNAL_API_TOKEN), sem input não-confiável.
--                      BYPASSRLS é explícito e auditável aqui. (Apertar o orchestrator
--                      para SET app.current_medico por request fica para o Estágio 2.)
--
-- SEGURANÇA: os roles são criados SEM senha → NÃO conseguem logar (RDS exige
-- auth por senha no pg_hba). Portanto esta migration é NÃO-DISRUPTIVA: nada passa
-- a usá-los até o runbook (1) setar a senha via `ALTER ROLE ... PASSWORD` (fora do
-- git, via SSM) e (2) trocar o DSN do serviço. Aplicar esta migration sozinha não
-- muda o comportamento de nenhum serviço.
--
-- Idempotente: pode rodar mais de uma vez.
-- =============================================================================

-- ── Roles (sem LOGIN efetivo até o runbook setar a senha) ──
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cerebro_gateway') THEN
        CREATE ROLE cerebro_gateway WITH
            LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION
            CONNECTION LIMIT 50;
    ELSE
        ALTER ROLE cerebro_gateway WITH
            LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cerebro_workers') THEN
        CREATE ROLE cerebro_workers WITH
            LOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION
            CONNECTION LIMIT 50;
    ELSE
        ALTER ROLE cerebro_workers WITH
            LOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
    END IF;
END
$$;

-- ── Privilégios sobre o schema atual (tabelas/sequences/funcs já existentes) ──
GRANT USAGE ON SCHEMA public TO cerebro_gateway, cerebro_workers;

-- cerebro_workers precisa CREATE no schema: o orchestrator-py usa o checkpointer
-- do LangGraph (AsyncPostgresSaver.setup()), que cria/mantém as tabelas de
-- checkpoint em runtime. O gateway NÃO cria tabelas (migrations são aplicadas por
-- cerebroadmin) → fica SEM CREATE (least-privilege).
GRANT CREATE ON SCHEMA public TO cerebro_workers;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
    TO cerebro_gateway, cerebro_workers;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public
    TO cerebro_gateway, cerebro_workers;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public
    TO cerebro_gateway, cerebro_workers;

-- ── Privilégios DEFAULT para tabelas/sequences/funcs criadas no FUTURO ──
-- As próximas migrations são aplicadas por cerebroadmin (dono). Sem isto, cada
-- migration nova exigiria re-GRANT manual ou o serviço quebraria na tabela nova.
ALTER DEFAULT PRIVILEGES FOR ROLE cerebroadmin IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cerebro_gateway, cerebro_workers;
ALTER DEFAULT PRIVILEGES FOR ROLE cerebroadmin IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO cerebro_gateway, cerebro_workers;
ALTER DEFAULT PRIVILEGES FOR ROLE cerebroadmin IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO cerebro_gateway, cerebro_workers;

-- NOTA: as trilhas append-only (protocolos_crise_acionados, notificacoes_medico,
-- agente_execucoes, acessos_prontuario, solicitacoes_titular, crise_alerta_eventos)
-- continuam protegidas pelos triggers de imutabilidade (0007/0032/0033/0035), que
-- valem para QUALQUER role. O GRANT de UPDATE/DELETE aqui não fura isso — o trigger
-- rejeita. Apertar (revogar DELETE onde não há trigger) é follow-up do Estágio 2.
