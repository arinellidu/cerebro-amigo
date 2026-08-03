-- Migration 0043: login_rate_limits — rate limit de login/signup/magic-link no Postgres (T1-1).
-- Substitui o estado in-memory do LoginRateLimiter do gateway (que valia só por nó):
-- com o estado no banco, a política (5 falhas / 15 min por chave) vale para N
-- instâncias do gateway atrás de load balancer. Mesma técnica do checkup (0040).
--
-- Sem PII: `chave` = SHA-256 hex da chave normalizada (e-mail ou "signup:<ip>") —
-- e-mail/IP nunca ficam crus no banco. Sem tenant (login é pré-auth) → sem RLS.
-- Falha de banco não derruba login: o gateway cai para o contador in-memory
-- (fail-soft, por nó) e loga warning.

CREATE TABLE IF NOT EXISTS login_rate_limits (
    chave          TEXT        PRIMARY KEY,
    hits           INT         NOT NULL DEFAULT 1,
    window_start   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    blocked_until  TIMESTAMPTZ
);

-- Limpeza oportunista de janelas velhas (o gateway faz DELETE probabilístico).
CREATE INDEX IF NOT EXISTS idx_login_rate_limits_window ON login_rate_limits (window_start);

-- Os DEFAULT PRIVILEGES do 0036 já cobrem tabelas novas criadas por cerebroadmin;
-- o grant explícito abaixo é cinto-e-suspensório caso a migration seja aplicada
-- por outro admin. Guardado: o role não existe em ambientes de teste.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cerebro_gateway') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON login_rate_limits TO cerebro_gateway;
    END IF;
END
$$;
