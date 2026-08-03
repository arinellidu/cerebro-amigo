# ADR-059 — Pricing: sem grátis, 3 planos mensais (Essencial/Pro/Master) com camada de IA gateada por plano

- **Status:** Accepted (revisado em 2026-06-16)
- **Data:** 2026-06-16
- **Decisor:** Dono (Patrick).
- **Relacionados:** ADR-055 (sem trial / paywall / cadência), ADR-034 (cobrança do médico
  via Asaas, Fluxo A), ADR-040 (escriba), ADR-028 (RAG), ADR-027 (MBC), skill `dotnet-gateway`.

> **Revisão (2026-06-16).** A 1ª versão deste ADR (mesmo dia) propunha **Inicial mensal +
> 2 planos Consultoria trimestrais (venda assistida)**. Antes do go-live o dono trocou o
> desenho por **3 planos mensais self-checkout** diferenciados pela **camada de IA**
> (Essencial/Pro/Master). Consultoria trimestral e o plano Clínica saíram da oferta inicial.
> Esta versão substitui a anterior; o `arg cycle` do Asaas (ADR-055) fica reservado p/ futuro.

## Contexto

O `/precos` ainda anunciava **"grátis 14 dias"**, embora o backend já não tenha trial
(ADR-055: onboarding nasce `pendente` + prazo de pagamento). O dono decidiu um modelo
**pago e premium** que embute os custos de IA/infra. O eixo de diferenciação escolhido foi
a **camada de IA doctor-facing**: a operação clínica completa fica em todos os planos, e o
preço sobe conforme o médico libera mais IA.

## Decisão

### Catálogo (constante única, sem tabela)
3 planos fixos → `PlanCatalog` (`apps/api-gateway/Services/PlanCatalog.cs`) é a **fonte da
verdade server-side**, não uma tabela `plano_catalogo`. O valor cobrado vem **sempre** daqui;
o cliente nunca manda valor. Reusa os **códigos físicos** de `assinaturas.plano` (TEXT, sem
CHECK), **sem migration**.

| Código | Label | Cadência | Cycle Asaas | Valor cobrado | `valor_mensal` | Self-checkout | Features de IA |
|---|---|---|---|---|---|---|---|
| `starter` | Essencial | mensal | MONTHLY | R$ 397/mês | 397 | sim | Briefing IA |
| `pro` | Pro | mensal | MONTHLY | R$ 597/mês | 597 | sim | + Insights + Busca semântica (RAG) |
| `master` | Master | mensal | MONTHLY | R$ 997/mês | 997 | sim | + Escriba (toda a camada de IA) |
| `enterprise` | Clínica (legado) | — | — | — | — | **não** | toda a IA (alias p/ linhas antigas) |

`trial`/`pendente`/null/desconhecido = **sem feature de IA** (fail-safe de custo). `enterprise`
é alias legado (Clínica da versão anterior): fora do self-checkout, herda toda a IA p/ não
cegar quem o admin já tenha colocado lá. Não é ofertado.

### Fatiamento da camada de IA (1 / +2 / +1)
Núcleo clínico (registros, escalas/MBC, exames, agenda, teleconsulta, evolução) + segurança
(crise/auditoria/LGPD) ficam em **todos** os planos e **nunca** são gateados. O que escala:

| Feature (key) | Essencial | Pro | Master |
|---|:--:|:--:|:--:|
| Briefing pré-consulta IA (`briefing_ia`) | ✓ | ✓ | ✓ |
| Insights dos 5 agentes (`ia_insights`) | — | ✓ | ✓ |
| Busca semântica / RAG (`rag`) | — | ✓ | ✓ |
| Escriba — transcrição + rascunho (`escriba`) | — | — | ✓ |

### FeatureGate (enforcement, novo)
`FeatureGateFilter` (`apps/api-gateway/Auth/FeatureGateFilter.cs`) é um endpoint filter
**opt-in** (`.RequireFeature("key")`) aplicado **só** nos endpoints da camada de IA:
insights, RAG, escriba e o resumo pré-consulta (briefing). Plano sem a feature → **402
`feature_requer_pro`** com `{feature, checkoutUrl}` → a UI abre o upsell. Núcleo clínico,
crise, portal e auth **nunca** recebem o filtro.

É uma camada **separada** do `AssinaturaGate` (ADR-055): o AssinaturaGate decide se o
**dashboard** está liberado (pagamento em dia); o FeatureGate decide se o **plano** inclui a
feature de IA. Acesso liberado ≠ feature inclusa.

**Contraste de fail-safe (intencional):**
- `AssinaturaGate` → **fail-OPEN** em dado ausente (sem linha de assinatura, erro de DB):
  nunca cegar o dashboard nem a crise por falha técnica (invariante clínica).
- `FeatureGate` → **fail-CLOSED** em plano nulo/legado/desconhecido: nunca liberar LLM pago
  de graça (invariante de custo). Crise segue intocada (não é feature de IA).

### Front
`GET /api/v1/auth/me` devolve `plano` + `features` (= `PlanCatalog.FeaturesDe`). O front
(`lib/feature-gate.ts` + `components/assinatura/upsell-feature.tsx`) usa isso p/ **travar a
afordância** de IA proativamente (mostrar upsell em vez de quebrar) e trata o **402** como
fallback reativo. `/precos`, `dashboard/financeiro` e os labels do `/admin/financeiro`
exibem os 3 planos — sincronizados com o catálogo (valor cobrado é sempre server-side).

### MRR = mensalidade-equivalente
Como os 3 planos são mensais, `valor_mensal == valor do ciclo` (397/597/997). `SUM(valor_mensal)
WHERE status='ativa'` (cockpit/MRR) segue recorrente-mensal direto.

### Margem de IA
O preço embute IA + infra. Haiku é o default + spend-limit no Console → custo LLM/médico <<
preço; monitorar por médico em `/admin/custos` (Custos de IA).

## Consequências
- **Sem migration** (`plano` sem CHECK). `trial`/`pendente` aceitos como legado nos enums
  (gateway + admin Zod); `master` adicionado a esses enums e aos selects do `/admin/financeiro`.
- **Consultoria trimestral e Clínica saíram** da oferta inicial. O catálogo atual é todo
  `MONTHLY`; o `arg cycle` do `AsaasClient` (ADR-055) continua existindo, reservado p/ futuro.
- **Pré-checkout sem IA:** o self-signup nasce `pendente` sem plano escolhido → FeatureGate
  fail-closed bloqueia a IA até o checkout. Aceitável e cost-safe (o dashboard core abre).
- **Go-live do pricing pago real depende de Asaas PROD** (ADR-055 Fase C) + `ASAAS_WEBHOOK_TOKEN`.
- **4 fontes de display** (PlanCatalog autoritativo; `/precos`, `dashboard/financeiro`,
  `/admin/financeiro` só exibem) — manter sincronizadas.

## Regras respeitadas
- **Paywall/clinical-safety** (ADR-055) intactos — `AssinaturaGate` não foi tocado; **crise
  nunca gateada** (nem por assinatura, nem por feature). FeatureGate é opt-in só na IA.
- Catálogo server-side; cliente nunca define preço.
- Testes: `PlanCatalogTests` (preços/tiers/features) + `FeatureGateIntegrationTests`
  (402 por plano, fail-open vs fail-closed) no gate do CI.
