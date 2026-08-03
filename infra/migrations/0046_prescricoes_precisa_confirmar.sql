-- =============================================================================
-- 0046: confirmação do médico para o espelho MEMED (Tier 1, ADR-056).
--
-- O espelho de uma receita emitida no MEMED (MemedEndpoints POST /receitas) só
-- conhece o nome do medicamento e a posologia em texto livre — NÃO os horários
-- (TIME[]) nem a validade (DATE) que os automatismos já construídos exigem:
--   * gerador_checkins_medicacao  → itera `horarios`; vazio = zero lembrete.
--   * gerador_renovacao_receita   → filtra `receita_validade IS NOT NULL`; NULL = fora da fila.
-- Antes, o espelho entrava ATIVO e incompleto: receita MEMED virava beco sem
-- saída para lembrete e renovação.
--
-- Agora o espelho entra como RASCUNHO (ativa = FALSE, precisa_confirmar = TRUE)
-- e fica fora dos dois jobs (ambos filtram `ativa = TRUE`) até o médico confirmar
-- horários + validade no prontuário. Clinical-safety #4 (médico no loop): a IA
-- não infere posologia; quem ativa o lembrete é o médico. Sem parse de texto.
-- =============================================================================

ALTER TABLE prescricoes
  ADD COLUMN IF NOT EXISTS precisa_confirmar BOOL NOT NULL DEFAULT FALSE;

-- Fila de confirmação por médico/paciente: só rascunhos MEMED pendentes.
CREATE INDEX IF NOT EXISTS prescricoes_a_confirmar_idx
  ON prescricoes (paciente_id)
  WHERE precisa_confirmar = TRUE;
