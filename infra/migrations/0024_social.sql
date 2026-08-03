-- =============================================================================
-- 0024 — Rede Social Cérebro Amigo (médicos verificados) — Onda 0 + feed básico
-- =============================================================================
--
-- Rede social exclusiva para médicos verificados por CRM. Esta migration cobre:
--   - Perfil social (estende `medicos` sem poluir a tabela clínica)
--   - Grafo social (seguir/seguidores)
--   - Comunidades por especialidade/tema
--   - Feed: posts, comentários, reações, salvos
--
-- Regras de fronteira/segurança:
--   - Dados sociais ficam em tabelas `social_*`, SEGREGADAS do dado clínico.
--   - NUNCA armazenar PII de paciente aqui (regra reforçada na aplicação).
--   - Só médico com `medicos.crm_situacao = 'Regular'` pode escrever (gate na app).
--
-- Aplicar: psql $POSTGRES_DSN_URL -f infra/migrations/0024_social.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Perfil social — 1:1 com medicos. Criado sob demanda no primeiro acesso.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_perfis (
    medico_id    UUID PRIMARY KEY REFERENCES medicos(id) ON DELETE CASCADE,
    handle       TEXT UNIQUE NOT NULL,
    bio          TEXT,
    foto_url     TEXT,
    capa_url     TEXT,
    cidade       TEXT,
    instituicao  TEXT,
    links        JSONB NOT NULL DEFAULT '[]',
    visivel      BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- Grafo social — quem segue quem.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_follows (
    seguidor_id  UUID NOT NULL REFERENCES medicos(id) ON DELETE CASCADE,
    seguido_id   UUID NOT NULL REFERENCES medicos(id) ON DELETE CASCADE,
    criado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (seguidor_id, seguido_id),
    CHECK (seguidor_id <> seguido_id)
);
CREATE INDEX IF NOT EXISTS social_follows_seguido_idx ON social_follows(seguido_id);

-- -----------------------------------------------------------------------------
-- Comunidades — espaços por especialidade/tema.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_comunidades (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome          TEXT NOT NULL,
    slug          TEXT UNIQUE NOT NULL,
    descricao     TEXT,
    especialidade TEXT,
    ordem         INT NOT NULL DEFAULT 0,
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- Feed — posts.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_posts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    autor_medico_id UUID NOT NULL REFERENCES medicos(id) ON DELETE CASCADE,
    comunidade_id   UUID REFERENCES social_comunidades(id) ON DELETE SET NULL,
    corpo           TEXT NOT NULL,
    midias          JSONB NOT NULL DEFAULT '[]',
    status          TEXT NOT NULL DEFAULT 'ativo',  -- ativo | oculto | removido
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS social_posts_criado_idx ON social_posts(criado_em DESC);
CREATE INDEX IF NOT EXISTS social_posts_autor_idx ON social_posts(autor_medico_id);
CREATE INDEX IF NOT EXISTS social_posts_comunidade_idx ON social_posts(comunidade_id);

-- -----------------------------------------------------------------------------
-- Feed — comentários (threading simples via parent_id).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_comentarios (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id         UUID NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
    autor_medico_id UUID NOT NULL REFERENCES medicos(id) ON DELETE CASCADE,
    corpo           TEXT NOT NULL,
    parent_id       UUID REFERENCES social_comentarios(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'ativo',  -- ativo | oculto | removido
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS social_comentarios_post_idx ON social_comentarios(post_id, criado_em);

-- -----------------------------------------------------------------------------
-- Feed — reações (curtir / útil). Genérico via alvo_tipo + alvo_id.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_reacoes (
    alvo_tipo  TEXT NOT NULL,                 -- post | comentario
    alvo_id    UUID NOT NULL,
    medico_id  UUID NOT NULL REFERENCES medicos(id) ON DELETE CASCADE,
    tipo       TEXT NOT NULL DEFAULT 'curtir', -- curtir | util
    criado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (alvo_tipo, alvo_id, medico_id, tipo)
);
CREATE INDEX IF NOT EXISTS social_reacoes_alvo_idx ON social_reacoes(alvo_tipo, alvo_id);

-- -----------------------------------------------------------------------------
-- Feed — posts salvos por médico.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_salvos (
    medico_id  UUID NOT NULL REFERENCES medicos(id) ON DELETE CASCADE,
    post_id    UUID NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
    criado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (medico_id, post_id)
);

-- -----------------------------------------------------------------------------
-- Seed inicial de comunidades (idempotente).
-- -----------------------------------------------------------------------------
INSERT INTO social_comunidades (nome, slug, descricao, especialidade, ordem)
VALUES
    ('Psiquiatria',        'psiquiatria',  'Discussões clínicas e de manejo em psiquiatria.', 'psiquiatria', 1),
    ('Carreira',           'carreira',     'Carreira médica, residência, concursos e mercado.', NULL, 2),
    ('Gestão de Consultório', 'gestao',    'Gestão, finanças e operação do consultório.', NULL, 3),
    ('Bem-estar do Médico', 'bem-estar',   'Saúde mental e qualidade de vida do médico.', NULL, 4),
    ('Geral',              'geral',        'Conversa geral entre médicos verificados.', NULL, 5)
ON CONFLICT (slug) DO NOTHING;
