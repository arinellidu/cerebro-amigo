-- Migration 0044: Check-up longitudinal PSEUDONIMIZADO — ADR-050 Parte 2
-- Schema `checkup`. Measurement-based care público: re-rastreio opt-in + evolução do escore.
--
-- LGPD categoria especial (saúde mental). ATENÇÃO — diferença deliberada vs 0039:
-- aqui o e-mail É armazenado (cifrado em repouso), porque o nudge é disparado DIAS
-- depois (não dá pra enviar a um hash bcrypt). Logo a série é PSEUDÔNIMA, não anônima:
--   * email_enc = e-mail CIFRADO em repouso pelo app (pgcrypto/ENCRYPTION_KEY, padrão ADR-018),
--     decifrado só in-memory no instante do disparo. NUNCA em claro no banco/log.
--   * email_hash = bcrypt; só p/ dedup + unsubscribe. NUNCA chave de busca por PII.
-- Por ser pseudônima, exige (regras travadas neste schema + app, ver ADR-050 Parte 2):
--   * consentimento explícito (consent_at); opt-in desmarcado por padrão.
--   * direito de eliminação (deleted_at + ON DELETE CASCADE) — unsubscribe NÃO é erasure.
--   * retenção limitada (job de purga por last_seen_at; ver runbook).
-- Sem FK cross-schema, sem respostas item-a-item, sem texto livre (minimização).
-- Crise é first-class: série NUNCA criada p/ teste roteado a crise; re-rastreio reaplica
-- o gate validado e crise preempta a tela de evolução (lógica no app, docs/CRISIS-PROTOCOL.md).

-- pgcrypto: pgp_sym_encrypt/decrypt do email_enc (cifragem app-side, padrão ADR-018).
-- gen_random_uuid é core do PG13+, mas a extensão é exigida pelo pgp_sym_*.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Série de acompanhamento: sequência de re-rastreios de UMA pessoa, de UMA escala.
-- Identificada por token opaco que viaja no link do e-mail — nunca derivado de PII.
CREATE TABLE checkup.tracking_series (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    series_token  TEXT         NOT NULL UNIQUE,           -- >=128-bit CSPRNG, gerado no app
    scale_id      TEXT         NOT NULL,                  -- validado no app (escalas evoluem, ADR-048)
    consent_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),    -- opt-in explícito (base legal LGPD)
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_seen_at  TIMESTAMPTZ,                            -- alimenta a purga por retenção
    deleted_at    TIMESTAMPTZ                             -- erasure (direito do titular); purga assíncrona
);

-- Pontos da série: escore por data. Só total + faixa validada (sem item-a-item, sem texto).
CREATE TABLE checkup.tracking_points (
    id          BIGSERIAL    PRIMARY KEY,
    series_id   UUID         NOT NULL REFERENCES checkup.tracking_series(id) ON DELETE CASCADE,
    total_score INT          NOT NULL CHECK (total_score >= 0),
    band        TEXT         NOT NULL,                    -- faixa validada do instrumento (sem narrativa)
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Agendamento do nudge (e-mail de re-rastreio). Template fixo, sem LLM, sem conteúdo clínico.
CREATE TABLE checkup.tracking_reminders (
    id              BIGSERIAL    PRIMARY KEY,
    series_id       UUID         NOT NULL REFERENCES checkup.tracking_series(id) ON DELETE CASCADE,
    email_enc       BYTEA        NOT NULL,                -- e-mail cifrado em repouso (app, ADR-018)
    email_hash      TEXT         NOT NULL,                -- bcrypt; só dedup/unsubscribe
    due_at          TIMESTAMPTZ  NOT NULL,
    sent_at         TIMESTAMPTZ,
    unsubscribed    BOOLEAN      NOT NULL DEFAULT FALSE,
    unsubscribed_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Job de envio: nudges vencidos, ainda não enviados, não cancelados.
CREATE INDEX idx_tracking_reminders_due
    ON checkup.tracking_reminders (due_at)
    WHERE sent_at IS NULL AND unsubscribed = FALSE;
-- Unsubscribe / dedup por hash.
CREATE INDEX idx_tracking_reminders_email_hash
    ON checkup.tracking_reminders (email_hash);
-- Evolução por série (gráfico cronológico).
CREATE INDEX idx_tracking_points_series
    ON checkup.tracking_points (series_id, created_at);
-- Purga por retenção: séries inativas, não eliminadas.
CREATE INDEX idx_tracking_series_last_seen
    ON checkup.tracking_series (last_seen_at)
    WHERE deleted_at IS NULL;
