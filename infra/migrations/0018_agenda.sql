-- Migration 0018: agenda — duração de consulta (slots + conflito)
-- duracao_min: duração em minutos, usada para calcular slots livres e detectar
-- sobreposição de horário. Default 30min (mantém consultas antigas válidas).
-- Working hours ricos (dias/inicio/fim/duracao_min/almoco) vivem em
-- medicos.horario_trabalho (JSONB já existente) — sem DDL aqui.
-- Aplicar: psql $POSTGRES_DSN_URL -f infra/migrations/0018_agenda.sql

ALTER TABLE consultas
  ADD COLUMN IF NOT EXISTS duracao_min INT NOT NULL DEFAULT 30;
