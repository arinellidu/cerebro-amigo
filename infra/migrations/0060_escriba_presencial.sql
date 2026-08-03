-- =============================================================================
-- 0060: Escriba PRESENCIAL (Ambient Scribe presencial) — ADR-075 (estende ADR-040)
-- Habilita o Escriba em consulta presencial (médico + paciente na sala, sem
-- videochamada). Consentimento é ATESTADO pelo médico (verbal), registrado com
-- método + timestamp. Reusa toda a pipeline (transcrição → rascunho factual →
-- aprovação → evolucoes_clinicas append-only).
-- Idempotente. Sem RLS nova (consultas/consulta_transcricoes já em 0037).
-- =============================================================================

-- Como o consentimento da gravação foi obtido.
--   'teleconsulta'    → paciente consentiu na sua própria sessão (checkbox no lobby)
--   'verbal_atestado' → médico atestou consentimento verbal do paciente (presencial, ADR-075)
ALTER TABLE consultas
  ADD COLUMN IF NOT EXISTS escriba_consentido_metodo TEXT;

COMMENT ON COLUMN consultas.escriba_consentido_metodo IS
  'Como o consentimento da gravação foi obtido: teleconsulta (titular) | verbal_atestado (médico). NULL = não consentido.';

-- Nota: consulta_transcricoes.status ganha o valor 'processando' (transcrição
-- assíncrona do presencial). É só valor de coluna TEXT — nenhum DDL necessário.
-- Fluxo: processando → rascunho → aprovado (ou → erro em falha do job).
