-- =============================================================================
-- 0025 — Chat da Rede Social (DM + grupos) — Onda 2
-- =============================================================================
--
-- Chat em tempo real entre médicos verificados. Suporta:
--   - DM (1:1): tipo = 'dm'
--   - Grupo: tipo = 'grupo' (nome obrigatório, múltiplos membros)
--
-- Regras:
--   - Só médico com crm_situacao = 'Regular' pode enviar (gate na app).
--   - Mensagens NÃO são logadas em aplicação (LGPD).
--   - PII guard aplica antes de INSERT (mesmo guard do feed).
--
-- Aplicar: psql $POSTGRES_DSN_URL -f infra/migrations/0025_chat.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Conversas (DM ou grupo).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_conversas (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo        TEXT NOT NULL DEFAULT 'dm',  -- dm | grupo
    nome        TEXT,                        -- NULL para DM; obrigatório para grupo
    foto_url    TEXT,
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- Membros de cada conversa.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_conversa_membros (
    conversa_id       UUID NOT NULL REFERENCES social_conversas(id) ON DELETE CASCADE,
    medico_id         UUID NOT NULL REFERENCES medicos(id) ON DELETE CASCADE,
    role              TEXT NOT NULL DEFAULT 'membro',  -- membro | admin
    entrou_em         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ultima_leitura_em TIMESTAMPTZ,
    PRIMARY KEY (conversa_id, medico_id)
);
CREATE INDEX IF NOT EXISTS social_conversa_membros_medico_idx
    ON social_conversa_membros(medico_id);

-- -----------------------------------------------------------------------------
-- Mensagens.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_mensagens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversa_id     UUID NOT NULL REFERENCES social_conversas(id) ON DELETE CASCADE,
    autor_medico_id UUID NOT NULL REFERENCES medicos(id) ON DELETE CASCADE,
    corpo           TEXT NOT NULL,
    tipo_conteudo   TEXT NOT NULL DEFAULT 'texto',  -- texto | imagem | arquivo (futuro)
    status          TEXT NOT NULL DEFAULT 'ativo',  -- ativo | removido
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS social_mensagens_conversa_idx
    ON social_mensagens(conversa_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS social_mensagens_autor_idx
    ON social_mensagens(autor_medico_id);
