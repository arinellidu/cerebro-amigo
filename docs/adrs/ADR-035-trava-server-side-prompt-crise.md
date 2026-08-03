# ADR-035 — Trava server-side dos prompts de salvaguarda clínica

**Status:** aceito · 2026-06-06
**Contexto relacionado:** [[ADR-005]] (versionamento do texto de crise), [[ADR-006]] (fail-safe do classificador de crise), clinical-safety regras 2 e 3

## Contexto

O editor de prompts (`/admin/prompts`) permite que admin/owner versionem e ativem
os prompts system dos agentes. Dois prompts são **salvaguardas clínicas** e não
podem ser alterados por um clique no painel (regra inegociável #2 — protocolo de
crise fixo e pré-aprovado; #3 — auditoria da resposta ao paciente):

- `orchestrator:crisis_detection` — classificador de detecção de crise;
- `orchestrator:audit` — auditoria da resposta ao paciente.

Até aqui a única trava era **client-side** (`apps/web/lib/prompts-guard.ts`):
deixava a UI em modo somente-leitura. Mas o gateway (`POST /api/v1/prompts/` e
`POST /api/v1/prompts/{id}/ativar`) e o BFF (`app/api/prompts/*`) **não checavam
nada** — só validavam role admin/owner. Um admin/owner autenticado podia, via
`fetch` direto no console, criar e ativar uma versão maliciosa de
`crisis_detection` (ex.: sempre retornar `crise_detectada=False`).

Isso era explorável de fato: o `orchestrator-py` lê o prompt **ativo do banco** em
runtime (`prompt_loader.py` → `crisis.py`), com o builtin hardcoded apenas como
fallback; uma versão ativada sobrescreve a salvaguarda em até ~60s (TTL de cache).
Detectado na auditoria do /admin (2026-06-06).

## Decisão

A trava dos prompts de salvaguarda passa a ser **enforçada no servidor** (fronteira
de confiança), não só na UI:

- **Gateway** (`PromptsEndpoints.cs`): conjunto `PromptsTravados`
  (`orchestrator:crisis_detection`, `orchestrator:audit`). `POST /` recusa quando
  `(agente, nome)` é travado; `POST /{id}/ativar` recusa após resolver o
  `(agente, nome)` da versão alvo. Resposta **409 Conflict** com corpo
  `{ error: "prompt_travado", detalhe }`.
- **BFF** (defesa em profundidade): `app/api/prompts/route.ts` (POST) bloqueia via
  `promptTravado()` antes de chamar o gateway; `app/api/prompts/ativar/[id]/route.ts`
  repassa o 409 do gateway. A trava definitiva é a do gateway.
- **Front** (`lib/prompts-guard.ts`): mantido como UX (modo somente-leitura).

Alterar um prompt de salvaguarda continua possível **fora do painel** — exige
decisão clínica + validação SHADOW + novo ADR, nunca um POST de runtime.

## Consequências

- Mesmo com conta admin/owner comprometida, não se troca o classificador de crise
  nem a auditoria por API — respeita clinical-safety regras 2 e 3.
- `409 prompt_travado` é o contrato de erro; a UI já esconde a ação, então só
  aparece no caminho de bypass.
- Lista travada duplicada em TS (`prompts-guard.ts`) e C# (`PromptsEndpoints.cs`):
  ao mudar uma, mudar a outra. Aceito (2 entradas, baixo churn).
- Não há proteção no nível do banco (sem trigger/CHECK); a fronteira é a aplicação.
  Suficiente porque os serviços Python não escrevem prompts — só leem.
