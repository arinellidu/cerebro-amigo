# Disparo externo de agentes via EventBridge (caminho de evolução)

**Status:** Documentação de arquitetura futura — não implementado.  
**Pré-requisito:** [ADR-009](../../docs/adrs/ADR-009-separacao-plano-interativo-batch.md) — isolamento batch/interativo.  
**Gatilho de adoção:** quando o APScheduler in-process (mesmo com limits Docker) gerar
variabilidade inaceitável de latência na triagem de crise, ou quando a box batch for
separada da box interativa (Fase 2 do ADR-009).

---

## O que muda

Hoje: `agents-py` roda `AsyncIOScheduler` **dentro do mesmo processo uvicorn** que
serve os endpoints internos. Um tick batch pode contaminar o event loop.

Futuro: `AGENTS_MODE=manual` desativa o scheduler in-process; **EventBridge Scheduler**
dispara os agentes externamente via HTTP `POST /internal/agents/{name}/run` (endpoint
já existe, já autenticado com `INTERNAL_API_TOKEN`).

---

## Topologia alvo

```
EventBridge Scheduler (cron por agente)
         │
         ▼
  Lambda Trigger (ou ECS RunTask)
         │  POST /internal/agents/{name}/run
         │  Authorization: Bearer $INTERNAL_API_TOKEN
         ▼
  agents-py :8082  (AGENTS_MODE=manual — scheduler desligado)
         │
         ▼
  Bedrock sa-east-1 / RDS (via IAM role)
```

Os agentes não mudam — o mesmo código, o mesmo `find_pending()`, o mesmo
`agente_execucoes` append-only, o mesmo `SHADOW_MODE` gate. Só o *disparador* muda.

---

## Endpoints existentes (sem modificação)

```
POST /internal/agents/{name}/run
  Header: Authorization: Bearer $INTERNAL_API_TOKEN
  → varre find_pending(), respeita dedup window, escreve agente_execucoes + insights

POST /internal/agents/{name}/run-for-patient
  Body: {"paciente_id": "<uuid>"}
  → força execução para 1 paciente, ignora dedup

POST /internal/agents/resumo_pre_consulta/run-on-demand
  Body: {"paciente_id": "<uuid>"}
  → gera resumo pré-consulta sem exigir consulta agendada (botão "Gerar" no dashboard)
```

**Nomes dos 5 agentes** (exatos, conforme `AGENT_REGISTRY` em `app/agents/__init__.py`):

| `{name}` | Função | Modelo Bedrock |
|---|---|---|
| `resumo_pre_consulta` | Sumário pré-consulta | Sonnet |
| `adesao` | Taxa de medicação + engajamento | Sonnet |
| `risco_silencioso` | Ausência atípica + sinais negativos | Sonnet |
| `padroes` | Tendências de sintomas (scipy) | Sonnet |
| `diario` | Síntese de diários compartilhados | Sonnet |

---

## Opção A — Lambda trigger (mais simples, sem ECS)

Lambda com runtime Python 3.12, invocada pelo EventBridge. Faz HTTP para agents-py
usando `INTERNAL_API_TOKEN` do Secrets Manager (ou Parameter Store).

```python
import os, urllib.request, json

AGENTS_URL = os.environ["AGENTS_PY_URL"]       # http://<ip-privado-ec2>:8082
INTERNAL_TOKEN = os.environ["INTERNAL_TOKEN"]  # do Secrets Manager

def handler(event, context):
    name = event["agent_name"]   # injetado pela EventBridge rule
    req = urllib.request.Request(
        f"{AGENTS_URL}/internal/agents/{name}/run",
        method="POST",
        headers={"Authorization": f"Bearer {INTERNAL_TOKEN}"},
    )
    with urllib.request.urlopen(req, timeout=600) as resp:
        return json.loads(resp.read())
```

**Regra EventBridge (exemplo — resumo_pre_consulta a cada 5 min):**

```json
{
  "Name": "cerebro-agents-resumo-pre-consulta",
  "ScheduleExpression": "rate(5 minutes)",
  "State": "ENABLED",
  "Targets": [{
    "Id": "lambda-trigger",
    "Arn": "arn:aws:lambda:sa-east-1:004177894935:function:cerebro-agents-trigger",
    "Input": "{\"agent_name\": \"resumo_pre_consulta\"}"
  }]
}
```

Criar uma regra por agente. O EventBridge pode escalonar (stagger) as execuções
individualmente — elimina o burst de todos os 7 jobs na mesma borda de 300s que
o APScheduler tem hoje.

**IAM — Lambda execution role:**
```json
{
  "Effect": "Allow",
  "Action": ["secretsmanager:GetSecretValue"],
  "Resource": "arn:aws:secretsmanager:sa-east-1:004177894935:secret:cerebro-amigo/*"
}
```
(Acesso de rede: Lambda na VPC `vpc-0edf8eb7d2e60b397`, mesmo security group da EC2,
ou via IP privado da EC2 em `curl`-friendly security group rule.)

---

## Opção B — ECS Scheduled Task (isolamento máximo, custo maior)

Registrar um ECS Task Definition que usa a mesma imagem ECR do `agents-py`
(`004177894935.dkr.ecr.sa-east-1.amazonaws.com/cerebro-amigo/agents-py:$TAG`) com
`AGENTS_MODE=manual` e dispara um único agente via override de entrypoint. O
EventBridge dispara `RunTask` com um `containerOverrides.command` que chama
`python -c "..."` ou um CLI script.

```
EventBridge → ECS RunTask → Task efêmera (agents-py image, AGENTS_MODE=manual)
             → entrypoint: python -m app.cli run-agent resumo_pre_consulta
             → sai após 1 ciclo
```

Requer: cluster ECS, task definition, VPC private subnet, security groups. Custo:
Fargate spot ou EC2 launch type. **Não proporcional para a fase atual** — só adotar
se a Opção A atingir limite de timeout de Lambda (15 min) ou se o isolamento de
infra for mandatório por compliance.

---

## Como ativar (Opção A)

1. Setar `AGENTS_MODE=manual` no `.env` da EC2 (agents-py para de rodar scheduler in-process).
2. Deploy agents-py (via push → CI → SSM).
3. Verificar log: `scheduler.disabled.manual_mode` no container.
4. Criar Lambda + 5 regras EventBridge conforme acima.
5. Smoke test: invocar Lambda manualmente com `{"agent_name": "adesao"}`, verificar
   nova linha em `agente_execucoes` no RDS.

**Rollback:** setar `AGENTS_MODE=scheduled` e redeployar — scheduler volta in-process.

---

## Invariantes preservadas em qualquer caminho

- `SHADOW_MODE` gate em `agents/base.py` se aplica em todos os modos de disparo.
- `agente_execucoes` continua append-only (insert-on-start + finalize-update, sem DELETE).
- `insights` continua append-only (sem UPDATE/DELETE).
- Crise (`services/crisis.py`) não é afetada — permanece isenta de SHADOW_MODE e
  nunca é invocada por EventBridge.
- LLM apenas em Python via Bedrock In-Region sa-east-1 (ADR-008).
