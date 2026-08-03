-- Migration 0019: lembretes de consulta (push/email pelo notifier-py)
-- Rastreia qual lembrete (antecedência) já foi enviado p/ cada consulta,
-- evitando duplicação. Append-only na prática (uma linha por consulta+tipo).
-- Aplicar: psql $POSTGRES_DSN_URL -f infra/migrations/0019_consulta_lembretes.sql

CREATE TABLE IF NOT EXISTS consulta_lembretes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consulta_id UUID NOT NULL REFERENCES consultas(id) ON DELETE CASCADE,
    tipo        TEXT NOT NULL,            -- '24h' | '1h' (antecedência)
    enviado_em  TIMESTAMPTZ,
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Dedup: no máximo um lembrete por (consulta, tipo).
CREATE UNIQUE INDEX IF NOT EXISTS consulta_lembretes_unico_idx
    ON consulta_lembretes(consulta_id, tipo);
