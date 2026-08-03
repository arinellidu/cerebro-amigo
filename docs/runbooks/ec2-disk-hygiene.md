# Runbook — Higiene de disco da EC2 (box clínico) + ECR

> **Objetivo:** manter o disco do box clínico (`cerebro-app`, `i-057860cd97edafefb`, 20 GB gp3) longe de encher, e impedir que volte. Cobre limpeza manual, as defesas automáticas no pipeline e a lifecycle do ECR.
> **Escopo:** box clínico (compose: gateway .NET + Scala + 3 Python + web standby). Postgres é RDS externo — não tem volume de dados aqui. checkup/web têm ASG próprio (ADR-045).

## Sintoma

`disk_used_percent` (CWAgent) subindo deploy a deploy; `df /` perto de 80-90%. Risco: deploy falha por falta de espaço no `docker compose pull`.

## Causa

Dois acumuladores, ambos por rotatividade de imagens de deploy:

1. **Build cache do Docker** (`docker builder prune`) — chegou a **11 GB** (era o vilão; 100% reclaimable).
2. **Imagens antigas** — cada deploy puxa a imagem do novo SHA; a do SHA anterior fica no disco. Sem limpeza, empilha.

Medição de origem: `docs/infra-baseline.md` (§2 disco — 83%, 13 GB de lixo reclamável).

## Defesas em camadas (em prod)

### 1. Pré-pull no deploy (build cache + dangling)
`.github/workflows/deploy.yml`, job `deploy-clinical`, antes do `compose pull`:
```
docker image prune -af        # remove dangling/untagged de pulls interrompidos
docker builder prune -af || true   # zera o build cache (o maior ofensor)
```

### 2. Pós-deploy no deploy (imagens antigas) — adicionado
Mesmo job, **depois** dos health checks passarem (só aí o container antigo saiu e a imagem antiga fica de fato sem-uso):
```
docker image prune -af || true   # remove imagens do(s) SHA(s) anterior(es)
```
> Pré-pull **não** remove a imagem antiga porque o container velho ainda a referencia. Por isso a remoção efetiva é **pós-health-check**. O rollback não depende do disco local — re-puxa do ECR (ver §ROLLBACK do `setup-ecr.sh`).

### 3. Lifecycle no ECR (teto de tags por repo)
**Todos** os repos com `keep last 10` (`imageCountMoreThan: 10` → `expire`):
`cerebro-amigo/{web,api-gateway,api-gateway-scala,orchestrator-py,agents-py,notifier-py,checkup}`.
IaC em `infra/aws/setup-ecr.sh` (os 6 clínicos no array `SERVICES`; `checkup` no `EXTRA_LIFECYCLE_REPOS`, pois o repo é criado pelo setup do ASG do checkup, não por esse script).

### 4. Box NUNCA builda (guarda `--no-build`)
Build é **100% no CI**: o job `build-clinical` (`docker/bake-action`, cache GHA) builda as 6 imagens e empurra pro ECR. O box só `docker compose pull` + `docker compose up -d --no-build`.
- O `compose` tem `build:` em cada serviço **só para dev local** (`docker compose up --build`). Em prod isso é uma armadilha: sem `--build` explícito, `compose up` **builda localmente se a imagem faltar** (default do compose) → `sbt stage`/dotnet/next na EC2 = explosão de memória (origem provável dos 11 GB de build cache históricos).
- **`--no-build` é a guarda**: imagem ausente → o deploy **falha alto** em vez de compilar no box. O Scala (`sbt stage`) roda no stage de build do Dockerfile = dentro do CI; a imagem de runtime é só JRE.
- Efeito: o build cache do box **não volta a crescer** (nada compila lá). O `builder prune` pré-pull é só rede de segurança.

## Recuperação manual (quando já encheu)

Via SSM (não precisa SSH). Rodar do laptop com AWS CLI:
```bash
aws ssm send-command --instance-ids i-057860cd97edafefb \
  --document-name AWS-RunShellScript --region sa-east-1 \
  --parameters 'commands=[
    "df -h / | tail -1",
    "docker system df",
    "docker system prune -af --volumes",
    "df -h / | tail -1"
  ]'
# pegar o resultado:
aws ssm get-command-invocation --command-id <CMD_ID> \
  --instance-id i-057860cd97edafefb --region sa-east-1 \
  --query StandardOutputContent --output text
```
- `docker system prune -af --volumes` = imagens sem-uso + containers parados + redes + build cache + volumes órfãos.
- `--volumes` é **seguro aqui**: o compose não tem volume nomeado de dados (Postgres é RDS externo). Volumes referenciados por container ativo **não** são removidos.
- **Não** remove nada de container que está `Up` — só lixo.

**Resultado de referência (2026-06-21):** manual `builder prune` 83% → ~45%; depois `system prune -af --volumes` 45% → **39%** (reclaimed 1,2 GB de imagens do SHA anterior). 6 serviços seguiram `Up (healthy)`.

## Verificação

```bash
# disco do box (CloudWatch)
aws cloudwatch get-metric-statistics --namespace CWAgent --metric-name disk_used_percent \
  --dimensions Name=InstanceId,Value=i-057860cd97edafefb \
  --start-time <t-1h> --end-time <agora> --period 300 --statistics Maximum --region sa-east-1

# lifecycle presente em todos os repos
for r in $(aws ecr describe-repositories --region sa-east-1 --query "repositories[].repositoryName" --output text); do
  aws ecr get-lifecycle-policy --repository-name "$r" --region sa-east-1 >/dev/null 2>&1 \
    && echo "$r ok" || echo "$r SEM lifecycle"
done
```

## Pendência — repos legados V2 (candidatos a remoção)

`cerebro/api-gateway` (~20 imgs) e `cerebro/orchestrator` (~7 imgs) são da nomenclatura V2 (os ativos são `cerebro-amigo/*`). Receberam `keep-last-10` para parar de crescer, mas o certo é **deletar o repo** após confirmar que nada puxa deles:
```bash
# confirmar que não há pull recente / referência em compose ou IaC, então:
aws ecr delete-repository --repository-name cerebro/api-gateway --force --region sa-east-1
aws ecr delete-repository --repository-name cerebro/orchestrator --force --region sa-east-1
```
> `--force` apaga as imagens junto. Irreversível. Confirmar com o Patrick antes.

## Referências

- `docs/infra-baseline.md` — medição de origem (§2 disco, §7 ações).
- `infra/aws/setup-ecr.sh` — IaC de repos + lifecycle.
- `.github/workflows/deploy.yml` — prune pré-pull + pós-deploy.
