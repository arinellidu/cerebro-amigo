-- =============================================================================
-- 0026 — Moderação da Rede Social — Onda 4
-- =============================================================================
--
-- Sistema de denúncias + ações de moderação. Regras:
--   - Qualquer médico verificado pode denunciar conteúdo.
--   - Só moderadores (social_moderadores) podem executar ações.
--   - social_moderacao_acoes é APPEND-ONLY (regra #5: nunca DELETE/UPDATE).
--   - Ações possíveis: ocultar, remover, avisar, banir_comunidade.
--
-- Aplicar: psql $POSTGRES_DSN_URL -f infra/migrations/0026_moderacao.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Moderadores da rede social (designados manualmente ou via admin).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_moderadores (
    medico_id  UUID PRIMARY KEY REFERENCES medicos(id) ON DELETE CASCADE,
    desde      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- Denúncias (reports) — qualquer médico verificado pode criar.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_denuncias (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    denunciante_id  UUID NOT NULL REFERENCES medicos(id) ON DELETE CASCADE,
    alvo_tipo       TEXT NOT NULL,        -- post | comentario | mensagem | perfil
    alvo_id         UUID NOT NULL,
    motivo          TEXT NOT NULL,        -- spam | assedio | pii_paciente | conduta_cfm | outro
    detalhes        TEXT,
    status          TEXT NOT NULL DEFAULT 'pendente',  -- pendente | aceita | rejeitada
    resolvido_por   UUID REFERENCES medicos(id),
    resolvido_em    TIMESTAMPTZ,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS social_denuncias_status_idx ON social_denuncias(status, criado_em DESC);
CREATE INDEX IF NOT EXISTS social_denuncias_alvo_idx ON social_denuncias(alvo_tipo, alvo_id);

-- -----------------------------------------------------------------------------
-- Ações de moderação — APPEND-ONLY (regra #5). Nunca DELETE/UPDATE nesta tabela.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_moderacao_acoes (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    moderador_id  UUID NOT NULL REFERENCES medicos(id),
    denuncia_id   UUID REFERENCES social_denuncias(id),
    alvo_tipo     TEXT NOT NULL,          -- post | comentario | mensagem | perfil
    alvo_id       UUID NOT NULL,
    acao          TEXT NOT NULL,          -- ocultar | remover | avisar | banir_comunidade
    motivo        TEXT,
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS social_moderacao_acoes_alvo_idx
    ON social_moderacao_acoes(alvo_tipo, alvo_id);
CREATE INDEX IF NOT EXISTS social_moderacao_acoes_moderador_idx
    ON social_moderacao_acoes(moderador_id, criado_em DESC);
