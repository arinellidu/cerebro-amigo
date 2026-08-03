# ADR-022: Notificação externa de crise ao médico (e-mail)

**Status:** Accepted
**Data:** 2026-06-03
**Decisores:** Equipe de engenharia + psiquiatra responsável clínico
**Categoria:** Segurança clínica / LGPD

## Contexto

O protocolo de crise grava `notificacoes_medico` (tipo='crise'), mas isso só
aparecia dentro do app. O médico não fica 24/7 no dashboard — um sistema de
segurança que só avisa na tela não avisa de fato.

## Decisão

O `notifier-py` passa a enviar **e-mail** (Resend) ao médico quando há crise:

- **Opt-in:** só para médicos com `medicos.notif_prefs.crise_email = true`
  (configurável em /dashboard/configuracoes).
- **Conteúdo mínimo, sem detalhe clínico (LGPD):** o e-mail não cita "crise",
  diagnóstico, sintoma ou qualquer dado clínico — apenas "paciente X precisa de
  atenção prioritária" + link ao painel. O detalhe fica no app, atrás de auth.
- **Rastreio em tabela separada** `notificacao_entregas` (migration 0013):
  `notificacoes_medico` é imutável (ADR-017), então a entrega por canal é
  registrada à parte. Índice único `(notificacao_id, canal) WHERE status='enviado'`
  garante idempotência (não reenvia).
- Disparo periódico no scheduler do notifier; também há endpoint interno
  `/internal/medico/notificar-crise`.

## Alternativas consideradas

### A — Web push para o médico
Adiada: `push_subscriptions` hoje é só do paciente; exigiria subscriptions do
médico (nova tabela/fluxo). E-mail entrega valor imediato com o Resend já
integrado.

### B — Incluir o contexto clínico no e-mail (mais acionável)
Rejeitada: e-mail é canal externo. Minimização de dado de saúde (LGPD categoria
especial) pesa mais que conveniência. O médico abre o painel autenticado.

### C — Orchestrator dispara o e-mail direto no momento da crise
Preterida: manteríamos LLM/serviço de conversa acoplado a entrega de e-mail. O
notifier é o dono de notificações; ler `notificacoes_medico` desacopla e dá
idempotência natural.

## Consequências aceitas

1. Latência de até um tick do scheduler entre a crise e o e-mail. Aceitável: o
   app já notifica em tempo real; o e-mail é reforço para quem está fora.
2. E-mail pouco detalhado por design — leva o médico ao painel.

## Referências

- `apps/notifier-py/app/medico_notify.py` — despacho + rastreio.
- `infra/migrations/0013_notificacao_entregas.sql`
- ADR-017 — imutabilidade do audit trail.
- ADR-019 — retomada de automação pós-crise.
