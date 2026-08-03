# ADR-021: Escopo administrativo da IA de comunicação

**Status:** Accepted
**Data:** 2026-06-03
**Decisores:** Equipe de engenharia + psiquiatra responsável clínico
**Categoria:** Segurança clínica

## Contexto

O médico se beneficia de ajuda para redigir comunicação **administrativa** ao
paciente (remarcar, confirmar presença, lembrete logístico). O risco é a IA
escorregar para conteúdo clínico — diagnóstico, sintoma, dose, conduta,
aconselhamento — o que viola a regra #1 (a IA não pratica medicina).

## Decisão

1. **Geração só em Python** (orchestrator-py), nunca no gateway nem no front.
   Endpoint interno `/internal/comunicacao/rascunho-admin` (Haiku via Bedrock).
2. **Guard imutável no código** (`_GUARD_ADMIN`, constante) — não vive na tabela
   `prompts` editável. Mesma filosofia do `crisis_copy` (ADR-005): um guard
   clínico-sensível não pode ser alterado via UI para passar a permitir conteúdo
   clínico. O prompt permite apenas administrativo; se o pedido exigir clínico,
   o modelo responde `[NÃO ADMINISTRATIVO]` e o front mostra recusa.
3. **Gateway só faz proxy** (`ComunicacaoEndpoints`), com tenant check.
4. **Médico no loop:** o rascunho volta editável; **não há envio automático** ao
   paciente — o médico revisa e envia pelo próprio canal. PII redatada em trace.

## Alternativas consideradas

### A — Prompt na tabela `prompts` (editável no dashboard)
Rejeitada para o guard: um texto que define a fronteira "administrativo vs
clínico" não deve ser editável livremente (poderia ser afrouxado e passar a
gerar conteúdo clínico). Fica constante no código, revisável por PR.

### B — IA rascunha conteúdo clínico para o médico "só aprovar"
Rejeitada: viola a regra #1. Mesmo com aprovação humana, a decisão clínica não é
rascunhada pela IA. A IA organiza/administra; o clínico é do médico.

### C — Envio automático do rascunho ao paciente
Adiada: é ação outward-facing (entrega ao paciente) e merece desenho próprio de
canal, consentimento e auditoria de entrega. Por ora, copy-paste pelo médico.

## Consequências aceitas

1. O rascunho é copiado pelo médico (sem auto-envio) — fricção aceitável e segura.
2. Guard imutável: alterar o escopo exige PR com revisão clínica.

## Referências

- `apps/orchestrator-py/app/main.py` — `rascunho_admin` + `_GUARD_ADMIN`.
- `apps/api-gateway/Endpoints/ComunicacaoEndpoints.cs` — proxy.
- `apps/web/components/comunicacao/rascunho-admin.tsx` — composer.
- ADR-005 — texto de crise fixo (filosofia de artefato clínico imutável).
- skill `clinical-safety` — regra #1.
