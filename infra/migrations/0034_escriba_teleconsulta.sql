-- =============================================================================
-- 0034: Escriba clínico (Ambient Scribe) — ADR-040
-- Gravação consentida da teleconsulta → transcrição cifrada → rascunho FACTUAL
-- (sem diagnóstico/CID/conduta — regra #1) → médico aprova → evolução append-only.
-- Idempotente.
-- =============================================================================

-- Consentimento + status do escriba na consulta.
ALTER TABLE consultas
  ADD COLUMN IF NOT EXISTS escriba_status        TEXT NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS escriba_consentido_em TIMESTAMPTZ;

COMMENT ON COLUMN consultas.escriba_status IS 'idle | consentido | rascunho | aprovado';
COMMENT ON COLUMN consultas.escriba_consentido_em IS 'Quando o paciente consentiu a gravação p/ transcrição (LGPD). NULL = não consentido.';

-- Registro de trabalho do Escriba: transcrição cifrada + rascunho factual.
-- transcricao e rascunho são cifrados em repouso (ADR-018, prefixo v1:).
-- rascunho guarda JSON factual serializado (relato/temas/medicações mencionadas).
CREATE TABLE IF NOT EXISTS consulta_transcricoes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consulta_id   UUID NOT NULL REFERENCES consultas(id) ON DELETE CASCADE,
  paciente_id   UUID NOT NULL REFERENCES clientes(id),
  medico_id     UUID NOT NULL REFERENCES medicos(id),
  transcricao   TEXT,                              -- cifrado (ADR-018)
  rascunho      TEXT,                              -- JSON factual cifrado (ADR-018)
  mencao_risco  BOOLEAN NOT NULL DEFAULT FALSE,    -- flag factual p/ médico; NÃO dispara protocolo
  status        TEXT NOT NULL DEFAULT 'rascunho',  -- rascunho | aprovado | descartado
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  aprovado_em   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_consulta_transcricoes_consulta ON consulta_transcricoes(consulta_id);
CREATE INDEX IF NOT EXISTS idx_consulta_transcricoes_medico   ON consulta_transcricoes(medico_id);

-- Evoluções clínicas (notas aprovadas) — APPEND-ONLY (regra #5).
-- A nota final é do MÉDICO: rascunho factual da IA + avaliação/plano que o médico escreve.
-- conteudo cifrado em repouso (ADR-018).
CREATE TABLE IF NOT EXISTS evolucoes_clinicas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paciente_id   UUID NOT NULL REFERENCES clientes(id),
  medico_id     UUID NOT NULL REFERENCES medicos(id),
  consulta_id   UUID REFERENCES consultas(id),
  origem        TEXT NOT NULL DEFAULT 'escriba',   -- escriba | manual
  conteudo      TEXT NOT NULL,                     -- cifrado (ADR-018)
  assistido_ia  BOOLEAN NOT NULL DEFAULT FALSE,    -- badge "assistido por IA"
  criado_por    UUID REFERENCES usuarios(id),
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_evolucoes_clinicas_paciente ON evolucoes_clinicas(paciente_id);
CREATE INDEX IF NOT EXISTS idx_evolucoes_clinicas_medico   ON evolucoes_clinicas(medico_id);
