-- Migration 0041: atribuição de origem do cadastro do médico (ADR-046)
--
-- Suporta o signup externo de médico vindo do QR do Check-up (motor de aquisição).
-- Aditivo e idempotente (forward-only; aplicar via psql/SSM como as demais).
-- NÃO toca RLS nem políticas; colunas novas no `medicos` (a âncora de tenant).

ALTER TABLE medicos
  ADD COLUMN IF NOT EXISTS signup_source TEXT,   -- 'admin' | 'self' | 'checkup' | NULL (legado)
  ADD COLUMN IF NOT EXISTS checkup_rid   TEXT;    -- rid (8 chars do session UUID) quando veio do QR do Check-up

COMMENT ON COLUMN medicos.signup_source IS
  'Origem do cadastro: admin (onboarding pelo admin), self (auto-cadastro), checkup (auto-cadastro vindo do QR do Check-up). NULL = legado.';
COMMENT ON COLUMN medicos.checkup_rid IS
  'rid do Check-up (8 chars do session UUID) p/ atribuir o QR->médico. Junta com checkup.funnel_events.rid (métrica: médicos por 1.000 testes).';

-- Índice p/ a junção métrica; só linhas efetivamente atribuídas ao checkup.
CREATE INDEX IF NOT EXISTS idx_medicos_checkup_rid
  ON medicos (checkup_rid) WHERE checkup_rid IS NOT NULL;
