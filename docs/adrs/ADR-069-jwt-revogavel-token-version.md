# ADR-069 — JWT revogável por `token_version` (revogar sessão na troca/reset de senha)

- **Status:** Accepted
- **Data:** 2026-06-19
- **Relacionado:** DEBT.md T1-7, ADR-066 (review H3 — origem do achado), skill `dotnet-gateway`

## Contexto

O JWT do gateway é stateless (8h médico/owner/admin, 7 dias paciente). Sem versão de
sessão, **trocar ou redefinir a senha NÃO expulsa os tokens já emitidos**. O cenário
"conta comprometida → redefini a senha" deixava o token do atacante válido até expirar
— exatamente quando a revogação importa. Achado da review do ADR-066 (H3), aceito como
dívida (T1-7).

## Decisão

Adicionar `token_version` (int) a `usuarios` e `pacientes_credenciais`. O login embute
no claim **`tv`**; o gateway valida por request e rejeita o token cujo `tv` divergir da
versão atual. Toda escrita deliberada de senha **bumpa** a versão, invalidando os tokens
antigos do usuário.

### Mecânica

- **Mint:** `TokenService.GenerateForUser` (médico) e `GerarTokensSessao` (paciente)
  incluem `tv = token_version`.
- **Validação:** `JwtBearerEvents.OnTokenValidated` (Program.cs) — após assinatura/lifetime
  válidos, lê `usuarios`/`pacientes_credenciais.token_version` (tabela escolhida pelo claim
  `role`) e chama `context.Fail()` se `tv` divergir. Custo: +1 SELECT PK indexado por
  request autenticado (cacheável no futuro se aparecer em profiling).
- **Bump (`token_version + 1`) em TODA escrita de senha, EXCETO o rehash de login:**
  médico trocar senha (`/me/senha`), reset (`/auth/redefinir-senha`), admin força reset
  (`/admin/usuarios/{id}/senha`), ativar conta, paciente trocar senha e magic-validar com
  senha. **O rehash automático PBKDF2→BCrypt no login NÃO bumpa** (senão revogaria as
  outras sessões a cada login com hash legado).

### Escolhas

- **`token_version` (int) em vez de `senha_alterada_em` (timestamp):** comparação inteira
  exata, sem risco de clock-skew entre `iat` e o timestamp.
- **Transição graciosa:** token SEM claim `tv` (emitido antes do deploy) **passa** — não
  força logout em massa; vira revogável no próximo login. `DEFAULT 1` na coluna.
- **Fail-open no erro de DB:** se o lookup falhar, o request é aceito (com log) — não
  derruba todas as sessões num hiccup; a request real depende do DB e falharia no endpoint
  de qualquer forma.

## Consequências

- Trocar/redefinir senha agora **expulsa as sessões antigas** (médico, owner, admin e
  paciente — o token do paciente é o mais longo, 7d, onde mais importava).
- +1 query por request autenticado (aceitável nesta escala; sem cache por ora).
- **Gate de deploy (migrations são manuais, sem auto-apply no boot):** a migration 0055
  PRECISA ser aplicada no RDS **antes** de a imagem do gateway subir — a entidade EF
  `Usuario` passa a mapear `token_version`, então sem a coluna o SELECT de usuário (login)
  quebra. Aplicar 0055 → depois deployar.
- **Testes (gate no CI):** `TokenVersionRevocationTests` (Testcontainers) — médico/paciente:
  `tv` atual aceito, versão velha rejeitada (401) após bump, token sem `tv` passa.

## Alternativas descartadas

- **Reduzir validade + logout no front:** não revoga de verdade (token segue válido até
  expirar); UX pior e janela de ataque mantida.
- **Blocklist de `jti` (denylist de tokens):** exige store de revogação + checagem por
  request; mais estado para o mesmo efeito que a versão por usuário entrega.
