-- Migration 0027: presença online da rede social (ADR-031).
-- Heartbeat REST: o cliente dá ping periódico (~30s); "online" = ping nos
-- últimos ~60s. Sem SignalR (o chat usa polling; presença idem). Só estado
-- volátil — 1 linha por médico, atualizada no ping.
-- Aplicar: psql $POSTGRES_DSN_URL -f infra/migrations/0027_social_presenca.sql

CREATE TABLE IF NOT EXISTS social_presenca (
    medico_id   UUID PRIMARY KEY REFERENCES medicos(id) ON DELETE CASCADE,
    ultimo_ping TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS social_presenca_ping_idx ON social_presenca(ultimo_ping);
