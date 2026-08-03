-- Migration 0040: checkup.rate_limits — rate limiting com estado no Postgres (CK-5).
-- Substitui o limitador in-memory (que zerava no restart e não escalava). Fixed-window
-- atômico via UPSERT. bucket = "<tipo>:<dimensão>:<chave>" (ex.: dev:ip:1.2.3.4).
-- Sem PII: o bucket guarda IP/sessão efêmeros, não identifica a pessoa.

CREATE TABLE IF NOT EXISTS checkup.rate_limits (
    bucket        TEXT        PRIMARY KEY,
    hits          INT         NOT NULL DEFAULT 0,
    window_start  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Limpeza de buckets antigos (janela máxima é 1 dia): pode rodar num job futuro.
-- DELETE FROM checkup.rate_limits WHERE window_start < NOW() - INTERVAL '2 days';
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON checkup.rate_limits (window_start);
