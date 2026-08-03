# ADR-063: Resiliência da detecção de crise — o fail-safe não pode conflar outage de LLM com crise

**Status:** Implementado (camadas 1-4); gateado por `CRISIS_RESILIENCE_ENABLED=false` (default).
**Gates clínicos pendentes antes de ativar em prod:**
- `LISTA_ATESTADA=True` em `crisis.py` — curadoria + atestação Adonai (lista `_TERMOS_CRISE_RAW`).
- `INSTABILIDADE_COPY.atestado=True` em `crisis_copy.py` — revisão + atestação Adonai (texto neutro).
- `CRISIS_RESILIENCE_ENABLED=true` no `.env` do box — só ligar após os dois acima.
**Data:** 2026-06-17  **Implementado:** 2026-06-18
**Decisores:** Patrick Arinelli + Adonai Arinelli (decisão clínica — não é só engenharia)
**Categoria:** Segurança clínica / resiliência / observabilidade

## Contexto

### O incidente que motivou (2026-06-17)

A `ANTHROPIC_API_KEY` de produção foi revogada (vazou no git e foi rotacionada; a chave velha
seguiu no `.env`). O classificador de crise (Haiku) passou a receber **401 `invalid x-api-key`**
em toda chamada. O nó `detect_crisis` (`apps/orchestrator-py/app/conversation/nodes/crisis.py:~91`)
tem um **fail-safe**: qualquer exceção da LLM → `crise = {detectada: True, nivel: 'alto',
gatilhos: ['classifier_error']}`.

Resultado: o **protocolo de crise** (CVV 188 / SAMU 192, automação pausada, escalada p/ humano,
alerta crítico ao médico) disparou em **toda mensagem** — inclusive benignas ("estou com humor
baixo", sem qualquer menção de autoagressão). Blast radius medido: **7 falsos-positivos, 2
pacientes, janela 2026-05-30 → 2026-06-17** (≈18 dias com a detecção quebrada **sem ninguém saber**).

### O estado atual da detecção

- Detecção de crise = **uma** chamada Haiku, **sem retry**, **sem fallback determinístico**,
  **sem alerta de ops**. A "lista de gatilhos" existe só DENTRO do prompt (texto pro LLM), não
  há nenhum screen no código.
- Qualquer erro de LLM (auth 401/403, 429/529 sustentado, timeout, rede) → fail-safe → **crise
  para todos**.

### Por que o fail-safe atual está errado

O fail-safe "na dúvida = crise" é **correto** para uma mensagem **ambígua isolada** — um
falso-negativo clínico (deixar passar uma crise real) é inaceitável. Mas é **catastrófico** para
uma falha **sistêmica**, onde a mesma causa atinge todos os pacientes:

- falso-positivo em massa → **fadiga de alerta** no médico → a **crise REAL fica soterrada** no
  meio dos falsos. Ou seja: o fail-safe pensado para evitar falso-negativo acaba **produzindo**
  falso-negativo por outra via (a real some no ruído).
- pacientes em estado benigno recebem a copy de crise (CVV/SAMU) — alarmante e iatrogênico.
- automação pausada indevidamente para todos.

**O fail-safe não distingue "esta mensagem é ambígua" de "o classificador está fora".** É essa
conflação que precisa morrer.

## Decisão (design — 4 camadas)

### 1. Screen determinístico de alta precisão (defesa em profundidade), independente do LLM

- Lista **curada pelo clínico** (Adonai) de expressões pt-BR de ideação/auto-lesão **explícita**
  (com normalização de acento/variação). Otimizada para **PRECISÃO** (minimizar falso-positivo),
  não exaustividade.
- Roda **sempre**, antes/ao lado do LLM. Hit → crise dispara **independente do estado do LLM**.
  Garante que crises **explícitas** nunca dependem da chave/API estar de pé.
- É território **pré-aprovado** (clinical-safety R2): a lista vira artefato **versionado e
  atestado** como `crisis_copy.py`. Determinística ⇒ não é "IA praticando medicina" (R1). Fica
  sob a mesma trava server-side dos prompts de salvaguarda (ADR-035).
- **Não substitui** o LLM (que pega o implícito/nuance) — **complementa**.

### 2. Retry + classificação do erro no `detect_crisis`

- **Retry** com backoff curto (≈2 tentativas) para blips transitórios (timeout, 5xx isolado).
- **Classificar a exceção**:
  - **Sistêmica** — auth (401/403), 429/529 sustentado, ou circuit-breaker tripado por N falhas
    consecutivas → **NÃO** fabricar crise por paciente. Entra em **modo degradado** (camada 3).
  - **Transitória isolada** — uma mensagem, após os retries → mantém o "trata como crise" **só
    para AQUELA mensagem** (raro, contido; e a camada 1 já cobre o explícito). Preserva o
    no-false-negative para o caso nuance que só o LLM pegaria.

### 3. Modo degradado (LLM sistemicamente fora)

- Screen determinístico (camada 1) **segue ativo** — o explícito ainda dispara crise.
- Mensagens **sem hit** no screen → **não** viram crise por paciente. Em vez disso:
  - o paciente recebe um acolhimento **neutro pré-aprovado** (NEM a copy de crise, NEM resposta
    normal de IA): algo como *"estamos com uma instabilidade técnica; sua mensagem foi registrada
    e sua psiquiatra foi avisada"* (texto fixo, versionado, atestado pelo clínico).
  - a conversa entra na fila de **revisão humana** — o médico vê *"auto-classificação
    indisponível"*, **não** *"crise"* (médico no loop, R3).
  - dispara **alerta de OPS/ENG** (não um alerta clínico por paciente) — a equipe conserta o
    classificador.
- Troca **"crise-para-todos"** por **"instabilidade sinalizada + humano no loop + explícito ainda
  coberto"**.

### 4. Observabilidade (o que faltou e custou 18 dias)

- Métrica + alarme na **taxa de erro** do classificador de crise e na **proporção de crises via
  fail-safe** (`gatilho='classifier_error'`). Erro de auth ou taxa anômala → alerta ENG em
  **minutos**, não 18 dias.
- Sentry/CloudWatch no caminho; contar entradas em modo degradado.

## Consequências

- **Crise explícita** deixa de depender da chave/API (camada 1) — falso-negativo no explícito
  cai para ≈zero mesmo num outage total da LLM.
- **Outage sistêmico** deixa de inundar médico/paciente; vira sinal de ops + humano no loop.
  Fadiga de alerta evitada ⇒ a crise real não é mais soterrada.
- **Falso-positivo isolado** (1 msg transitória) continua possível — aceitável e contido; o
  médico revê.
- **Custo:** o código toca o caminho de crise ⇒ **revisão clinical-safety obrigatória**; a lista
  determinística e os textos exigem **curadoria + atestação do clínico** antes de produção;
  rollout sob **SHADOW_MODE** (loga o que faria, sem agir) + validação clínica antes de ativar.
- **Trade-off residual:** o screen determinístico pode ter falso-positivo (termo explícito em
  contexto não-crise — citação, negação). Mitigado por alta precisão + refino do LLM quando up;
  em degradado, errar para o lado seguro no explícito é aceitável.

## Implementação (2026-06-18)

Arquivos alterados:
- `apps/orchestrator-py/app/conversation/nodes/crisis.py` — camadas 1-3 + `degraded_response` node; circuit breaker (`_CircuitBreaker`); screen determinístico (`_screen_deterministico`); retry com backoff; routing para modo degradado vs fail-safe conservador.
- `apps/orchestrator-py/app/conversation/crisis_copy.py` — `InstabilidadeCopy` dataclass + `INSTABILIDADE_COPY` (rascunho, `atestado=False`).
- `apps/orchestrator-py/app/config.py` — `crisis_resilience_enabled: bool = False`.
- `apps/orchestrator-py/app/conversation/state.py` — `modo_degradado: NotRequired[bool]`.
- `apps/orchestrator-py/app/conversation/graph.py` — nó `degraded_response` + `_route_after_crisis` atualizado.
- `apps/orchestrator-py/tests/test_crisis_failsafe.py` — 17 testes (todos passando).
Thresholds implementados: retry=2 tentativas; circuit breaker limite=3 falhas sistêmicas consecutivas.

## Pendências (gates clínicos — nesta ordem)

- [ ] **Lista determinística** `_TERMOS_CRISE_RAW` em `crisis.py` **curada + atestada por Adonai**.
      A IA **não inventa** termos clínicos — a lista é do clínico. Após: `LISTA_ATESTADA = True`.
- [ ] **Texto de instabilidade** `_RASCUNHO_INSTABILIDADE` em `crisis_copy.py` revisado + atestado
      por Adonai. Após: `INSTABILIDADE_COPY = _versionar_instabilidade(..., atestado=True)`.
- [ ] **Ativar em prod:** `CRISIS_RESILIENCE_ENABLED=true` no `.env` do box + `--force-recreate orchestrator-py`.
- [ ] Métrica + alarme de ops dedicado (taxa de entradas em modo degradado via CloudWatch/Sentry).

## Relacionado

- ADR-005 (crisis_copy fixo/pré-aprovado) · ADR-035 (trava server-side dos prompts de salvaguarda)
  · ADR-041 (entrega garantida do alerta de crise ao médico).
- Incidente da chave: ver memória do projeto `crisis-failsafe-floods-on-llm-error` e o caminho
  paralelo de flood via tabela `prompts` ausente (migration 0009).
- Skill `clinical-safety` (regras R1/R2/R3 citadas).
