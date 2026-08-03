# ADR-009: Separação do plano interativo (crise) do plano batch, e builds no CI

**Status:** Accepted
**Data:** 2026-05-31
**Decisores:** Patrick Arinelli, Adonai Arinelli
**Categoria:** Arquitetura / Operação / Segurança clínica
**Relaciona:** ADR-004 (traços LGPD), ADR-005 (texto de crise versionado),
ADR-006 (fail-safe do classificador), ADR-010 (crise no diário)

## Contexto

O V3 roda os 5 serviços (`web`, `api-gateway`, `orchestrator-py`, `agents-py`,
`notifier-py`) numa única EC2 (`sa-east-1`), via `docker compose`. Dois riscos
operacionais tocam diretamente o caminho de crise — o ativo mais sensível do
produto (regra inegociável #2 de clinical-safety).

### Problema 1 — `agents-py` é split-brain: batch e crise no mesmo processo

`apps/agents-py/app/main.py` sobe num único processo uvicorn (`--workers 1`,
`Dockerfile:20`), no mesmo event loop:

- o `AsyncIOScheduler` dos 5 agentes analíticos (start em `main.py:58-59`,
  gated por `AGENTS_MODE=scheduled`);
- a **triagem de crise do diário** — endpoints `/internal/diario/triar-texto`
  (`main.py:187`) e `/internal/diario/transcrever` (`main.py:154`), que chamam
  `services/crisis.py::acionar_protocolo_diario` (protocolo fixo, append-only,
  notifica médico, pausa automação — ADR-010).

Como o trabalho batch é **síncrono no loop**:

- `padroes.py` chama `scipy.stats.linregress`/`ttest_ind` e numpy diretamente no
  loop (`padroes.py:226,238`), sem `run_in_executor`/`to_thread` (precedente
  existe: `transcricao.py` já usa `to_thread`);
- `risco_silencioso._listar_candidatos` executa `SELECT cliente_id … FROM pacientes`
  **sem filtro de atividade/tenant** (`risco_silencioso.py:245`) — varre todos os
  pacientes e dispara fan-out de queries por paciente;

…um tick batch **bloqueia o loop que também atende a triagem de crise do diário**.
Latência do caminho de crise é propriedade de segurança, não só de performance.

### Problema 2 — Recursos compartilhados na box

Mesmo separando processos, os containers dividem:

- **CPU/RAM da box** (um único OOM killer — um spike de scipy pode fazer o kernel
  matar qualquer processo, inclusive `orchestrator-py`);
- **RDS** (orçamento de conexões compartilhado: orchestrator pode segurar ~30 =
  asyncpg `max_size=20` em `app/db.py` + psycopg3 checkpoint `max_size=10` em
  `conversation/graph.py:148`; `agents-py` mais 10; todos contra o mesmo DSN);
- **quota Bedrock** (Haiku/Sonnet on-demand de conta — uma rajada batch pode
  throttlar a detecção de crise; o fail-safe ADR-006 degrada para *super-acionar*
  crise, nunca para perder — direção segura, mas indesejável).

### Problema 3 — Build na box

`.github/workflows/deploy.yml` (SSM `AWS-RunShellScript`) faz, **na própria
EC2**:
```
git pull → docker stop $(docker ps -q) → docker compose down
→ docker compose build --pull → docker compose up -d
```
Consequências:

- o build do `web` (Next.js, contexto = raiz do repo) precisa de ~2-3 GB → risco
  de OOM numa box pequena (mitigado hoje por 2 GB de swap, frágil);
- o `compose down` **derruba o caminho de crise durante todo o build** (minutos).

Não existe registry (todos os serviços usam `build:` no compose; zero `image:`;
sem ECR/GHCR).

### Janela de baixo risco para mexer em código de crise

ADR-010 § Limitações: **quota Bedrock = 0** na conta → o classificador do diário
sempre cai em throttling → fail-safe → toda entrada de diário é tratada como
crise. Ou seja, **o caminho diário-crise ainda não está em uso real**. É a janela
de menor risco para mover/refatorar código de crise — não se repetirá quando a
quota subir.

## Decisão

Adotar uma separação **single-box-first** (barata, reversível) com **um movimento
estrutural** aproveitando a janela quota=0, e **tirar os builds da box para o CI**.
Concretamente, uma sequência de PRs pequenos:

> **Princípio de ordenação:** o mais barato/reversível e de maior alavancagem de
> segurança primeiro; a mudança mais arriscada (consolidação do código de crise)
> só entra **depois** que a box ganha guarda-corpos (limites de recurso + orçamento
> de conexão) e atrás de testes pesados. Toda falha do caminho de crise deve
> degradar para *super-acionar* (fail-safe ADR-006), nunca para perder.

---

### PR 0 — Medir a box (read-only, sem código)

`aws ec2 describe-instances` + `docker stats --no-stream` + `free -m` em janela
ociosa e durante um tick de `padroes`. Define os números dos limites do PR 1.

Se a box for 1 GB, **promover PR 7 para logo após PR 1** — não dá para reservar
RAM de crise enquanto o `web` builda localmente.

**Risco caminho de crise:** nenhum (read-only).

---

### PR 1 — Limites de recurso Docker (isola CPU/RAM na box)

`docker-compose.yml`: adicionar `mem_limit`, `mem_reservation`, `cpus`,
`cpu_shares` por serviço. Usar chaves **top-level** (`mem_limit: 512m`), honradas
pelo `docker compose` — **não** o bloco `deploy.resources.limits`, que é
Swarm-only e é silenciosamente ignorado em compose plain.

`orchestrator-py` recebe piso (reserva) alto + `cpu_shares` alto. `agents-py`
recebe teto (`mem_limit`) baixo + `cpu_shares` baixo → sob pressão, o OOM killer
reapa o cgroup do batch, não o de crise. Config pura, reversível em 1 arquivo.

Verificar com `docker stats` (não só `compose config`).

**Risco caminho de crise:** se o `mem_limit` do `agents-py` for baixo demais
*enquanto a triagem de crise ainda vive nele* (até o PR 5), um OOM mata a triagem
no meio do protocolo. *Mitigação:* reserva do `agents-py` deve cobrir o
steady-state da triagem; o teto mira o crescimento batch, não o baseline. Valor
extraído do PR 0.

---

### PR 2 — Orçamento de conexões RDS separado

- `agents-py/app/core/db.py` + `core/config.py`: baixar `max_size` do pool batch
  (10 → 3–5), tornar tunável por env (`DB_POOL_MAX_SIZE`).
- `orchestrator-py/app/db.py` + `conversation/graph.py` + `config.py`: tornar os
  `max_size` (20 e 10) settings explícitos, documentar a soma < `max_connections`
  da RDS.
- `.env.example` / `CLAUDE.md`: documentar a conta de conexões por serviço e o
  teto total.

**Risco caminho de crise:** pool do `agents-py` muito pequeno → triagem de crise
(ainda nele até PR 5) não consegue `acquire()` → escrita de crise bloqueada.
*Mitigação:* deixar ≥2 conexões livres, ou adicionar pool dedicado à triagem
(pré-estágio do PR 5). Falha de escrita de crise é evento de segurança: logar
(structlog) e alertar — transação é atômica, falha limpa.

---

### PR 3 — Tirar scipy/numpy do event loop

`agents-py/app/agents/padroes.py`: envolver o núcleo numérico síncrono
(`_analisar_serie`, linhas ~189–247, e o loop de variáveis em `_calcular_metricas`)
em `asyncio.to_thread` (espelha o padrão já usado em `transcricao.py`). Só
valores puros (listas/arrays) cruzam a fronteira do thread; **toda I/O de DB
permanece no loop** (não passar `conn` para o thread). Executor com `max_workers`
pequeno (1–2).

**Risco caminho de crise:** mover por engano algo que toca conexão asyncpg →
uso cross-thread → corrupção/hang. *Mitigação:* closure recebe `list[float]`,
devolve dataclass pura, não toca `conn`. Teste existente `test_padroes.py` deve
passar com saída **numericamente idêntica** (insights são clínicos — sem drift
aceitável).

---

### PR 4 — Fechar a lacuna de SHADOW_MODE no agents-py (gera ADR-011)

Docs e skills afirmam que os 5 agentes rodam sob SHADOW_MODE; o código **não
implementa** o gate — escreve `insights`/`agente_execucoes` sempre. Fechar:

- `agents-py/app/core/config.py`: adicionar `shadow_mode: bool` (espelha
  `orchestrator-py/app/config.py:26`).
- `agents-py/app/agents/base.py`: ramificar em `_persist_insight` e notificação —
  em shadow, **ainda** insere `agente_execucoes` (auditoria do dry-run,
  append-only) mas **pula** `insights` e qualquer push, logando o payload
  (metadata PII-safe, nunca conteúdo verbatim).
- **Crise SEMPRE isenta do gate** (ADR-010: crise é real-action; `services/crisis.py`
  é módulo separado do base dos agentes e não é afetado).
- Corrigir redação das skills `python-ai-services` e `clinical-safety`.
- Criar `docs/adrs/011-shadow-mode-agents.md`.

**Default: `true`, promoção por-agente.** Justificativa: bate com o contrato
documentado; "validação clínica antes de ação real"; sistema ainda não está live
(quota=0, dashboard em seed) → default seguro não quebra produção atual. Reverter
é decisão clínica, não `git revert` casual.

**Risco caminho de crise:** gatear a crise por engano atrás do shadow → crise real
do diário deixa de registrar/notificar. *Mitigação:* crise em módulo distinto;
teste de regressão asserta que crise dispara com `SHADOW_MODE=true`.

---

### PR 5 — Consolidar toda crise no orchestrator-py (núcleo do ADR)

Mover para `orchestrator-py`:
- `apps/agents-py/app/services/crisis.py` (`acionar_protocolo_diario`, `detectar_crise`)
- `apps/agents-py/app/services/transcricao.py` (`transcrever_audio`)
- endpoints `/internal/diario/transcrever` e `/internal/diario/triar-texto`

Repontar no `api-gateway` (`appsettings.json` + env) esses endpoints de
`AGENTS_PY_URL` → `ORCHESTRATOR_PY_URL`.

Remover a cópia de `crisis_copy.py` do `agents-py` (única fonte: orchestrator;
paridade SHA-256 do ADR-005 deixa de precisar de duas cópias).

**`agents-py` vira batch puro** (5 agentes + 2 jobs, sem endpoint
latency-sensitive). Seguro agora pela janela quota=0.

**Guardas obrigatórias antes do merge** (clinical-safety #2/#3/#4/#5):
1. Eval de crise golden-set (`scripts/eval_crisis.py`) verde no CI.
2. Testes portados confirmando: exceção do classificador → `crise=True` (fail-safe
   ADR-006); protocolo escreve `protocolos_crise_acionados` + `notificacoes_medico`
   + `pacientes.automacao_pausada=TRUE` em transação única (append-only);
   `palavras_detectadas` = categorias, nunca verbatim (LGPD #4).
3. Comportamento fail-closed do gateway (503 quando não alcança o serviço de
   triagem) preservado — só repontado (ADR-010 #6).
4. Decode de áudio base64 (10 MB) permanece em `to_thread` — não estagnar o loop
   do orchestrator. Logging do novo código com `PII_REDACTION` ativo (regra #4).

*Ordem interna:* portar e validar a triagem de texto no orchestrator antes de
repontar o gateway; validar o caminho de crise da conversa (`nodes/crisis.py`)
pós-port; só então repontar diário. Criar `docs/adrs/012-consolidacao-crise.md`.

**Risco caminho de crise:** regressão no código mais crítico do sistema.
*Mitigação:* janela quota=0 (não-live); fail-safe + fail-closed garantem direção
segura; orchestrator já é dono da implementação canônica (`nodes/crisis.py`) e usa
asyncpg (escrita porta limpo); seam `AGENTS_MODE=manual` permite rollback de
scheduler sem afetar crise.

---

### PR 6 — Higiene do batch (defesa em profundidade)

- `agents-py/app/scheduler.py`: escalonar (stagger) os 7 triggers — não acordarem
  todos na mesma borda de 300 s — ou adicionar cap global de concorrência.
- `agents-py/app/agents/risco_silencioso.py` + `adesao.py`: pré-filtro de
  candidatos + paginação por tick (`BATCH_MAX_PATIENTS_PER_TICK`), **completo ao
  longo de N ticks** (cobertura total do coorte, só repartida no tempo).
- `agents-py/app/core/llm.py`: semáforo/rate-limit client-side nas chamadas
  Bedrock do batch (não esgotar quota compartilhada com a Haiku de crise).

**Risco caminho de crise:** batching pular pacientes de `risco_silencioso`
(sinal "ausência atípica + crise prévia"). Não é miss de crise ao vivo, mas
degrada sinal preventivo. *Mitigação:* cobertura completa em N ticks (teste);
manter leitura de `protocolos_crise_acionados` na escalada do agente.

---

### PR 7 — ECR + builds no CI; compose `image:`; deploy `pull` em vez de `build`

**CI (`build-and-push.yml` ou extensão do `deploy.yml`):** em push na `main`,
autenticar no ECR (`004177894935.dkr.ecr.sa-east-1.amazonaws.com`), buildar os 5
images no runner GitHub Actions (respeitando contextos: `web` = raiz do repo;
outros 4 = dir do app), taguear com `$GITHUB_SHA`, push.

**`docker-compose.yml`:** adicionar `image:` nos 5 serviços; mover `build:` para
`docker-compose.override.yml` (dev local segue buildando; prod só pull).

**`deploy.yml` (SSM):** trocar `docker compose build --pull` por:
```
export IMAGE_TAG=$GITHUB_SHA
docker compose pull
docker compose up -d --remove-orphans
```
Remover o `docker stop $(docker ps -q) && compose down` upfront — `up -d` recria
apenas os containers que mudaram de imagem. Manter os health-gates existentes
(`/health` em `:5050/:8081/:8082/:8083`).

**EC2 IAM role** (`cerebro-amigo-ec2-role`): adicionar
`ecr:GetAuthorizationToken`, `ecr:BatchGetImage`,
`ecr:GetDownloadUrlForLayer` (seguir o padrão de
`infra/aws/iam-policy-diario-audio.json`). Criar `docs/adrs/013-ecr-ci-builds.md`.

**Benefício direto para a crise:** build sai da box (fim do risco OOM do `web`);
o `compose down` upfront deixa de derrubar a crise por minutos — orchestrator só
reinicia se a própria imagem mudou, em segundos. Paridade SHA-256 do `crisis_copy`
(ADR-005) preservada através do CI (sem transformação de arquivo).

**Risco caminho de crise:** `pull` falhar (IAM ausente, ECR inacessível) → `up`
roda imagem velha/ausente. *Mitigação:* pinar `IMAGE_TAG` antes do `up`; smoke
manual (`docker login` + `pull` na box) antes de virar o `deploy.yml`; health-gates
existentes falham o deploy se orchestrator não subir; manter rollback via `IMAGE_TAG`
anterior.

---

### PR 8 — Multi-stage nos 3 Dockerfiles Python

`orchestrator-py`, `agents-py`, `notifier-py` são hoje single-stage e mantêm
`build-essential` no runtime. Converter para builder + runtime slim (espelha
`web`/`api-gateway`): stage `builder` instala `build-essential` + `pip install .`;
stage `runtime` (`FROM python:3.12-slim`) copia apenas o site-packages instalado +
`app/`. Manter `libpq5` no runtime. Para `agents-py`, verificar import de
scipy/numpy no stage slim (wheels bundlam suas libs).

Adicionar `.dockerignore` nos 3 apps (só `api-gateway` tem hoje).

Pull menor → janela de restart do orchestrator menor → menos tempo o caminho de
crise fica em transição.

**Risco caminho de crise:** copy multi-stage perder lib nativa → container não
sobe (orchestrator = crise down; agents = batch degradado). *Mitigação:* fazer
o Dockerfile do `orchestrator-py` em commit próprio e validar a crise antes de
tocar `agents-py`; PR é o último porque rollback é instantâneo via `IMAGE_TAG`
anterior (PR 7).

---

## Alternativas consideradas

### Alternativa A — Só separar o scheduler (sem mover código de crise)

Usar o seam `AGENTS_MODE=manual` e rodar o scheduler num container à parte,
mantendo a triagem de crise no `agents-py` permanentemente.

**Por que não é o alvo final:** deixa o diário-crise preso ao serviço batch. Se
no futuro a arquitetura escalar para duas boxes (Fase 2), a triagem ficaria na box
*lenta* + um hop de rede extra — regressão para o caminho de crise. A janela
quota=0 torna o PR 5 seguro agora; perdê-la exigiria a mudança sob tráfego real.
O seam `AGENTS_MODE=manual` permanece como mecanismo de rollback do scheduler.

### Alternativa B — Duas boxes (split físico interativo vs batch) como primeiro passo

Box interativa (`web` + `gateway` + `orchestrator`) vs box batch (`agents` +
`notifier`).

**Por que rejeitada como passo inicial:** custo (segunda EC2 + configuração de
rede interna) e ops (dois alvos de deploy no SSM); e sem o PR 5, *regrediria* o
diário-crise (ficaria na box batch + hop extra). Fica como **Fase 2 disparada
por métrica** (ver Gatilhos) — habilitada após a consolidação do PR 5.

### Alternativa C — Manter como está

Rejeitada: viola o objetivo de que carga de fundo nunca contenda com a crise, e
todo deploy derruba a crise durante o build.

## Consequências aceitas

1. **Topologia ainda single-box** após estes PRs; isolamento CPU/RAM é por cgroup
   (limites Docker), não físico. Suficiente enquanto as métricas-gatilho não
   dispararem.
2. **`agents-py` vira batch puro**; toda crise (conversa + diário + transcrição)
   passa a viver no `orchestrator-py` — uma superfície de crise, um `crisis_copy`.
3. **Novo registry (ECR)** a manter; EC2 IAM role ganha permissão de pull.
4. **SHADOW_MODE default `true`** no agents-py: agentes em dry-run até promoção
   clínica explícita por-agente. Reverter o gate é decisão clínica (ADR-011),
   não `git revert` casual.
5. **Dependência da janela quota=0** para o PR 5: a consolidação deve entrar antes
   de a quota Bedrock subir e o diário-crise virar tráfego real.

## Gatilhos de revisão (Fase 2 — duas boxes)

| Métrica | Threshold | Ação |
|---|---|---|
| p95 `detect_crisis` / `detectar_crise` (Haiku) | > 1.5–2× baseline, sustentado 1 dia | Split físico: box interativa + box batch (Alternativa B, segura pois PR 5 já consolidou a crise) |
| Qualquer OOM killer matando container do plano interativo | ≥ 1 evento | Duas boxes + build fora da box de runtime |
| Utilização de conexões RDS | Sustentada > 70–80% de `max_connections` ou timeout em `acquire()` no caminho de crise | Re-capar pools; se persistir → PgBouncer |
| Throttling Bedrock na Haiku de crise | Rastreável ao batch após o rate-limit do PR 6 | Provisioned Throughput dedicado para a Haiku |

## Referências

- ADR-004: tratamento de LGPD em traces LangSmith.
- ADR-005: versionamento do texto de crise (SHA-256).
- ADR-006: fail-safe do classificador de crise.
- ADR-010: crise no diário (origem do split-brain; registra quota Bedrock=0).
- ADR-011 (a criar no PR 4): SHADOW_MODE nos agentes analíticos.
- ADR-012 (a criar no PR 5): consolidação da crise no orchestrator-py.
- ADR-013 (a criar no PR 7): ECR + builds no CI.
- Skills: `cerebro-architecture`, `clinical-safety`, `python-ai-services`.
- `docs/aws-bedrock-quota-support-case.md`: caso de suporte da quota Bedrock.
