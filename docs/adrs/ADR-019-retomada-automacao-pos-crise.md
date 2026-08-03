# ADR-019: Retomada de automação pós-crise (ato do médico, auditado)

**Status:** Accepted
**Data:** 2026-06-03
**Decisores:** Equipe de engenharia + psiquiatra responsável clínico
**Categoria:** Segurança clínica

## Contexto

Quando o protocolo de crise é acionado (orchestrator-py, `crisis.py`), além de
enviar o texto fixo de acolhimento e notificar o médico, o sistema **pausa a
automação** do paciente como circuit-breaker (ADR de defesa em camadas):

- `pacientes.automacao_pausada = TRUE` — agentes, lembretes e check-ins param.
- `conversas.status = 'humano'` — o grafo de conversa encerra sem responder.

Até aqui não havia caminho de produto para **retomar**. A automação ficava
pausada indefinidamente, ou exigia `UPDATE` manual no banco — frágil, sem
trilha de quem retomou e quando. O médico precisa, depois de avaliar a crise,
de uma forma explícita e auditável de religar o acompanhamento.

A trilha `protocolos_crise_acionados` é **append-only** (ADR-017): não pode
receber `UPDATE`/`DELETE`. Logo, o registro do ato de retomada não pode ser uma
mutação dessa linha.

## Decisão

Expor no gateway (.NET) um conjunto mínimo de endpoints **escopados ao médico**
(`CriseEndpoints.cs`):

1. `GET /api/v1/crise/ativas` — pacientes do médico com `automacao_pausada=TRUE`
   e o último gatilho/origem. Só leitura.
2. `GET /api/v1/crise/{pacienteId}` — detalhe da última crise, incluindo o
   `resposta_enviada` (o texto fixo de `crisis_copy`) exibido **somente para
   leitura**. Nunca editável.
3. `POST /api/v1/crise/{pacienteId}/retomar` — o médico retoma a automação:
   - `UPDATE pacientes SET automacao_pausada = FALSE` (escopado ao tenant);
   - `UPDATE conversas SET status = 'aberta'` das conversas em `'humano'`;
   - **INSERT** em `notificacoes_medico` (`tipo='automacao_retomada'`,
     `severidade='info'`) registrando o ato — `INSERT` é permitido pelo guard
     append-only (ADR-017); a trilha de crise **não é tocada**.

No frontend, `components/crise/banner-crise.tsx` aparece no prontuário quando há
crise com automação pausada: mostra o copy fixo (read-only) e o botão "Retomar
automação" com confirmação e observação opcional (que vai para a auditoria).

### Princípios respeitados

- **Regra #2 (crise):** nenhum texto de crise é gerado nem alterado aqui. O
  banner apenas relê `resposta_enviada`.
- **Regra #5 / ADR-017 (auditoria imutável):** `protocolos_crise_acionados`
  permanece intocado; o ato de retomada é um INSERT em `notificacoes_medico`.
- **Médico no loop (regra #3):** a retomada é sempre um ato humano explícito,
  nunca automática.
- **Tenant:** toda query filtra por `pacientes.medico_responsavel_id`.

## Alternativas consideradas

### A — Retomada automática após X horas
Rejeitada: religar automação sem avaliação humana de uma crise é exatamente o
que o circuit-breaker existe para impedir. Decisão é clínica.

### B — Marcar a retomada na própria linha de `protocolos_crise_acionados`
Rejeitada: viola a imutabilidade append-only (ADR-017). O ato vira um registro
novo em `notificacoes_medico`.

### C — Botão de retomar sem registro do ato
Rejeitada: perderíamos a trilha de quem religou e quando — necessária para
reconstruir um incidente. O INSERT de auditoria é barato e obrigatório.

## Consequências aceitas

1. **Reabrir `conversas` em `'humano'` inclui escaladas do auditor**, não só
   crise. Aceito: a retomada é por paciente e o médico decide deliberadamente;
   ao retomar, ele assume que as conversas pendentes daquele paciente voltam ao
   fluxo automático.
2. **A automação só volta por ação do médico.** Fricção desejada.
3. **Auditoria cresce** com linhas `automacao_retomada`. Aceitável e desejável.

## Referências

- `apps/api-gateway/Endpoints/CriseEndpoints.cs` — endpoints.
- `apps/web/components/crise/banner-crise.tsx` — UI read-only + retomada.
- `apps/orchestrator-py/app/conversation/nodes/crisis.py` — acionamento/pausa.
- ADR-005 — versionamento do texto de crise (não alterado por este ADR).
- ADR-010 — crise no diário.
- ADR-017 — imutabilidade do audit trail no banco.
