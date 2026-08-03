-- Migration 0021: teleconsulta por vídeo (WebRTC P2P) — estado + auditoria
-- Vídeo P2P: a mídia trafega E2E browser↔browser (DTLS-SRTP); o gateway só
-- intermedia a SINALIZAÇÃO. NÃO há gravação nesta fase (ADR-026) — nenhum
-- conteúdo clínico (áudio/vídeo) é armazenado. O escriba de consulta (S3)
-- tratará gravação no futuro, com consentimento e guard próprios.
-- Aplicar: psql $POSTGRES_DSN_URL -f infra/migrations/0021_teleconsulta_video.sql

-- Estado operacional da sala de vídeo de cada consulta (MUTÁVEL — reflete o
-- ciclo de vida da chamada, não é trilha de auditoria).
--   idle       sala nunca aberta
--   aguardando médico ou paciente entrou, esperando o outro
--   ativa      os dois conectados (peer-to-peer estabelecido)
--   encerrada  chamada finalizada
ALTER TABLE consultas
    ADD COLUMN IF NOT EXISTS video_status       TEXT NOT NULL DEFAULT 'idle',
    ADD COLUMN IF NOT EXISTS video_iniciada_em  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS video_encerrada_em TIMESTAMPTZ;

-- Trilha de auditoria da teleconsulta — APPEND-ONLY (regra clínica #5).
-- Nunca aplicar DELETE/UPDATE aqui. Registra o ciclo da sessão por ator.
-- NÃO contém conteúdo clínico nem SDP/ICE — somente metadados (quem, o quê,
-- quando), para prova de atendimento e investigação de falha de conexão.
CREATE TABLE IF NOT EXISTS consulta_video_eventos (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consulta_id UUID NOT NULL REFERENCES consultas(id) ON DELETE CASCADE,
    ator        TEXT NOT NULL,   -- 'medico' | 'paciente'
    evento      TEXT NOT NULL,   -- 'entrou' | 'saiu' | 'conectou' | 'encerrou' | 'falhou'
    detalhe     TEXT,            -- opcional, curto (ex.: motivo de falha) — sem PII
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS consulta_video_eventos_consulta_idx
    ON consulta_video_eventos(consulta_id, criado_em);
