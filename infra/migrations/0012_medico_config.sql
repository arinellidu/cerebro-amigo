-- =============================================================================
-- 0012: configurações do médico.
--
-- timezone         — fuso para agenda e agendamento de conduta (default BR).
-- horario_trabalho — JSON { "seg": ["08:00","18:00"], ... } usado pela agenda.
-- notif_prefs      — JSON { "crise_email": true, ... } canal opt-in da
--                    notificação externa (Fase 3, item 6).
-- =============================================================================

ALTER TABLE medicos
  ADD COLUMN IF NOT EXISTS timezone         TEXT  NOT NULL DEFAULT 'America/Sao_Paulo',
  ADD COLUMN IF NOT EXISTS horario_trabalho JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS notif_prefs      JSONB NOT NULL DEFAULT '{}';
