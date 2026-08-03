-- Migration 0022: RAG com pgvector (ADR-028) — generaliza `conhecimento` num
-- chunk store doctor-facing, retrieval-only.
--   A (base de conhecimento): paciente_id NULL. Catálogo `medicamentos` indexado
--     sob o tenant SENTINELA global (todos-zeros) — só dado de REFERÊNCIA não-PII
--     pode usar o sentinela.
--   B (prontuário): paciente_id preenchido. tenant_id = medico_responsavel_id.
--
-- LGPD (regra clínica #4): embedding de Cohere ML v3 roda on-demand IN-REGION
-- (sa-east-1). Para fontes clínicas sensíveis (ADR-018), guarda-se SÓ o vetor +
-- ponteiro (fonte_tipo, fonte_id); `conteudo` fica NULL e o texto é re-buscado e
-- decifrado no read. `conhecimento` NÃO é trilha de auditoria — pode sofrer
-- UPDATE/DELETE no reindex (diferente de protocolos_crise_acionados etc.).
--
-- Dimensão: 1536 → 1024 (Cohere ML v3). Tabela está vazia, então o ALTER TYPE
-- não recasta dado algum.
--
-- Aplicar: psql $POSTGRES_DSN_URL -f infra/migrations/0022_rag_chunks.sql

-- 1) Redimensiona o vetor para o modelo in-region (Cohere ML v3 = 1024).
ALTER TABLE conhecimento ALTER COLUMN embedding TYPE vector(1024);

-- 2) `conteudo` deixa de ser obrigatório: fontes sensíveis guardam ponteiro, não texto.
ALTER TABLE conhecimento ALTER COLUMN conteudo DROP NOT NULL;

-- 3) Procedência do chunk + metadados de indexação.
ALTER TABLE conhecimento
    ADD COLUMN IF NOT EXISTS paciente_id   UUID REFERENCES clientes(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS fonte_tipo    TEXT NOT NULL DEFAULT 'manual',
        -- 'medicamento' | 'mensagem' | 'diario' | 'sintoma' | 'evento' | 'consulta' | 'manual'
    ADD COLUMN IF NOT EXISTS fonte_id      UUID,
    ADD COLUMN IF NOT EXISTS chunk_idx     INT  NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS modelo_embed  TEXT NOT NULL DEFAULT 'cohere.embed-multilingual-v3',
    ADD COLUMN IF NOT EXISTS fonte_hash    TEXT,   -- hash do texto-fonte p/ reindex incremental
    ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 4) Idempotência da indexação: um chunk por (tenant, fonte, posição).
--    Permite ON CONFLICT no upsert e evita re-embed duplicado.
CREATE UNIQUE INDEX IF NOT EXISTS conhecimento_fonte_uq
    ON conhecimento(tenant_id, fonte_tipo, fonte_id, chunk_idx)
    WHERE fonte_id IS NOT NULL;

-- 5) Filtro de tenant (+ paciente) SEMPRE antes do KNN (regra clínica #4).
CREATE INDEX IF NOT EXISTS conhecimento_tenant_pac_idx
    ON conhecimento(tenant_id, paciente_id);

-- 6) KNN aproximado por distância de cosseno.
--    Requer pgvector >= 0.5.0. Se o RDS tiver pgvector antigo, troque por:
--      CREATE INDEX conhecimento_embedding_ivf ON conhecimento
--        USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS conhecimento_embedding_hnsw
    ON conhecimento USING hnsw (embedding vector_cosine_ops);
