# ADR-055: Sem trial — acesso por assinatura com prazo de pagamento (paywall) + cadência mensal/trimestral

**Status:** Accepted — Fases A/B/D implementadas (PRs #58/#59); Fase C/E pendentes.
**Data:** 2026-06-15
**Decisores:** Dono (Patrick) + equipe de engenharia; revisão `clinical-safety` do gate: **OK** (ver "Decisão de implementação do gate").
**Categoria:** Produto / Negócio / Segurança clínica
**Relação:** estende e revê a premissa de **trial** do **ADR-034** (cobrança recorrente)
e do **ADR-046** (onboarding cria assinatura `trial` de 30 dias). Não cria modelo
de tenancy novo (ADR-042). Acompanha a reestruturação de planos da `/precos`
(Solo Pro / Solo Consultoria / Clínica Consultoria).

## Contexto

Dois fatos apurados no código:

1. **Não existe paywall hoje.** `assinaturas.status` (trial/ativa/suspensa/cancelada)
   e `trial_ate` só são **gravados** (onboarding), **exibidos** ("Minha assinatura")
   e usados em **ferramentas do admin** (relatório de trials vencendo, MRR, cockpit).
   **Em lugar nenhum o acesso é bloqueado** por status ou prazo — o acesso é só por JWT.
   Logo, um médico de self-signup (ADR-046, CRM verificado) ganha **acesso clínico
   completo, de graça, por tempo indeterminado**.
2. O onboarding cria `status='trial'` + `trial_ate = NOW() + 30 dias`, nunca enforced.

Decisão do dono (2026-06-15): **não haverá período trial**. O médico é cliente
desde o cadastro; o acesso pleno vem com o **pagamento confirmado**. Para acomodar a
logística de pagamento (Pix/boleto demora a compensar; o médico precisa de alguns
dias para acertar), abre-se um **prazo curto de pagamento** — não um trial de
avaliação.

## Decisão

**Paywall por assinatura, sem trial, com prazo de pagamento.**

- **Onboarding (sem trial):** cria a assinatura em `status='pendente'` com
  **`prazo_pagamento_ate = NOW() + X dias`** (coluna nova; **não** reusar `trial_ate`,
  cuja semântica é de trial). `X` = **7 dias** (config `ASSINATURA_PRAZO_PAGAMENTO_DIAS`, default 7;
  ajustado de 5→7 em 2026-06-25). Vale para
  admin e self-signup. O campo `trial_ate` fica deprecado para linhas novas.
- **Durante o prazo (`pendente`, dentro de `prazo_pagamento_ate`):** o médico tem
  acesso ao dashboard para configurar e começar, e vê um aviso persistente
  "conclua o pagamento da sua assinatura" com o link de pagamento.
- **Pagamento confirmado (webhook Asaas → `ativa`):** acesso **total às features do
  plano**, sem prazo. (Webhook já existe — `CobrancasEndpoints`, ADR-034.)
- **Prazo vence sem pagamento (`pendente` e `NOW() > prazo_pagamento_ate`, ou
  `suspensa` por inadimplência):** o **dashboard do médico é bloqueado** por uma tela
  "ative sua assinatura para continuar" + link de pagamento. **Mas ver a invariante
  clínica abaixo.**
- **Cadência de cobrança por plano** (Asaas `cycle` deixa de ser fixo MONTHLY):
  - **Solo Pro → MENSAL.**
  - **Solo Consultoria / Clínica Consultoria → TRIMESTRAL** (casa com o mínimo de 3
    meses). Valor do ciclo = 3× a mensalidade com **10% de desconto**:
    Solo Consultoria **R$ 4.023/trimestre**; Clínica a partir de **R$ 7.830/trimestre**.
- **Como o médico paga (v1):** reusar a ativação Asaas do ADR-034 (admin "Ativar
  cobrança Asaas" → link enviado ao médico) **e/ou** expor um botão de pagamento na
  tela "ative sua assinatura" (self-checkout — link da subscription Asaas). Com prazo
  curto + self-signup, o **v1 já é self-checkout**: o médico paga sozinho na tela de
  bloqueio (link da subscription Asaas gerado na hora).

### Invariante de segurança clínica (NÃO viole)

> **O paywall bloqueia apenas a UI do dashboard do médico. Ele NUNCA desliga a
> detecção de crise (orchestrator) nem a entrega do alerta de crise ao médico
> (notifier-py / e-mail, ADR-041 e ADR-022).**

Racional: se o médico cadastrar pacientes durante o prazo e depois não pagar,
bloquear o dashboard **cegaria a crise** desses pacientes — fere "médico no loop"
(regra #4 da `clinical-safety`). Como o alerta de crise é **empurrado** por canal
próprio (e-mail/push), independente do login no dashboard, um médico com a UI
bloqueada **continua recebendo** o alerta. Assim:

- `pendente` recém-criado = **zero pacientes** (não dá pra cadastrar paciente sem
  acesso) → bloquear é 100% seguro, sem responsabilidade clínica.
- `suspensa`/prazo vencido **com pacientes ativos** → dashboard bloqueado, **mas o
  canal de crise segue** entregando. O offboarding "de verdade" (transição/baixa de
  pacientes com continuidade de cuidado) é projeto à parte, fora deste ADR.
- A tela de bloqueio nunca esconde um caminho de crise/segurança; só o trabalho
  administrativo/produto fica atrás do paywall.

## Modelo de estados (assinaturas.status)

```
pendente  → em prazo de pagamento (acesso liberado + aviso)
ativa     → pagamento confirmado (acesso total às features do plano)
suspensa  → prazo vencido sem pagar OU inadimplência pós-ativação (dashboard gated;
            crise NUNCA gated)
cancelada → encerrada
```

`trial` deixa de ser criado (mantido no enum só para linhas legadas até migração de
dados, se houver). Atualizar os enums e contadores que hoje falam "trial":
`AdminEndpoints`/`/admin/financeiro` (z.enum status/plano), cockpit de aquisição
(`emTrial` → `emPrazo`/`pendente`), receita (`trials.*`), MRR (já filtra `ativa`).

## Onde mora (fronteira)

- **Gate (enforcement):** decisão de **acesso do médico** = transacional, no
  **api-gateway (.NET)** e/ou no **BFF/dashboard layout** (web). O status efetivo
  (`pendente`-em-prazo vs vencido vs `ativa`) é derivado server-side; o front só
  renderiza a tela de bloqueio. Sem LLM.
- **Cobrança:** Asaas via gateway (ADR-034). `cycle` passa a variar por plano.
- **Crise:** **inalterada** — orchestrator + notifier (ADR-041/022). O paywall não
  toca esse caminho.

## Parâmetros (confirmados 2026-06-15)

1. **`X` (dias de prazo de pagamento): 7** — config `ASSINATURA_PRAZO_PAGAMENTO_DIAS` (default 7; era 5, ajustado em 2026-06-25).
2. **Trimestral dos planos Consultoria: 3× a mensalidade com 10% de desconto** —
   Solo Consultoria R$ 4.023/tri; Clínica a partir de R$ 7.830/tri.
3. **Pagamento no v1: self-checkout** — o médico paga sozinho na tela de bloqueio.

## Progresso

- ✅ **Fase A (fundação) — PR #58:** migration `0045` (`assinaturas.prazo_pagamento_ate`)
  **APLICADA em prod 2026-06-15** (coluna verificada via SSM); `MedicoOnboardingService`
  cria `pendente` + prazo (`ASSINATURA_PRAZO_PAGAMENTO_DIAS`, default 7); `/medico/signup`
  passa `plano='pendente'`.
- ✅ **Fase B (expõe situação) — PR #58:** `AssinaturaGate.Avaliar(status,prazo,trial,now)`
  (puro) exposto em `GET /api/v1/minha-assinatura` e `GET /api/v1/auth/me`
  (`liberado/bloqueado/emPrazo/diasRestantes/motivo`). Sem enforcement.
- ✅ **Fase D (gate + UI) — PR #59:** enforcement ligado. Ver "Decisão de implementação do gate".
- ⏳ Fase C (self-checkout): botão "Pagar agora" na tela de bloqueio (reusa `invoiceUrl`
  de `ObterLinkAtualAsync`, já existe). Depende de Asaas prod.
- ✅ **Fase 2 (cadência + pricing) — ADR-059:** Asaas `cycle` por plano (MONTHLY/QUARTERLY)
  via `AsaasClient.CriarAssinaturaAsync(..., cycle)`. Catálogo final em `PlanCatalog`
  (códigos físicos reusados): **Inicial/Solo Pro `pro`** R$497/mês (MONTHLY, self-checkout) ·
  **Solo Consultoria `starter`** R$4.023/tri (QUARTERLY) · **Clínica Consultoria `enterprise`**
  a partir de R$7.830/tri (QUARTERLY). Grátis removido do `/precos`. Consultoria = venda
  assistida (admin "Ativar cobrança"); só o Inicial tem self-checkout público. `valor_mensal`
  guarda a mensalidade-equivalente (MRR coerente). Detalhe em ADR-059.
- ⏳ Fase E (admin/cockpit): `trial`→`pendente` + widget inadimplência + job de
  reconciliação status×Asaas (rede contra webhook perdido).

## Decisão de implementação do gate (Fase D)

O "and/or gateway/BFF" do ADR foi resolvido assim:

- **Enforcement no gateway (autoritativo):** `AssinaturaGateFilter` (`IEndpointFilter`),
  aplicado **opt-in** via `.RequireAssinaturaAtiva()` só nos grupos de **dashboard do
  médico**: `pacientes`, `prescricoes`, `evolucao`, `insights`, `consultas`. Bloqueado →
  **HTTP 402** + JSON `{error, motivo, prazoPagamentoAte, checkoutUrl}`.
- **OPT-IN, não block-by-default (escolha de segurança):** só o que é decorado gateia.
  Endpoint novo esquecido fica **acessível** (fail-open), nunca bloqueia crise por
  omissão. O inverso (block-by-default + whitelist de crise) arriscaria cegar uma crise
  ao esquecer de isentar um endpoint.
- **FAIL-OPEN:** erro de DB / médico ou assinatura ausente / requisição não-médica →
  libera (`await next`). Status desconhecido em `AssinaturaGate.Avaliar` → liberado.
- **Nunca gateado** (sem o filtro): `/api/v1/crise/*`, `/api/v1/notificacoes` (alerta ao
  médico), `/api/v1/portal/paciente/*`, `/internal/*`, `/api/v1/auth/*`,
  `/api/v1/cobrancas` + `minha-assinatura`.
- **UI (web):** `PaywallGate` no `app/dashboard/layout.tsx` — bloqueado → tela "Ative sua
  assinatura"; em prazo → banner. `/dashboard/financeiro` **exenta** (onde o médico paga).
  A tela de paywall **lista as crises ativas** (`GET /api/crise`) com "Estou ciente"
  (`POST /api/crise/{id}/ciente`) — caminho não gateado → médico bloqueado ainda age na crise.
- **Prova (Testcontainers, `AssinaturaGateIntegrationTests`):** médico bloqueado →
  `/api/v1/pacientes` **402** E `/api/v1/crise/ativas` **200**; ativa/em-prazo/sem-assinatura
  liberados. + 13 testes unitários de `AssinaturaGate`.

### Revisão clinical-safety do gate — OK

- **Regra #2 (crise fixa):** gate nunca toca o caminho de crise; `crisis_copy` intacto. ✓
- **Regra #3 (médico no loop):** médico bloqueado recebe alerta por e-mail/push (ADR-041,
  não gateado), age via API de crise não gateada + console de crise na tela de paywall. ✓
- **Regra #4 (LGPD):** gate lê só a própria assinatura do médico; 402 sem PII/conteúdo
  clínico (só status/prazo/checkoutUrl); RLS de tenant vale. ✓
- **Regra #5 (auditoria imutável):** gate é read-only (SELECT); nenhum DELETE/UPDATE em
  trilha. ✓
- **Fail-open** garante que ambiguidade/erro nunca cega crise. ✓

## Consequências / fases sugeridas

1. **Migration:** `assinaturas.prazo_pagamento_ate` (nullable); manter `trial_ate`.
2. **Onboarding (`MedicoOnboardingService`):** `status='pendente'`,
   `prazo_pagamento_ate=NOW()+X`, sem trial. (Admin e self-signup.)
3. **Cadência:** Asaas subscription com `cycle` por plano (MONTHLY/QUARTERLY) e valor
   do ciclo correto.
4. **Gate:** helper server-side `assinaturaLiberada(status, prazo_pagamento_ate)` +
   tela "ative sua assinatura" no dashboard; **com** a invariante de crise.
5. **Admin/cockpit:** enums e rótulos (`trial`→`pendente`/`em prazo`).
6. **(Depois) self-checkout** na tela de bloqueio; **(depois)** offboarding clínico
   de `suspensa` com pacientes.

## Gatilhos de revisão

- Volume de self-signup que exija self-checkout automático (sair do admin-link).
- Necessidade de offboarding clínico real para inadimplentes com pacientes.
- Pedido de desconto ou outra cadência de cobrança por plano.
