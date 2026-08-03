# ADR-041: Entrega garantida e escalonamento do alerta de crise ao médico

**Status:** Accepted — Fase 1 implementada; parâmetros clínicos (timings e
remoção do gate de opt-in) com **sign-off registrado em 2026-06-08** (ver "Timings").
**Deploy:** em produção desde 2026-06-09 (merge na `main`, run "Deploy to EC2"
success; migration 0035 aplicada no RDS em 2026-06-08).
**Revisão clinical-safety:** concluída em 2026-06-10 — APROVADA contra as 5
regras inegociáveis. Observações registradas: (a) o e-mail de alerta carrega o
nome do paciente via Resend — PII mínima, sem detalhe clínico, mesmo padrão
anterior; (b) timings da escada permanecem ajustáveis por env e qualquer
mudança exige novo sign-off (ver "Timings").
**Data:** 2026-06-08
**Decisores:** Equipe de engenharia + Patrick Arinelli (responsável pelo projeto)
**Categoria:** Segurança clínica

## Contexto

Quando o protocolo de crise dispara (ADR-005/006), o paciente recebe o texto
fixo de acolhimento e a automação é pausada. Mas o elo que fecha o loop —
**avisar o médico** — era frágil e podia falhar **em silêncio**:

- O e-mail ao médico era **gated por opt-in com default `FALSE`**
  (`medicos.notif_prefs.crise_email`). Médico que não ligou a flag **nunca**
  era avisado proativamente.
- Era **um único canal** (e-mail Resend), **uma tentativa por tick**, sem
  backoff, sem teto, sem alerta em caso de indisponibilidade do Resend.
- **Não havia confirmação (ack)**: ninguém sabia se o médico viu. Sem ack,
  sem escalonamento, sem retaguarda.
- A trilha `protocolos_crise_acionados.medico_notificado` era gravada como
  `TRUE` no instante do protocolo — **antes** de qualquer envio real —, então
  "notificado" não significava "entregue/visto".

Resultado: um paciente em crise podia ficar **coberto só na aparência**. Isso
fere a regra inegociável **#3 da `clinical-safety` (médico no loop)**.

## Decisão

Tornar a entrega do alerta de crise **garantida, rastreável e escalável**, sem
tocar na detecção (ADR-006), no texto fixo (`crisis_copy`, ADR-005) nem na
pausa de automação — apenas na **entrega + escalonamento + confirmação**.

### 1. Trilha de entrega append-only (migration 0035)

Nova tabela `crise_alerta_eventos` (append-only, trigger de imutabilidade no
padrão do 0007): cada tentativa de cada canal e o ack do médico viram uma
linha. O estado (entregue? confirmado? estágio?) é **derivado por query** — sem
UPDATE. `protocolos_crise_acionados` segue intacto e imutável; a verdade sobre
entrega/ack mora na nova trilha. `medico_notificado=TRUE` passa a significar
"processo de alerta iniciado".

### 2. Sem gate de opt-in para crise

O alerta de crise é **sempre** enviado. Opt-in (`notif_prefs`) governa apenas
notificações não-críticas. Um alerta de crise não pode ser suprimido por uma
preferência default-off.

### 3. Gatilho imediato + watchdog durável

O `crisis_protocol` (orchestrator), após o commit, faz POST best-effort ao
notifier (`/internal/crise/despachar`) — o e-mail sai em segundos, não no
próximo tick. Se o POST falhar (notifier fora no T0), o **watchdog** do notifier
(varre `protocolos_crise_acionados` abertos a cada tick) é a rede durável. O
gatilho nunca bloqueia a resposta SSE ao paciente.

### 4. Escada de escalonamento (Fase 1)

Decisão pura e idempotente (`_proxima_etapa`), testada sem banco:

| Estágio | Quando | Ação |
| --- | --- | --- |
| 0 | imediato | e-mail ao médico (sempre); `in_app` já entregue no dashboard |
| 1 | sem ack > `crise_ack_timeout` (default 10 min) | reenvia e-mail + alerta OPS |
| 2 | sem ack > `crise_ops_timeout` (default 30 min) | alerta OPS crítico |

A escada **para no ack**. Falha repetida de e-mail (Resend indisponível) vira um
evento OPS visível após o teto de tentativas — **a falha deixa de ser silenciosa**.
Na Fase 1, "OPS" = `logger.critical` + linha na trilha (alarme CloudWatch entra
com o item #3 do roadmap de robustez). SMS/WhatsApp e retaguarda são Fases 2/3.

### 5. Confirmação (ack) pelo médico

Dashboard ganha botão **"Estou ciente"** (`POST /api/v1/crise/{id}/ciente`) que
grava um evento `confirmado` e encerra a escada — sem exigir retomar a automação
(isso é ato clínico à parte). **Retomar a automação também grava o ack** (retomar
implica ciência), senão o watchdog escalaria uma crise já resolvida.

### 6. LGPD

E-mail e `crise_alerta_eventos.detalhe` **não contêm detalhe clínico**: o corpo
só diz que um paciente precisa de atenção prioritária + link do painel; `detalhe`
carrega apenas código de canal (ex.: `http_502`, `sem_email`). Crise ignora
quiet-hours e opt-in de marketing.

## Timings — sign-off clínico (2026-06-08)

`crise_ack_timeout_segundos=600` (10 min → reforço + OPS estágio 1) e
`crise_ops_timeout_segundos=1800` (30 min → OPS estágio 2), configuráveis por env.

**Sign-off (regra #2):** estes timings, a escada (e-mail → reforço+OPS → OPS
crítico; SMS/WhatsApp/retaguarda ficam para F2/F3) e a **remoção do gate de
opt-in** (crise passa a alertar sempre, independente de `notif_prefs.crise_email`)
foram **APROVADOS por Patrick Arinelli (responsável pelo projeto) em 2026-06-08**.
Se o responsável clínico formal for outra pessoa (ex.: psiquiatra do projeto),
nomeá-la aqui ao revisar. Mudança futura desses parâmetros exige novo sign-off
documentado.

## Fases

- **Fase 1 (implementada):** trilha 0035, e-mail sempre, gatilho imediato +
  watchdog, escada email→OPS, ack no dashboard, teste da escada no CI (notifier-py
  adicionado ao gate).
- **Fase 2:** SMS + WhatsApp (recomendado **AWS End User Messaging** — in-region,
  sem vendor terceiro; `medicos.wa_id` já existe), push para o médico.
- **Fase 3:** retaguarda (médico de plantão se o titular não confirma), ack
  2-via por resposta SMS/WhatsApp, OPS no CloudWatch/Sentry, monitor de crise no
  `/admin`.

## Consequências

**Positivas:** acaba a falha silenciosa; trilha forense por canal; lógica de
escada pura e testada; alerta de crise não mais suprimível por preferência.

**Custos/limitações:** na Fase 1 o alcance proativo ainda é só e-mail + dashboard
(médico offline depende da retaguarda da Fase 3); `notifier-py` é SPOF (item #3
do roadmap) — se cair, nenhum alerta sai, daí a importância do alarme externo; o
"OPS" é log até o CloudWatch ser ligado.

## Regras respeitadas

- **#3 médico no loop:** reforçada — o aviso ao médico vira garantido e
  confirmável.
- **#5 auditoria append-only:** nova trilha imutável; `protocolos_crise_acionados`
  jamais é editada/apagada.
- **#4 LGPD:** minimização — nenhum detalhe clínico em e-mail/SMS/trilha.
- **#1 e #2:** intocadas — a IA não gera texto de crise; o copy fixo e a
  detecção não mudam.
