-- =============================================================================
-- 0004: suporte a entradas de diário por áudio (Diário de Voz)
-- Adiciona tipo (texto | audio) e transcricao à diario_entradas.
-- O áudio em si NÃO é armazenado (deletado do S3 após transcrição — LGPD).
-- Idempotente: ADD COLUMN IF NOT EXISTS.
-- =============================================================================

ALTER TABLE diario_entradas
  ADD COLUMN IF NOT EXISTS tipo        TEXT NOT NULL DEFAULT 'texto',
  ADD COLUMN IF NOT EXISTS transcricao TEXT;

COMMENT ON COLUMN diario_entradas.tipo IS 'texto | audio';
COMMENT ON COLUMN diario_entradas.transcricao IS 'Transcrição Amazon Transcribe (pt-BR). Nulo para entradas de texto.';
