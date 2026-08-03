-- Migration 0051: inscrição em newsletter do médico (free tier, ADR-065).
--
-- O médico recém-cadastrado entra num trial de aquisição read-only e ganha, de
-- imediato, inscrição na newsletter. Esta migration cria a tabela. Inscrição +
-- unsubscribe são FUNCIONAIS agora; o ENVIO fica atrás da flag dark
-- NEWSLETTER_SEND_ENABLED (fail-closed) porque o SES production-access está
-- pendente (CK-4).
--
-- SEM RLS de tenant de propósito: é dado de identidade/marketing do médico (como
-- `usuarios`/`assinaturas`), e o unsubscribe é ANÔNIMO por token (sem JWT → sem
-- GUC `app.current_medico` → RLS fail-closed bloquearia o próprio unsub). O
-- isolamento é por `medico_id` no WHERE da aplicação + token único do unsub.
-- Aditivo e idempotente.

CREATE TABLE IF NOT EXISTS newsletter_inscricoes (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    medico_id       UUID         REFERENCES medicos(id) ON DELETE CASCADE,
    email           TEXT         NOT NULL,
    -- token opaco p/ unsubscribe anônimo via link do e-mail (CSPRNG, base64url).
    unsub_token     TEXT         NOT NULL UNIQUE,
    status          TEXT         NOT NULL DEFAULT 'subscribed', -- subscribed | unsubscribed
    consent_origin  TEXT         NOT NULL DEFAULT 'signup',     -- signup | manual | admin
    subscribed_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    unsubscribed_at TIMESTAMPTZ,
    last_sent_at    TIMESTAMPTZ                                 -- alimentado pelo envio (dark)
);

-- Um médico, uma inscrição (auto-inscrição idempotente no onboarding).
CREATE UNIQUE INDEX IF NOT EXISTS ux_newsletter_medico
    ON newsletter_inscricoes (medico_id) WHERE medico_id IS NOT NULL;
-- Dedup por e-mail (inscrições sem médico/legadas).
CREATE UNIQUE INDEX IF NOT EXISTS ux_newsletter_email
    ON newsletter_inscricoes (lower(email));
-- Fila do job de envio (dark): apenas inscritos ativos.
CREATE INDEX IF NOT EXISTS idx_newsletter_envio
    ON newsletter_inscricoes (status) WHERE status = 'subscribed';

COMMENT ON TABLE newsletter_inscricoes IS
  'ADR-065: inscricao de medico em newsletter (free tier). Inscricao+unsub funcionais; envio atras de NEWSLETTER_SEND_ENABLED (CK-4 SES pendente). SEM RLS (identidade/marketing; unsub anonimo por token).';

-- GRANTs explicitos (consistencia com 0047/0050; nao depender so do ALTER DEFAULT
-- PRIVILEGES da 0036). Em prod ja foram concedidos por default privilege ao aplicar
-- como cerebroadmin; idempotente. O gateway le/escreve (unsub/me); workers full.
GRANT SELECT, INSERT, UPDATE ON newsletter_inscricoes TO cerebro_gateway;
GRANT ALL ON newsletter_inscricoes TO cerebro_workers;
