# ADR-027: Measurement-Based Care — captura, desfecho e agente

**Status:** Accepted
**Data:** 2026-06-04
**Decisores:** Equipe de engenharia + psiquiatra responsável clínico
**Categoria:** Produto / Segurança clínica

## Contexto

PHQ-9 e GAD-7 existiam apenas como `questionarios` + `questionarios_respostas`
(schema/seed) e entrega via `checkins` — mas **a captura nunca foi ligada** (o
portal mostrava um placeholder "responda com sua psiquiatra"). Faltava o que
torna a coleta clinicamente útil: a **camada de desfecho** (Measurement-Based
Care) — trajetória do score, **resposta** (queda ≥ 50%), **remissão** (PHQ-9/GAD-7
< 5), tempo até resposta e o alerta de ouro: **não-resposta em 4-6 semanas** após
início/troca de medicação. É o item S1 do roadmap.

Decisão de produto (onde capturar): **auto-relato do paciente no portal** — alinha
com o posicionamento "entre consultas" e reaproveita a entrega por check-in. Isso
expõe um ponto sensível: o **item 9 do PHQ-9 é ideação suicida**.

## Decisão

1. **Captura no portal (auto-relato).** Instrumento PADRONIZADO e versionado no
   gateway (`EscalasCatalogo`, `phq9-gad7-v1`) — itens/opções (0-3) e cutoffs em
   um único lugar; servido por `GET /api/v1/portal/paciente/escalas/{codigo}`. O
   front (`QuestionarioEscala`) só renderiza. O scoring é determinístico (soma) e
   já gravava em `questionarios_respostas` (reusado, sem migration nova).

2. **Gate de crise no item 9 (clinical-safety #2).** Se PHQ-9 item 9 > 0, o
   gateway chama `POST /internal/crise/trigger` no agents-py, que REUSA o núcleo
   do protocolo (`acionar_protocolo`, refatorado a partir de
   `acionar_protocolo_diario`): texto fixo de `crisis_copy` (nunca LLM), trilha
   append-only em `protocolos_crise_acionados`, `notificacoes_medico`, e
   `automacao_pausada = TRUE`. É **determinístico** (gatilho certo → `confianca
   1.0`, sem classificador). O score é gravado mesmo na crise (dado que o médico
   precisa ver). Fail-safe: se o agents-py falhar, o portal exibe o acolhimento
   mínimo de emergência (CVV 188 / SAMU 192) — o paciente nunca fica sem recurso.

3. **Camada de desfecho (leitura do médico).** `GET /api/v1/pacientes/{id}/
   escalas/historico` devolve a série por escala + baseline, atual, variação %,
   resposta, remissão e tempo-até-resposta (tudo factual, calculado no gateway).
   Nova aba **"Evolução de escalas"** no prontuário (`EvolucaoEscalasPanel`):
   gráfico da trajetória + selos resposta/remissão + nota factual de não-resposta
   pós-troca. A IA não interpreta; o médico decide (regra #1).

4. **Agente `desfecho` (agents-py) — DETERMINÍSTICO, sem LLM.** Varre pacientes
   cuja última mudança de medicação (`prescricao_eventos`) foi há 4-17 semanas,
   correlaciona com a trajetória das escalas e grava um `insight`: severidade
   **alta** quando há não-resposta (queda < 50%) há ≥ 4 semanas; **info** quando
   houve resposta/remissão. Cadência diária, `dedup_window=168h` (1/semana).
   Shadow-safe (só escreve `insights`, não fala com o paciente).

### clinical-safety

- **#1 IA não pratica medicina:** scoring, cutoffs, resposta/remissão e o agente
  são determinísticos — agregação factual. Nenhuma conduta/dose é sugerida; o
  alerta de não-resposta é só um fato, sem recomendação.
- **#2 Crise fixa:** item 9 reusa o protocolo pré-aprovado (texto de `crisis_copy`,
  nunca LLM); fail-safe garante recurso ao paciente.
- **#4 LGPD:** só números/datas nos insights e logs; o `motivo` da crise é
  categoria (`ideacao_suicida_phq9`), nunca texto verbatim.
- **#5 Auditoria imutável:** `protocolos_crise_acionados`/`notificacoes_medico`
  append-only (triggers do banco); o agente só faz INSERT em `insights`.

## Consequências

- **Sem migration nova:** `questionarios_respostas` (score_total, respondido_em)
  já bastava; correlação com `prescricao_eventos` é por tempo.
- Gateway: `EscalasEndpoints` (+ `EscalasCatalogo`), gate de crise em
  `CheckinsEndpoints.ProcessarRespostaQuestionario` (chamada interna ao agents-py).
- agents-py: `acionar_protocolo` (núcleo extraído; `acionar_protocolo_diario`
  preserva o comportamento), endpoint `/internal/crise/trigger`, agente `desfecho`
  (registry + scheduler).
- Web: `QuestionarioEscala` (portal), `EvolucaoEscalasPanel` (prontuário) + rotas
  BFF (`/api/paciente/escalas/{codigo}`, `/api/pacientes/{id}/escalas/historico`).
- **Fora deste ADR (futuro):** cadência adaptativa anti-fadiga (A3) sobre estas
  escalas; painel agregado de desfechos da carteira (B5); usar o item 9 também
  no GAD-7 (não há — GAD-7 não tem item de ideação).
