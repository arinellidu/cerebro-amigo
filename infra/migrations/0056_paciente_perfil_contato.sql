-- 0056 — Campos de contato e endereço no perfil do paciente.
-- Paciente preenche via /p/perfil; CEP é resolvido via ViaCEP no browser
-- (logradouro/bairro/cidade/uf preenchidos automaticamente).
-- cpf já existia em pacientes; os demais são novos.

ALTER TABLE pacientes
  ADD COLUMN IF NOT EXISTS telefone    TEXT,
  ADD COLUMN IF NOT EXISTS cep         TEXT,
  ADD COLUMN IF NOT EXISTS logradouro  TEXT,
  ADD COLUMN IF NOT EXISTS numero      TEXT,
  ADD COLUMN IF NOT EXISTS complemento TEXT,
  ADD COLUMN IF NOT EXISTS bairro      TEXT,
  ADD COLUMN IF NOT EXISTS cidade      TEXT,
  ADD COLUMN IF NOT EXISTS uf          CHAR(2);
