-- =============================================================================
-- 0015: tokens de convite para médicos (onboarding via /admin/financeiro).
--
-- O owner convida um médico → gateway gera um token seguro, envia email com
-- link /ativar-conta?token=TOKEN. Médico clica, cria senha → conta ativada.
-- Token é usado uma vez, expira em 24h (deletar via cron futuro, ou deixar).
-- =============================================================================

CREATE TABLE medico_invite_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id  UUID NOT NULL REFERENCES usuarios(id),
    token_hash  TEXT UNIQUE NOT NULL,
    expira_em   TIMESTAMPTZ NOT NULL,
    usado_em    TIMESTAMPTZ,
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX medico_invite_tokens_usuario_idx ON medico_invite_tokens(usuario_id);
