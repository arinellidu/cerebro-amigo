-- =============================================================================
-- 0006: estende protocolos_crise_acionados (trilha de crise) para:
--   (a) destravar o orchestrator-py (crisis.py já INSERE estas colunas, mas o
--       schema 0001 só tinha id/paciente_id/medico_id/gatilho/confianca/criado_em
--       → o protocolo de crise da conversa quebraria em runtime, igual aos bugs
--       de agente_execucoes/sintomas);
--   (b) suportar a triagem de crise no Diário (áudio + texto), que precisa
--       registrar a origem e o texto de acolhimento enviado.
--
-- Trilha de AUDITORIA: regra #5 clinical-safety = append-only. Esta migration
-- SÓ adiciona colunas. Nunca DROP/UPDATE de linhas. ADD COLUMN IF NOT EXISTS.
--
-- mensagem_id é NULLABLE: a conversa referencia mensagens.id; o diário não tem
-- mensagem (a entrada ainda nem foi salva quando a crise é detectada), então
-- fica NULL e a origem é registrada em `origem`.
-- =============================================================================

ALTER TABLE protocolos_crise_acionados
  ADD COLUMN IF NOT EXISTS mensagem_id          UUID REFERENCES mensagens(id),
  ADD COLUMN IF NOT EXISTS palavras_detectadas  TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS resposta_enviada     TEXT,
  ADD COLUMN IF NOT EXISTS medico_notificado    BOOL NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS medico_notificado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS origem               TEXT NOT NULL DEFAULT 'conversa';

COMMENT ON COLUMN protocolos_crise_acionados.mensagem_id IS
  'FK p/ mensagens.id (conversa). NULL quando origem != conversa (ex.: diário).';
COMMENT ON COLUMN protocolos_crise_acionados.palavras_detectadas IS
  'Categorias de gatilho do classificador (NUNCA trechos verbatim do paciente).';
COMMENT ON COLUMN protocolos_crise_acionados.resposta_enviada IS
  'Texto fixo de acolhimento (crisis_copy) entregue ao paciente.';
COMMENT ON COLUMN protocolos_crise_acionados.origem IS
  'conversa | diario_audio | diario_texto — canal onde a crise foi detectada.';
