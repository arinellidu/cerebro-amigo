# ADR-053 — Vertical scaling do box clínico para t3.xlarge + recalibração de recursos

**Status:** Accepted
**Data:** 2026-06-14
**Decisores:** Patrick e Adonai Arinelli
**Categoria:** Infra / Operação / Segurança clínica (caminho de crise)
**Relaciona:** ADR-009 (separação plano interativo/batch), ADR-007 (gargalo é RAM, não CPU), ADR-043 (HA/SPOF — segue aberto), ADR-026/ADR-040 (teleconsulta/escriba), ADR-028 (RAG/embeddings)

## Contexto

O box clínico de produção (instância única `i-057860cd97edafefb`, `sa-east-1`) rodava em
**t3.small (2 vCPU / 2 GB)** os 5 serviços clínicos (web Next.js + api-gateway .NET +
orchestrator-py + agents-py + notifier-py). Os limites do `docker-compose.yml` estavam
calibrados de forma conservadora para esses 2 GB: o plano batch (agents/notifier) com teto
duro e baixa prioridade, e o OOM killer atuando, na prática, como balanceador sob pressão de
memória.

Isso é frágil para um sistema clínico: há pouquíssima folga, e features recém-entregues
aumentam a pressão — teleconsulta + TURN relay (ADR-026), escriba/transcrição (ADR-040) e
RAG/indexação de embeddings (ADR-028). O gargalo é **RAM** (a CPU raramente satura — ADR-007
e a skill de arquitetura).

## Decisão

1. **Subir o box clínico para t3.xlarge (4 vCPU / 16 GB).** Resolve o gargalo real (RAM) e
   ainda dá folga de CPU para picos concorrentes (TURN relay + batch + indexação de embeddings).
2. **Recalibrar os recursos do `docker-compose.yml`** para usar a folga, **preservando a
   assimetria do ADR-009**:
   - **Plano interativo / crise (sem `mem_limit`):** `orchestrator-py` reserva 2 GB;
     `api-gateway` e `web` reservam 1 GB cada. Nunca são OOM-killed por pressão do batch.
   - **Plano batch (com `mem_limit` duro + `cpu_shares` baixo):** `agents-py` 4 GB / `cpus: 2.0`;
     `notifier-py` 1 GB / `cpus: 1.0`. Continuam sendo as vítimas preferenciais do OOM killer.
   - `cpu_shares` mantidos (interativo 1024 × batch 256): a prioridade relativa de CPU não muda.

| Serviço | Plano | Antes (t3.small) | Agora (t3.xlarge) |
|---|---|---|---|
| orchestrator-py | interativo/crise | reserva 512m, sem teto | **reserva 2g**, sem teto |
| api-gateway | interativo | reserva 256m, sem teto | **reserva 1g**, sem teto |
| web | interativo | reserva 256m, sem teto | **reserva 1g**, sem teto |
| agents-py | batch | limite 768m, cpus 1.0 | **limite 4g, cpus 2.0** |
| notifier-py | batch | limite 256m, cpus 0.5 | **limite 1g, cpus 1.0** |

Orçamento: ~5 GB de reservas + tetos de batch deixam folga confortável em 16 GB para os picos
do plano interativo, com margem para OS/Docker.

## Operação (resize)

`stop → modify-instance-type → start` na instância única → **alguns minutos de downtime**.
Fazer em **janela de baixa demanda**:

1. Confirmar **Elastic IP** (sem ela, o IP público muda no stop/start e quebra DNS/config).
2. `aws ec2 stop-instances` → `wait instance-stopped` → `modify-instance-attribute
   --instance-type t3.xlarge` → `start-instances`.
3. Após subir: `docker compose up -d`, validar `/health` + `/ready` dos 5 serviços e medir com
   `docker stats --no-stream`, reajustando se necessário.

## Consequências

- **Confiabilidade:** o caminho de crise (orchestrator/notifier) deixa de competir por migalhas
  de RAM; o batch ganha espaço real para scipy/numpy + indexação de RAG.
- **Custo:** instância 24/7 mais cara (ordem de ~US$150–180/mês em `sa-east-1`, confirmar no AWS
  Pricing Calculator), ante ~US$15 do t3.small. Justificado: é o sistema que atende
  paciente/médico em produção.
- **NÃO resolve o SPOF.** Continua sendo um box único; alta disponibilidade real segue no
  **ADR-043** (Proposed). Este ADR é scaling vertical, não horizontal.
- **Reversível:** se o custo não se justificar, o tipo volta (mesmo procedimento de resize) e os
  limites do compose, reduzidos.
- A dev box pessoal (DaaS/EC2) é assunto separado e não compete com este recurso (fica `stop`
  quando ociosa).
