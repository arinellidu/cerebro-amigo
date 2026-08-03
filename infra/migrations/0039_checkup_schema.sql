-- Migration 0039: schema checkup — Check-up Mental (produto-satélite)
-- Dados anônimos por padrão (LGPD categoria especial — saúde mental).
-- Sem FK entre report_emails e test_results por design (minimização de dados).

CREATE SCHEMA IF NOT EXISTS checkup;

-- Eventos de funil (server-side analytics — sem PII)
CREATE TABLE checkup.funnel_events (
    id          BIGSERIAL PRIMARY KEY,
    session_id  UUID        NOT NULL,
    event_type  TEXT        NOT NULL
                    CHECK (event_type IN (
                        'test_started', 'crisis_routed', 'test_completed',
                        'report_generated', 'qr_scanned', 'doctor_signup_started'
                    )),
    scale_id    TEXT        CHECK (scale_id IN ('phq9', 'gad7', 'asrs18')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_funnel_events_session   ON checkup.funnel_events (session_id);
CREATE INDEX idx_funnel_events_type_date ON checkup.funnel_events (event_type, created_at);

-- Resultados (somente com consentimento explícito; sem respostas item a item)
CREATE TABLE checkup.test_results (
    id          BIGSERIAL    PRIMARY KEY,
    session_id  UUID         NOT NULL UNIQUE,
    scale_id    TEXT         NOT NULL CHECK (scale_id IN ('phq9', 'gad7', 'asrs18')),
    total_score INT          NOT NULL CHECK (total_score >= 0),
    band        TEXT         NOT NULL,
    crisis_flag BOOLEAN      NOT NULL DEFAULT FALSE,
    consented   BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- E-mail opcional para envio do PDF — sem FK (sem ligação direta às respostas)
CREATE TABLE checkup.report_emails (
    id          BIGSERIAL    PRIMARY KEY,
    session_id  UUID         NOT NULL,
    email_hash  TEXT         NOT NULL,  -- hash bcrypt; e-mail bruto nunca armazenado junto das respostas
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Permissões: apenas o role checkup_app pode acessar (princípio do menor privilégio)
-- Criação do role e GRANT devem ocorrer no runbook de setup, não neste DDL.
