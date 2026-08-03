-- =============================================================================
-- 0055: token_version para revogação de JWT na troca/reset de senha (T1-7).
--
-- JWT é stateless (8h médico / 7d paciente). Sem versão, trocar/redefinir a senha
-- NÃO expulsa sessões já emitidas (cenário "conta comprometida → resetei a senha"
-- deixa o token do atacante válido até expirar). Achado da review do ADR-066 (H3).
--
-- Mecânica: o login embute `token_version` no claim `tv`; o gateway valida por
-- request (OnTokenValidated) e rejeita token com `tv` divergente. Toda escrita de
-- senha (exceto o rehash automático de login) faz `token_version = token_version+1`,
-- invalidando os tokens antigos.
--
-- Aditivo + idempotente. DEFAULT 1: tokens emitidos ANTES do deploy não têm o claim
-- `tv` e passam (transição graciosa, sem logout em massa); viram revogáveis no
-- próximo login. Sem novo GRANT (gateway já tem UPDATE em usuarios/pacientes_credenciais).
-- =============================================================================

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 1;

ALTER TABLE pacientes_credenciais
  ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 1;

COMMENT ON COLUMN usuarios.token_version IS
  'T1-7: versão de sessão. Bump na troca/reset de senha revoga JWTs antigos (claim tv).';
COMMENT ON COLUMN pacientes_credenciais.token_version IS
  'T1-7: versão de sessão do paciente. Bump na troca de senha revoga JWTs antigos (claim tv).';
