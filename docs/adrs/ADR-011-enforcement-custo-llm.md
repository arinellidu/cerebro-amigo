# ADR-011: Enforcement do teto de custo diário de LLM (`MAX_DAILY_LLM_USD`)

- **Status:** Aceito — **implementado 2026-06-11** (ver Amendment no fim). O gate descrito na Decisão está em vigor no `agents-py`; sai-se da Alternativa B.
- **Data:** 2026-06-01
- **Depende de:** [ADR-015](ADR-015-llm-provider-switchavel.md) (camada LLM provider-switchável), que introduziu o price map provider-aware, o `compute_cost()` e a gravação de `custo_usd`.

## Contexto

`MAX_DAILY_LLM_USD` existia no `.env.example` mas nunca foi enforced — não havia price map, `compute_cost()` nem `custo_usd` gravado (era sempre NULL). O ADR-015 fechou a parte de **observabilidade**: cada chamada agora tem custo calculado por `provider`+`tier` e `custo_usd` é persistido. Falta decidir **se e como** transformar isso em **enforcement** (barrar gasto) — com uma restrição inegociável: um teto de custo **não pode, em nenhuma hipótese, suprimir um caminho crítico de segurança clínica**.

O sistema tem dois planos com perfis de risco opostos:

- **Plano interativo** (`orchestrator-py`): conversa + `detect_crisis` + streaming SSE. Latency-sensitive e *safety-critical* — um paciente em ideação suicida pode estar do outro lado esperando os tokens.
- **Plano batch** (`agents-py`): agentes agendados. Deferível — uma execução pulada hoje roda amanhã sem dano agudo. **Exceção dentro do batch:** `risco_silencioso` detecta deterioração silenciosa; é *safety-relevant*, ainda que não seja tempo real.

## Decisão

**Regra central: "batch pausa, crise nunca".** O gate de custo atua **somente** sobre o plano batch não-crítico. O critério de isenção é **relevância de segurança**, não apenas "interativo vs batch":

1. **Interativo (orchestrator: conversa + crise) — NUNCA gateado.** Custo jamais bloqueia uma chamada do caminho interativo. Sem exceção, sem flag que possa desligar isso.
2. **Batch safety-relevant (`risco_silencioso`) — isento, ou o último a pausar.** Detecção de risco não para por orçamento. Se algum dia parar, é o último item e com alerta explícito.
3. **Batch de analytics/conveniência (`padroes`, `adesao`, resumos não-urgentes, etc.) — primeiros a pausar.** Ao estourar o teto, o scheduler **para de despachar novas execuções desses agentes pelo resto do dia**; execuções em voo terminam normalmente.

**O teto in-app é controle operacional, não a trava de dinheiro.** A trava de última linha é o limite de plataforma: **limite de gasto mensal + alertas na Console da Anthropic** (e AWS Budgets quando rodando em Bedrock). O `MAX_DAILY_LLM_USD` existe para dar granularidade diária e conter um loop de scheduler antes que ele consuma o orçamento mensal — **não** deve ser tratado como teto rígido (é intencionalmente poroso para o interativo).

**Best-effort / fail-open.** O gate nunca pode derrubar o produto. Se a contabilização falhar (banco indisponível, `compute_cost` lança, total do dia ilegível): **logar + alertar + prosseguir** nos dois planos. A trava mensal de plataforma é o backstop do pior caso. O valor do teto diário é pegar *drift* cedo (via alerta), não ser um muro intransponível.

**Alertar antes de bloquear.** Emitir alerta em ~50% / 80% / 100% de `MAX_DAILY_LLM_USD`. A pausa do batch precisa ser **observável** (log + notificação), nunca silenciosa — batch que para sem aviso é risco operacional (analytics somem sem ninguém perceber).

### A definir na implementação

- **Fronteira do dia:** `America/Sao_Paulo` (intuição de "orçamento diário" local) vs UTC (mais simples). Tem de ser consistente com como `custo_usd` é agregado. Recomendação: timezone local.
- **Calibrar o threshold a partir do `custo_usd` real** já acumulado — `$5.00` é placeholder, não um número validado. (Foi exatamente por isso que observabilidade veio antes de enforcement.)
- **Mecânica do gate** = (a) somar `custo_usd` do dia corrente, (b) checagem pré-despacho no scheduler do `agents-py`, (c) lógica de isenção dos itens 1–2 acima.

## Alternativas consideradas

- **A — Gate global rígido** (bloquear *todas* as chamadas, inclusive crise, ao estourar o teto). **Rejeitada:** clinicamente inaceitável; orçamento não pode censurar o caminho de crise.
- **B — Nenhum gate in-app; apenas limite de plataforma + alertas.** **Defensável como "bom o suficiente"** para um produto solo em pré-produção: observabilidade (ADR-015) + limite mensal na Console da Anthropic + alertas já cobrem o essencial. Custo desta alternativa: sem pausa diária granular e sem corte cirúrgico do batch — um loop pode gastar até o teto *mensal* antes de alguém agir (mitigado por alerta, não estancado dentro do dia). **Esta é a posição atual aceita, até surgir motivo para implementar o gate completo descrito na Decisão.**

## Consequências

- **Positivas:** caminhos safety-critical isentos por design; gasto do batch contível em granularidade diária; reaproveita a observabilidade já entregue no ADR-015.
- **Tradeoffs:** lógica extra no despacho do scheduler; exige definição clara da fronteira de dia; analytics podem atrasar em dias caros (aceitável — são deferíveis); o gate é poroso de propósito, logo **não** é teto de gasto rígido — a trava mensal de plataforma é.
- **Se não implementado:** permanecemos na Alternativa B (observabilidade + limite de plataforma + alertas), que é aceitável por ora.

## Amendment — implementação (2026-06-11)

Gate implementado no `agents-py`, fiel à Decisão:

- **`app/core/cost_gate.py`** (novo): `should_dispatch(agent_name, cap)` decide o despacho.
  - **Interativo nunca gateado:** o módulo só é importado pelo scheduler do `agents-py` (plano batch); o orchestrator (crise/conversa) não toca nisto.
  - **`risco_silencioso` isento** via `EXEMPT_AGENTS` — sempre despacha, mesmo acima do teto.
  - **Fail-open:** erro ao contar custo → `True` + log `llm_cost.count_failed`. `cap <= 0` desabilita.
  - **Fronteira do dia = `America/Sao_Paulo`** (recomendação do ADR): soma `agente_execucoes.custo_usd` com `iniciado_em >= início-do-dia-local` (usa o índice `(agente, sucesso, iniciado_em)`).
  - **Alertas 50/80/100%** via log estruturado `llm_cost.alert`, uma vez por nível por dia (dedupe in-process). Pausa logada como `llm_cost.batch_paused` — nunca silenciosa.
- **`app/scheduler.py`**: checagem pré-despacho em `_tick_agent` (só agentes; jobs operacionais não-LLM não passam pelo gate).
- **`app/core/config.py`** + `.env.example`: `MAX_DAILY_LLM_USD` (default `5.0`, placeholder a calibrar; `<= 0` desliga).
- **Testes:** `tests/test_daily_cost_gate.py` — fronteiras de alerta, isenção do `risco_silencioso`, fail-open, cap≤0, gate só no batch não-crítico, dedupe de alerta, fronteira de dia local. 17 testes; suíte do serviço 109/109 verde.

**Escopo:** o gate soma o custo do **plano batch** (`agente_execucoes`). O custo do interativo segue coberto pela **trava mensal de plataforma** (Console da Anthropic) — backstop de última linha, conforme a Decisão. Threshold `$5` é placeholder; calibrar com `custo_usd` real acumulado.
