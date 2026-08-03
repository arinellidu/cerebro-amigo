-- Migration 0042: funnel_events aceita eventos keyed por `rid` (lado médico, ADR-046)
--
-- O QR do PDF carrega só o `rid` (8 chars do session UUID), não o UUID completo; e o
-- paciente sem consentimento NÃO tem linha em test_results p/ mapear rid -> session_id.
-- Os eventos do lado MÉDICO (qr_scanned no /medico, doctor_signup_started no /medicos/cadastro)
-- chegam com o rid e sem o UUID. Esta migration permite registrá-los por rid.
--
-- Schema `checkup` (isolado do clínico). Aditivo/idempotente. checkup_app já tem INSERT
-- por GRANT de tabela (cobre a coluna nova).

ALTER TABLE checkup.funnel_events ALTER COLUMN session_id DROP NOT NULL;
ALTER TABLE checkup.funnel_events ADD COLUMN IF NOT EXISTS rid TEXT;

-- Todo evento tem PELO MENOS um identificador: session_id (lado paciente) OU rid (lado médico).
-- Linhas existentes têm session_id NOT NULL -> a CHECK passa sem backfill.
ALTER TABLE checkup.funnel_events
  DROP CONSTRAINT IF EXISTS funnel_events_id_presente;
ALTER TABLE checkup.funnel_events
  ADD CONSTRAINT funnel_events_id_presente CHECK (session_id IS NOT NULL OR rid IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_funnel_events_rid
  ON checkup.funnel_events (rid) WHERE rid IS NOT NULL;

COMMENT ON COLUMN checkup.funnel_events.rid IS
  'rid (8 chars do session UUID) p/ eventos do lado médico (qr_scanned, doctor_signup_started) que só têm o rid do QR, não o session_id completo.';
