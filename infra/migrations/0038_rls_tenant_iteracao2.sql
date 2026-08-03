-- =============================================================================
-- 0038 — RLS de tenant, iteração 2 (Camada B / Estágio 2, continuação da 0037)
-- =============================================================================
--
-- A 0037 blindou as tabelas-folha com `paciente_id` (-> clientes.id). Faltaram:
--   - a conversa paciente↔IA (conversas/mensagens), que ancora por cliente_id e
--     conversa_id (2 e 3 hops, fora do padrão paciente_id da 0037);
--   - tabelas-folha que só foram criadas depois / passaram batido na 0037
--     (condutas_eventos, receitas_memed);
--   - trilhas com tenant DIRETO por medico_id (crise_alerta_eventos,
--     acessos_prontuario) — mesmo padrão de notificacoes_medico.
--
-- MECÂNICA: idêntica à 0037 (ver header lá). ENABLE (não FORCE): cerebroadmin
-- (dono) e cerebro_workers (BYPASSRLS — os 3 serviços Python, scans cross-tenant
-- legítimos do scheduler e do orchestrator) seguem livres; só cerebro_gateway
-- (NOBYPASSRLS) é filtrado pelas policies, com os GUCs que o TenantSessionMiddleware
-- seta por request (app.current_medico / app.current_paciente / app.tenant_bypass).
-- Sem GUC → ZERO linhas (fail-closed). NULLIF(...,'') trata o GUC vazio (reset).
--
-- FORA DE ESCOPO (decisões registradas na ADR-042 §Iteração 2):
--   - cobrancas: o webhook do Asaas (POST /api/v1/asaas/webhook, AllowAnonymous)
--     escreve SEM JWT → o middleware não setaria GUC → a RLS barraria o UPDATE de
--     pagamento. O isolamento de cobrança fica no WHERE da aplicação até o webhook
--     ganhar um bypass explícito (follow-up).
--   - social_* (rede médico↔médico): modelo de acesso distinto (não é tenant de
--     paciente); tratado à parte.
--   - Apertar o orchestrator-py de BYPASSRLS → role própria + set_config por
--     request: iteração 3 (refactor Python; queries do orchestrator já são todas
--     escopadas por paciente — ver recon ADR-042 §Iteração 2).
--
-- Idempotente.
-- =============================================================================

-- 1) Tabelas-folha clínicas com `paciente_id` que faltaram na 0037.
--    Mesma policy da 0037 (bypass OU paciente dono OU médico dono via pacientes).
DO $$
DECLARE
    t text;
    pred text;
    alvos text[] := ARRAY['condutas_eventos', 'receitas_memed'];
BEGIN
    pred := $p$
        current_setting('app.tenant_bypass', true) = 'on'
        OR paciente_id = NULLIF(current_setting('app.current_paciente', true), '')::uuid
        OR EXISTS (
            SELECT 1 FROM pacientes p
            WHERE p.cliente_id = paciente_id
              AND p.medico_responsavel_id = NULLIF(current_setting('app.current_medico', true), '')::uuid
        )
    $p$;

    FOREACH t IN ARRAY alvos LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_iso ON %I', t);
        EXECUTE format(
            'CREATE POLICY tenant_iso ON %I FOR ALL USING (%s) WITH CHECK (%s)',
            t, pred, pred);
    END LOOP;
END
$$;

-- 2) conversas: NÃO tem paciente_id; ancora por cliente_id (= clientes.id, igual
--    ao que o portal coloca em app.current_paciente). 2-hop p/ o médico via
--    pacientes. Qualifica `conversas.cliente_id` (pacientes também tem cliente_id).
ALTER TABLE conversas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_iso ON conversas;
CREATE POLICY tenant_iso ON conversas FOR ALL
    USING (
        current_setting('app.tenant_bypass', true) = 'on'
        OR conversas.cliente_id = NULLIF(current_setting('app.current_paciente', true), '')::uuid
        OR EXISTS (
            SELECT 1 FROM pacientes p
            WHERE p.cliente_id = conversas.cliente_id
              AND p.medico_responsavel_id = NULLIF(current_setting('app.current_medico', true), '')::uuid
        )
    )
    WITH CHECK (
        current_setting('app.tenant_bypass', true) = 'on'
        OR conversas.cliente_id = NULLIF(current_setting('app.current_paciente', true), '')::uuid
        OR EXISTS (
            SELECT 1 FROM pacientes p
            WHERE p.cliente_id = conversas.cliente_id
              AND p.medico_responsavel_id = NULLIF(current_setting('app.current_medico', true), '')::uuid
        )
    );

-- 3) mensagens: sem coluna de tenant própria; ancora via conversa_id -> conversas
--    (3-hop). Reusa a regra de visibilidade da conversa numa subquery.
ALTER TABLE mensagens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_iso ON mensagens;
CREATE POLICY tenant_iso ON mensagens FOR ALL
    USING (
        current_setting('app.tenant_bypass', true) = 'on'
        OR EXISTS (
            SELECT 1 FROM conversas c
            WHERE c.id = mensagens.conversa_id
              AND (
                  c.cliente_id = NULLIF(current_setting('app.current_paciente', true), '')::uuid
                  OR EXISTS (
                      SELECT 1 FROM pacientes p
                      WHERE p.cliente_id = c.cliente_id
                        AND p.medico_responsavel_id = NULLIF(current_setting('app.current_medico', true), '')::uuid
                  )
              )
        )
    )
    WITH CHECK (
        current_setting('app.tenant_bypass', true) = 'on'
        OR EXISTS (
            SELECT 1 FROM conversas c
            WHERE c.id = mensagens.conversa_id
              AND (
                  c.cliente_id = NULLIF(current_setting('app.current_paciente', true), '')::uuid
                  OR EXISTS (
                      SELECT 1 FROM pacientes p
                      WHERE p.cliente_id = c.cliente_id
                        AND p.medico_responsavel_id = NULLIF(current_setting('app.current_medico', true), '')::uuid
                  )
              )
        )
    );

-- 4) Trilhas com tenant DIRETO por medico_id (mesma policy de notificacoes_medico).
--    crise_alerta_eventos.medico_id é NULLABLE: linha sem médico (crise sem
--    responsável resolvido) fica visível só a bypass — fail-closed, nenhum médico
--    a vê por engano. O ack do gateway (CriseEndpoints) insere medico_id = médico
--    do JWT (= app.current_medico) → passa o WITH CHECK. notifier/orchestrator
--    escrevem como cerebro_workers (BYPASSRLS) → policy não se aplica (watchdog ok).
DO $$
DECLARE
    t text;
    pred text;
    alvos text[] := ARRAY['crise_alerta_eventos', 'acessos_prontuario'];
BEGIN
    pred := $p$
        current_setting('app.tenant_bypass', true) = 'on'
        OR medico_id = NULLIF(current_setting('app.current_medico', true), '')::uuid
    $p$;

    FOREACH t IN ARRAY alvos LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_iso ON %I', t);
        EXECUTE format(
            'CREATE POLICY tenant_iso ON %I FOR ALL USING (%s) WITH CHECK (%s)',
            t, pred, pred);
    END LOOP;
END
$$;

-- NOTA: crise_alerta_eventos, condutas_eventos e acessos_prontuario são
-- append-only (triggers de imutabilidade dos 0035/0011/0032). RLS é ortogonal:
-- controla QUEM vê/insere por tenant; o trigger barra UPDATE/DELETE da trilha.
