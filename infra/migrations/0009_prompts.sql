-- =============================================================================
-- 0009 — Tabela de prompts versionados (editor de prompts dos agentes)
-- =============================================================================
--
-- Permite que médicos (com permissão de admin) editem os prompts system
-- dos agentes e do orchestrator, com versionamento completo.
--
-- Cada alteração cria uma NOVA versão; a anterior é preservada para audit.
-- Apenas uma versão por (agente, nome) está ativa.
--
-- Aplicação: serviços Python buscam o prompt ativo do banco em vez de
-- hardcoded; fallback para o builtin se nenhum ativo no banco.

CREATE TABLE prompts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agente       TEXT NOT NULL,       -- 'orchestrator', 'resumo', 'adesao', etc.
    nome         TEXT NOT NULL,         -- 'crisis_detection', 'symptom_extraction', etc.
    versao       INT NOT NULL DEFAULT 1,
    conteudo     TEXT NOT NULL,        -- texto completo do prompt system
    ativo        BOOL NOT NULL DEFAULT FALSE,
    metadata     JSONB DEFAULT '{}',    -- {modelo, temperatura, max_tokens, etc.}
    criado_por   UUID REFERENCES usuarios(id),  -- médico que editou
    criado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Apenas uma versão ativa por (agente, nome)
    UNIQUE (agente, nome, versao)
);

CREATE UNIQUE INDEX prompts_ativo_idx ON prompts(agente, nome) WHERE ativo = TRUE;
CREATE INDEX prompts_agente_nome_idx ON prompts(agente, nome, criado_em DESC);

COMMENT ON TABLE prompts IS 'Prompts versionados dos agentes e do orchestrator. Edição via dashboard médico.';
