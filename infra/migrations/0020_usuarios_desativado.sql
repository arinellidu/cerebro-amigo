-- Migration 0020: soft delete de usuário
-- desativado_em != NULL = usuário desativado: não loga e some da lista do admin.
-- Soft delete (não DELETE físico) preserva dados clínicos e auditoria (FK RESTRICT
-- em medicos/pacientes/consultas tornaria hard delete inseguro). Reversível.
-- Aplicar: psql $POSTGRES_DSN_URL -f infra/migrations/0020_usuarios_desativado.sql

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS desativado_em TIMESTAMPTZ;
