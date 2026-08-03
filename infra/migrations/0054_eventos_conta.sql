-- =============================================================================
-- 0054: trilha de auditoria das ações sensíveis de conta do médico (ADR-066 review).
--
-- Append-only. Registra: troca de senha (logado), redefinição de senha (reset),
-- exportação de dados e solicitação de exclusão (LGPD art.37 — operações de
-- tratamento de dados precisam ser rastreáveis para defesa em incidente).
--
-- SEM RLS de tenant: é log de identidade/segurança (como `usuarios`/`assinaturas`),
-- escrito por ações do próprio usuário; o gateway só recebe INSERT (sem UPDATE/DELETE)
-- para reforçar a imutabilidade. Aditivo + idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS eventos_conta (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id  UUID        NOT NULL,
    medico_id   UUID,
    acao        TEXT        NOT NULL,  -- senha_alterada | senha_redefinida | dados_exportados | exclusao_solicitada
    ip          TEXT,
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eventos_conta_usuario
    ON eventos_conta (usuario_id, criado_em DESC);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cerebro_gateway') THEN
        -- Só INSERT/SELECT (append-only): o gateway não atualiza nem apaga auditoria.
        GRANT SELECT, INSERT ON eventos_conta TO cerebro_gateway;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cerebro_workers') THEN
        GRANT ALL ON eventos_conta TO cerebro_workers;
    END IF;
END
$$;

COMMENT ON TABLE eventos_conta IS
  'ADR-066: auditoria append-only de acoes sensiveis de conta do medico (senha/export/exclusao; LGPD art.37). Sem RLS (identidade/seguranca).';
