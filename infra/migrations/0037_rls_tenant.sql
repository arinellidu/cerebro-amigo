-- =============================================================================
-- 0037 — Row Level Security (Camada B / Estágio 2 do isolamento de tenant)
-- =============================================================================
--
-- Rede fail-closed no banco: mesmo que um WHERE de tenant seja esquecido na
-- aplicação (foi o modo de falha dos 7 IDOR de 2026-06-08), o Postgres não
-- entrega linha de outro tenant para o role do gateway.
--
-- MECÂNICA:
--   - ENABLE (NÃO force): o dono (cerebroadmin) e roles BYPASSRLS (cerebro_workers,
--     que faz os scans cross-tenant dos serviços Python) seguem sem restrição.
--     Só cerebro_gateway (NOSUPERUSER, NOBYPASSRLS — pré-req aplicado na 0036 +
--     swap de DSN) é FILTRADO pelas policies.
--   - O gateway seta, por request, GUCs de sessão na conexão (middleware
--     TenantSessionMiddleware): app.current_medico (médico do JWT),
--     app.current_paciente (sessão do portal) ou app.tenant_bypass=on
--     (owner/admin, leitura cross-tenant legítima do painel).
--   - Sem GUC setado → todas as cláusulas dão NULL/false → ZERO linhas (fail-closed).
--   - NULLIF(...,'') protege contra GUC vazio (reset) que estouraria o ::uuid.
--
-- ESCOPO (iteração 1): tabelas-folha clínicas. NÃO inclui as tabelas que DEFINEM
-- o tenant (medicos, pacientes, clientes, usuarios) — elas são lidas para
-- ESTABELECER o tenant (o próprio middleware resolve o médico ali), então não
-- podem se auto-filtrar. Também fora: auth/webhook (magic_links, credenciais,
-- cobrancas) e catálogos globais.
--
-- Idempotente.
-- =============================================================================

-- Tabelas-folha clínicas com coluna paciente_id (-> clientes.id -> pacientes).
-- Policy: bypass admin OU paciente dono (portal) OU médico dono (via pacientes).
DO $$
DECLARE
    t text;
    pred text;
    alvos text[] := ARRAY[
        'prescricoes', 'prescricao_eventos', 'sintomas', 'eventos',
        'tomadas_medicacao', 'consultas', 'questionarios_respostas',
        'diario_entradas', 'checkins', 'insights', 'evolucoes_clinicas',
        'consulta_transcricoes', 'exames_agenda', 'receita_renovacoes',
        'condutas_automacao', 'protocolos_crise_acionados'
    ];
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

-- notificacoes_medico: tenant DIRETO via medico_id (NOT NULL). Sem dimensão paciente.
ALTER TABLE notificacoes_medico ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_iso ON notificacoes_medico;
CREATE POLICY tenant_iso ON notificacoes_medico FOR ALL
    USING (
        current_setting('app.tenant_bypass', true) = 'on'
        OR medico_id = NULLIF(current_setting('app.current_medico', true), '')::uuid
    )
    WITH CHECK (
        current_setting('app.tenant_bypass', true) = 'on'
        OR medico_id = NULLIF(current_setting('app.current_medico', true), '')::uuid
    );

-- NOTA: as tabelas append-only (protocolos_crise_acionados, etc.) seguem com os
-- triggers de imutabilidade (0007/...) ALÉM da RLS — RLS controla QUEM vê/escreve
-- por tenant; o trigger impede UPDATE/DELETE da trilha. Camadas ortogonais.
