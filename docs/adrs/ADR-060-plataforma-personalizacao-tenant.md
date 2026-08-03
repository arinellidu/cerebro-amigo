# ADR-060 — Plataforma de personalização por tenant (consultoria) — DESENHO

- **Status:** Proposed (desenho de referência; **não implementado**)
- **Data:** 2026-06-16
- **Relacionados:** ADR-059 (planos Consultoria que prometem "features sob medida"),
  ADR-042 (RLS de tenant), ADR-035 (trava server-side de prompts), skill `clinical-safety`.

## Contexto

Os planos **Consultoria** (ADR-059) vendem **consultoria personalizada + features sob medida** por
médico/clínica. Surge a pergunta: como entregar "uma plataforma personalizada por cliente" sem
multiplicar codebases? Este ADR fixa a **arquitetura** (não constrói nada ainda) — para quando o
1º cliente Consultoria pedir uma feature.

## Princípio #1 — NÃO forkar por cliente

Um único codebase, um único deploy, multi-tenant (já é). "Um Cérebro Amigo por clínica" = inferno:
patch/feature × N forks, **LGPD de saúde × N bancos**, deploy × N, segurança inauditável. Não
escala. **O "personalizado" é dado de configuração por tenant, não código bifurcado.**

## Decisão (desenho)

Personalização em camadas, do mais leve ao mais pesado:

1. **Prompts por tenant — JÁ EXISTE.** Editor de prompts + `prompt_loader` (DB > builtin) já
   customizam o comportamento da IA por médico, sem deploy. 1º vetor de personalização.
   (Trava server-side dos prompts de salvaguarda continua — ADR-035.)
2. **Feature flags / entitlements por tenant — a construir (núcleo da consultoria):**
   - **Migration:** `tenant_features (medico_id|clinica_id, feature_key, habilitada, config_json,
     criado_em)`. Sem FK cross-schema; escopada por tenant.
   - **Gateway:** helper `TemFeature(medico, "x")` (mesmo padrão de `RequireAssinaturaAtiva()` /
     RLS) + expor as flags ligadas em `GET /api/v1/auth/me`.
   - **Front:** lê as flags do `/me` e liga/desliga UI.
3. **Branding/white-label** (logo, cores, textos) como config por tenant — quando justificar.
4. **Módulos opt-in** (features grandes ligáveis por tenant) — evolução futura.
5. **Deploy dedicado** — só enterprise gigante que exija isolamento físico. **Evitar.**

### Fluxo da consultoria
Cliente pede feature X → constrói-se **genérico, atrás de uma flag** no codebase único → liga a
flag **só pro tenant dele** → se X vira útil pra todos, **promove** ao produto base / tier. O
produto-base evolui com o dinheiro da consultoria; ninguém mantém fork.

## Invariante inegociável (clinical-safety)

Toda feature custom passa pelo **mesmo piso clínico**: protocolo de crise fixo, auditoria
append-only, LGPD/minimização, médico no loop, **RLS de tenant**. Custom feature **nunca** é atalho
clínico nem cruza tenants. Flag liga/desliga UI e capacidade — não relaxa guardrail.

## Consequências
- Incremento sobre o que existe (RLS + prompt editor + campo `plano`), não reescrita.
- **Nada construído agora** — este ADR é a referência. A implementação (migration + gate + `/me` +
  UI) é esforço próprio, disparado pela 1ª demanda real de um cliente Consultoria.
- O pricing (ADR-059) só precisa do label/posição "Consultoria"; a plataforma de flags vem depois.
