# ADR-046 — Signup externo de médico + atribuição do Check-up (motor de aquisição)

- **Status:** Accepted (decisões fechadas 2026-06-12; em implementação — branch `feat/signup-externo-medico`)
- **Data:** 2026-06-12
- **Relacionados:** ADR-031 (rede-extensões, signup proposto e nunca construído), ADR-017 (validação CRM/CFM),
  ADR-042 (RLS de tenant), ADR-034 (assinaturas), `apps/checkup/CLAUDE.md`, skill `clinical-safety`, skill `dotnet-gateway`.

## Contexto

O Check-up Mental gera um PDF com QR → `www.cerebroamigo.com.br/medico?src=checkup&rid=<8c>` (corrigido no #1, ADR-051).
Hoje `/medico` é só landing de marketing (CTA → `/dashboard` demo): **não há cadastro de médico**, e a "métrica norte"
(médicos cadastrados por 1.000 testes) **não é medível**. O signup externo do ADR-031 foi **proposto e nunca construído**
(a branch `feat/rede-extensoes` está 100% no main, mas só a rede social/foto/presença foi mergeada — o signup não).

Objetivo: fechar o loop de aquisição — QR → `/medico` → **cadastro real de médico** (com validação de CRM) → conta ativa,
**atribuído ao checkup** (eventos `qr_scanned` / `doctor_signup_started` + origem gravada no médico).

## Decisões-chave (e o que as torna baratas)

### 1. Médico externo = seu próprio tenant (zero novo modelo de tenancy)
Apurado: `medicos.id` É a âncora de tenant; não há tabela de tenant nem `tenant_id`. Um médico novo só precisa de
`usuario(role='medico')` + `medico` — e já nasce **isolado pela RLS** (ADR-042: `TenantSessionMiddleware` seta
`app.current_medico` por request; `cerebro_gateway` é NOBYPASSRLS). Médico novo começa com **zero pacientes** → risco
clínico inicial nulo. **Não** criar clínica/organização nem tocar nas políticas RLS.

### 2. Reusar o onboarding admin como molde (não reinventar)
`POST /api/v1/admin/onboarding/medico` (`AdminEndpoints.cs:528-634`) já faz a transação atômica
`usuarios`+`medicos`+`assinaturas`+`medico_invite_tokens` + `CfmClient.ValidarAsync` + e-mail Resend. O self-signup é a
versão **pública e self-service** disso. Extrair a lógica para um helper compartilhado (`MedicoOnboardingService`) e
chamá-la dos dois endpoints (admin + público).

### 3. Verificação de e-mail OBRIGATÓRIA (mais seguro que o ADR-031 propôs)
ADR-031 queria devolver JWT na hora. **Rejeitado** por segurança: número de CRM **não prova posse** (qualquer um digita
um CRM Regular alheio). Em vez disso, o self-signup **reusa o fluxo de ativação por token** que já existe:
signup → cria conta (sem senha) + manda e-mail com link `/ativar-conta?token=` → médico **prova o e-mail** + define senha
via `POST /api/v1/auth/ativar-conta` → login normal. Sem caminho de auth novo, e o e-mail vira a 1ª barreira anti-fraude.
Mitigações extras: **cross-check do nome** (médico digita nome → precisa bater com `crm_nome_cfm` do CFM) + **rate-limit**
no endpoint público + CRM **Regular** como hard gate (sem o soft-fail "PendenteVerificacao" que o admin tolera).

### 4. Atribuição via colunas no `medicos` + eventos no checkup
- **Origem no médico:** `ALTER TABLE medicos ADD COLUMN signup_source TEXT, ADD COLUMN checkup_rid TEXT;`
  (`signup_source ∈ {admin, self, checkup}`; `checkup_rid` = o `rid` de 8 chars do QR, quando veio do checkup).
- **Eventos do funil (no schema `checkup`, via API pública — respeita isolamento web⇄checkup):**
  `/medico` (web) chama `POST https://checkup.cerebroamigo.com.br/api/events` com `qr_scanned` (no load, se `src=checkup`)
  e `doctor_signup_started` (ao iniciar o form). **Gargalo apurado:** a events API exige `sessionId` UUID **completo**, mas
  o QR só carrega o `rid` (8 chars) — e paciente sem consentimento **não tem** linha em `test_results` p/ mapear de volta.
  → **Migration na events API:** tornar `funnel_events.session_id` nullable + adicionar `rid TEXT`; aceitar eventos
  `qr_scanned`/`doctor_signup_started` keyed por `rid` (sem exigir UUID). Atribuição final (médico criado) grava
  `signup_source='checkup'` + `checkup_rid` no `medicos` — a junção métrica é `checkup.funnel_events.rid` ⇄ `medicos.checkup_rid`.

## A construir (nada disto existe no main)

**Gateway (.NET):**
- `MedicoOnboardingService` — extrai a transação atômica de `AdminEndpoints` (usuario+medico+assinatura+token) p/ reuso.
- `POST /api/v1/auth/medico/signup` (PÚBLICO, anônimo): body `{nome, email, crm, crmUf, src?, rid?}` (sem senha — senha
  vem na ativação). Valida CRM (hard gate Regular + nome bate com CFM) → cria conta `signup_source` + `checkup_rid` →
  manda e-mail de ativação. **Rate-limit** (por IP) obrigatório. 422 se CRM não-Regular / nome divergente.
- `proxy.ts`/auth: liberar a rota pública.

**Web (Next/BFF):**
- `/medicos/cadastro` (página pública): lê `?src=checkup&rid=`, form (nome, e-mail, CRM, UF, consentimentos LGPD),
  dispara `doctor_signup_started`, POSTa no BFF → gateway. Tela de "cheque seu e-mail".
- `/medico`: ler `?src=checkup&rid=` no load → disparar `qr_scanned` (via rota BFF → checkup API) + CTA aponta p/
  `/medicos/cadastro?src=checkup&rid=...` (carrega a atribuição adiante).
- BFF `app/api/checkup-event` (server-side fetch p/ a API pública do checkup — mantém isolamento; web nunca escreve schema checkup).

**Checkup (migration + API):**
- Migration `checkup`: `funnel_events.session_id` nullable + `ADD COLUMN rid TEXT`. Events API aceita evento por `rid`.

**Migration clínica:** `medicos` + `signup_source`, `checkup_rid` (idempotente).

## clinical-safety / segurança

- **Sem dado de paciente** envolvido; PII do médico (CRM/e-mail) minimizada, CRM logado só nº+UF+status (padrão CfmClient).
- **Posse de identidade:** CRM ≠ prova de posse → e-mail-verify + cross-check de nome + CRM Regular. Considerar (futuro)
  revisão admin do 1º acesso de contas `signup_source=self` p/ fraude.
- **Superfície pública nova no gateway clínico:** rate-limit + validação estrita; é a 1ª rota anônima de criação de conta
  no gateway — revisar com `clinical-safety` antes de implementar.
- **RLS:** médico novo isolado desde o 1º request (começa sem pacientes). Não tocar políticas RLS.
- **LGPD:** consentimento explícito no form; e-mail/CRM com base legal (cadastro profissional).

## Consulta clinical-safety (2026-06-12)
Revisado com a skill antes da Fase 3 (1ª rota anônima de criação de conta no gateway clínico). Veredito: **sem bloqueio** — o endpoint não pratica medicina (sem LLM, validação determinística CFM), não toca dado de paciente/conteúdo clínico/crise/auditoria, e o médico criado nasce **isolado no próprio tenant** (RLS, ADR-042) com **zero pacientes** (regra multi-tenant respeitada: nenhuma query cruza tenant). Constraints aplicadas: (regra 4 LGPD) **não logar PII crua** — só metadado (situação CRM, src); (custo/abuso) Infosimples é **PAGO** → **rate-limit por IP obrigatório** + cache 30d do CfmClient; (anti-fraude) e-mail-verify + cross-check de nome vs `crm_nome_cfm` + CRM Regular hard gate. Sem texto de crise, sem auditoria, sem SHADOW_MODE envolvidos.

## Fases (sugeridas)
1. Migrations (medicos + checkup funnel_events) — reversíveis, testáveis isoladas.
2. `MedicoOnboardingService` extraído + testes (xUnit) — sem mudar comportamento do admin.
3. `POST /auth/medico/signup` + rate-limit + CRM Regular + nome cross-check + testes de isolamento de tenant.
4. Events API rid + `/medico` qr_scanned + `/medicos/cadastro` + BFF.
5. Smoke E2E: QR → /medico (qr_scanned) → /medicos/cadastro (doctor_signup_started) → e-mail → ativar → login;
   conferir `medicos.signup_source/checkup_rid` + junção métrica.

## Decisões fechadas (Patrick, 2026-06-12)
1. **E-mail-verify obrigatório: SIM** — reusa o fluxo `/ativar-conta` (prova posse do e-mail + define senha). CRM não prova posse.
2. **Aprovação admin de conta self: NÃO** (MVP) — auto na CRM Regular; revisar só se aparecer fraude.
3. **Rota: `/medicos/cadastro`** (zona marketing; não acopla à rede social `/rede`).
4. **Assinatura inicial: trial 30d** (igual ao onboarding admin).

## Progresso (branch `feat/signup-externo-medico`)
- ✅ **Fase 1 (migrations):** `0041` (medicos +signup_source,+checkup_rid) e `0042` (funnel_events session_id nullable +rid +CHECK +índice). Aditivas/idempotentes; **ainda NÃO aplicadas em prod**.
- ✅ **Fase 2 (service):** `MedicoOnboardingService` extraído do AdminEndpoints; admin refatorado p/ usá-lo (comportamento idêntico). Build 0/0.
- ✅ **Fase 3 (endpoint):** `POST /api/v1/auth/medico/signup` público — rate-limit por IP (XFF), CRM Regular hard gate (sem soft-fail), name-match vs CFM, atribuição src/rid, e-mail-verify. clinical-safety revisada. Build 0/0 + **44 testes Testcontainers verdes** (migrations validadas em PG real).
- ✅ **Fase 4 (web+checkup):** events API aceita `rid`; BFF `/api/medico-signup` (repassa XFF) + `/api/checkup-event` (API pública checkup, isolamento); página `/medicos/cadastro`; `/medico` lê src/rid + banner (qr_scanned + CTA). Typecheck checkup+web 0 erros.
- ⏳ **Fase 5 (deploy + smoke E2E):** aplicar 0041/0042 em prod (ANTES do gateway) → deploy gateway (deploy-clinical) + checkup (deploy-checkup) + web (Vercel) → smoke QR→/medico→/medicos/cadastro→CRM→e-mail→ativa→login + conferir `medicos.signup_source/checkup_rid` ⇄ `funnel_events.rid`.
