# ADR-065: Free tier do médico — trial read-only de aquisição + newsletter

**Status:** Implementado (local; build + testes unitários verdes). **Gates antes de prod:**
- Aplicar migration `0051_newsletter_inscricoes.sql` no RDS (`cerebro_v3`) **antes** do deploy do código.
- (Opcional) definir `TRIAL_MAX_PACIENTES` no `.env` do box (default 5 se ausente).
- Envio da newsletter fica **dark** (`NEWSLETTER_SEND_ENABLED` ausente/false) até SES production-access (CK-4).
- Revisão clinical-safety da fronteira (crise/portal/escalação seguem isentos — ver Consequências).

**Data:** 2026-06-18  **Implementado:** 2026-06-18
**Decisores:** Patrick Arinelli
**Categoria:** Monetização / aquisição / gate de acesso

## Contexto

Até aqui, o médico recém-cadastrado (ADR-046/ADR-055) nascia `status='pendente'` com um
**prazo de pagamento curto** (default 5 dias) e, nesse período, tinha **CRUD completo** do
dashboard — só a camada de IA ficava travada pelo `FeatureGate` (ADR-059). Na prática isso
entregava o produto operacional inteiro de graça por 5 dias.

A decisão de produto é transformar esses 5 dias num **free tier de aquisição**: o médico
entra, conhece o produto em **modo somente-leitura** (com teaser do que a IA faz), **pode
cadastrar pacientes** (lock-in por base, com teto anti-abuso) e ganha inscrição em
**newsletter**. Nada operacional de escrita (agenda, prontuário, prescrição, conduta) nem
IA até assinar um plano. Pós-prazo: paywall total (ADR-055), exceto checkout + crise +
newsletter. Pagou → libera o plano (starter/pro/master).

Decisões travadas com o Patrick:
- **Identidade no signup**: CPF + UF + nome **obrigatórios** (CPF era opcional; vira obrigatório — de quebra fecha um P0 do launch audit).
- **Escrita no trial**: **somente pacientes** (CRUD). Resto read-only.
- **IA no trial**: bloqueada (402) **com popup de upsell** explicando e levando aos planos.
- **Custo de paciente**: **cap de 5 pacientes** no trial (env-configurável), removido ao pagar. Crise SEMPRE roda.
- **Newsletter**: inscrição + unsubscribe funcionais agora; **envio dark** até SES (CK-4).

## Decisão

### Terceira camada de gate (verbo-aware, opt-in)

Na mesma linha das duas existentes (`AssinaturaGate` = o dashboard abre? / `FeatureGate` =
o plano inclui IA?), entra a terceira: **`ReadOnlyTrialFilter`** (`apps/api-gateway/Auth/
ReadOnlyTrialFilter.cs`), opt-in via `.RequireWriteAccess()`.

- **Estado derivado, sem coluna nova**: "trial read-only" = `status='pendente'` **e** em
  prazo (ou sem prazo) **e** plano **não pago**. "Plano pago" = código existente no
  `PlanCatalog` (`starter`/`pro`/`master`/`enterprise`); `pendente`/`null`/`''` não contam.
  Implementado como sobrecarga pura `AssinaturaGate.Avaliar(..., plano)` → `TrialReadOnly`.
- **Verbo-aware**: `GET/HEAD/OPTIONS` sempre passam (leitura liberada). `POST/PUT/PATCH/
  DELETE` em trial read-only → **403 `read_only_trial`**. Fail-open em erro/médico ausente.
- **Allowlist por ausência**: o filtro é estritamente opt-in. O grupo de **pacientes NÃO
  recebe** o filtro (escrita liberada = lock-in). Grupos que recebem: prescrições, evolução,
  consultas, medicações-em-uso, insights e **condutas** — ver abaixo.
- **IA já bloqueada de graça**: endpoints `RequireFeature(...)` retornam 402 `feature_requer_pro`
  porque plano `pendente` não tem feature nenhuma. Nenhum código novo p/ bloquear IA.

### Cap de pacientes (handler, não filtro)

`POST /api/v1/pacientes` conta os pacientes do médico vs `TRIAL_MAX_PACIENTES` (default 5)
**só quando em trial read-only** → 403 `trial_limite_pacientes` ao bater o teto.
`POST /api/v1/pacientes/importar` (bulk fura o cap) é **bloqueado** no trial. Fora do trial,
sem cap. Fail-open em erro de infra.

### CPF obrigatório no signup

`POST /api/v1/auth/medico/signup`: CPF vazio → 400 `cpf_obrigatorio`; inválido → 400
`cpf_invalido` (Luhn). UF/nome já eram exigidos pela validação CFM. O onboarding admin
permanece tolerante (a obrigatoriedade é no endpoint público self).

### Newsletter (inscrição/unsub agora; envio dark)

Migration `0051_newsletter_inscricoes.sql` (**sem RLS** — dado de identidade/marketing; o
unsub é anônimo por token, sem JWT/GUC). Auto-inscrição no `MedicoOnboardingService`
(**fora da transação, best-effort** — não desfaz a conta; não acopla o signup à tabela).
`NewsletterEndpoints`: `POST /api/v1/newsletter/unsubscribe` (anônimo) + `GET/PATCH
/api/v1/me/newsletter` (toggle do médico). Envio real fica atrás de `NEWSLETTER_SEND_ENABLED`
(fail-closed) por causa do SES (CK-4) — fora deste ADR além do scaffolding.

### Frontend

`/me` passa a expor `readOnly`. `PaywallGate` mostra `ReadOnlyBanner` (precede o banner de
prazo). `lib/read-only.ts` espelha os 403 (`read_only_trial`, `trial_limite_pacientes`).
Popup de upsell de IA global (`FeatureUpsellProvider` no layout do dashboard) disparado no
402 `feature_requer_pro` (wired em briefing + escriba). Form de cadastro exige CPF; BFF idem.

## Consequências

- **Mudança de comportamento — condutas.** `CondutasEndpoints` estava **sem nenhum gate**
  (escrevia até com assinatura vencida). Passou a ter `RequireAssinaturaAtiva` +
  `RequireWriteAccess`. Correção desejada, coberta por teste.
- **Invariante clínica preservada (regra #2/#3).** Crise, escalação, portal do paciente,
  checkout, `me/config`, auth e internos **nunca** recebem o filtro (garantia estrutural por
  opt-in, igual ao `AssinaturaGate`). Teste-âncora: crise → 200 no trial.
- **Risco R2 (grupo de escrita esquecer o gate)** mitigado por `WriteAccessCoverageTests`
  (introspecção do `EndpointDataSource` via metadata marcadora).
- **Custo de LLM no trial** limitado pelo cap de pacientes (paciente conversa → orchestrator
  roda LLM). Crise sempre roda independentemente do cap/plano.

## Revisão (pós-PR #83)

Revisão adversarial multi-agente apontou que outros grupos de **escrita operacional do
médico** nunca tiveram `RequireAssinaturaAtiva` (buraco pré-existente, igual ao Condutas):
**Exames** (registrar/cancelar resultado), **Teleconsulta-médico** (`/video/*`), **Memed**
(`POST /receitas`), **Renovações** (`renovada`/`dispensar`) e **Comunicação**
(`POST /comunicacao/rascunho`, que **usa LLM** — era vazamento de spend no trial/vencido).
Todos ganharam `RequireAssinaturaAtiva()` + `RequireWriteAccess()` (o lado **paciente** da
teleconsulta fica intocado). Fecha o vazamento de paywall (vencido) e de trial. O
`WriteAccessCoverageTests` foi endurecido: além de "grupo gateado tem ReadOnly/Feature",
agora também falha se **qualquer** mutador `/api/v1` ficar sem gate de assinatura fora de
uma allowlist explícita de isentos (crise/escalação/portal/auth/checkout/IA-feature/etc.).
Outros fixes: popup de upsell também no RAG; cap de pacientes em try/catch (fail-open);
`GRANT` explícito na 0051; CPF obrigatório com texto do form corrigido.

## Dívida de numeração de ADR

Há **`ADR-055` duplicado** no diretório (`ADR-055-*captcha*` e `ADR-055-*sem-trial*`). Este
ADR é o **065** (próximo livre após 063/064). Não renumerar agora (mudança de docs em massa);
registrar a colisão histórica em 055 a reconciliar.

## Arquivos

- `apps/api-gateway/Auth/ReadOnlyTrialFilter.cs` (novo) · `Services/AssinaturaGate.cs` (sobrecarga `plano`/`TrialReadOnly`)
- `Auth/AssinaturaGateFilter.cs` + `Auth/FeatureGateFilter.cs` (metadata marcadora p/ cobertura)
- `Endpoints/{Prescricoes,Evolucao? (GET-only, não),Consultas,MedicacoesEmUso,Insights,Condutas}Endpoints.cs` (`.RequireWriteAccess()`)
- `Endpoints/PacientesPsiqEndpoints.cs` (cap) · `Endpoints/AuthEndpoints.cs` (CPF + `readOnly` no /me)
- `Services/MedicoOnboardingService.cs` (auto-inscrição) · `Endpoints/NewsletterEndpoints.cs` (novo) · `Program.cs`
- `infra/migrations/0051_newsletter_inscricoes.sql` (novo)
- web: `lib/use-me.ts`, `components/assinatura/{read-only-banner,feature-upsell}.tsx` (novos), `paywall-gate.tsx`, `app/medicos/cadastro/page.tsx`, `app/api/medico-signup/route.ts`, briefing/escriba/RAG pages
- testes: `ReadOnlyTrialFilterIntegrationTests`, `TrialCapPacientesTests`, `NewsletterIntegrationTests`, `WriteAccessCoverageTests`, `AssinaturaGateTests` (unit)

## Env vars novas

`TRIAL_MAX_PACIENTES` (default 5) · `NEWSLETTER_SEND_ENABLED` (default false, fail-closed) ·
`NEWSLETTER_FROM_EMAIL` · `NEWSLETTER_UNSUB_BASE_URL` (ou reusar `PORTAL_PACIENTE_URL`).
