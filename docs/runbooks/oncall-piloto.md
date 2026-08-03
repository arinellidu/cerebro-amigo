# Runbook — On-call de piloto

> **Objetivo:** saber do problema **antes do médico**. Cobertura mínima de observabilidade enquanto o produto está em piloto (~1 usuário). Alertas chegam por **e-mail** (`alerts@arinelli.com`) via SNS. SMS não está ativo (subscription é 1 comando quando quiser).

## Onde os alertas chegam

| Canal | O quê |
|---|---|
| SNS `cerebro-amigo-piloto-alertas` (sa-east-1) | Alarmes de EC2 e RDS |
| SNS `cerebro-amigo-uptime-alertas` (us-east-1) | Uptime externo (Route53 health checks) |
| SNS `cerebro-amigo-rds-backup-alertas` | Backup do RDS velho (`BackupAgeHours`) |
| Watchdog systemd (on-box) → Resend e-mail | `/health` local caiu (ver [[project-observability-spof]]) |
| Sentry (backend .NET + 3 Python) | Exceptions em runtime (LGPD-safe) |

> ⚠️ Confirmar as **subscriptions de e-mail do SNS** (AWS manda link de confirmação ao criar; sem clicar, não chega alerta).

## Inventário de alarmes

**EC2 box clínico (`i-057860cd97edafefb`, t3.medium):**
- `cerebro-app-cpu-alta` — CPU > 80% por 15min (deploy transiente não dispara).
- `cerebro-app-mem-alta` — memória alta (stack `cerebro-ec2-status-alarms`).
- `cerebro-app-disco-alto` — disco / > 85%.
- `cerebro-app-swap-alta` — swap (mesmo stack).
- `cerebro-ec2-instance-check-reboot` / `cerebro-ec2-system-check-recover` — auto-recovery.

**RDS (`cerebro-postgres-enc`, Single-AZ):**
- `cerebro-rds-cpu-alta` — CPU > 80%.
- `cerebro-rds-conexoes-altas` — conexões > 80 (regime ~30; vazamento de pool?).
- `cerebro-rds-storage-baixo` — FreeStorageSpace < 2 GB.
- `cerebro-rds-backup-stale` — backup velho.

**Uptime externo (Route53, us-east-1):**
- `cerebro-gateway-uptime-down` — `api.cerebroamigo.com.br/health` fora.
- `cerebro-portal-uptime-down` — `www.cerebroamigo.com.br/api/health` fora.

## Triagem por alarme

### Uptime down (gateway ou portal)
1. Confirmar de fora: `curl -si https://api.cerebroamigo.com.br/health` (e `…/www…/api/health`).
2. Box vivo? `aws ec2 describe-instances --instance-ids i-057860cd97edafefb --region sa-east-1 --query "Reservations[].Instances[].State.Name"`.
3. Containers? SSM: `docker ps` + `docker compose -f /opt/cerebro-amigo-v3/docker-compose.yml ps`.
4. Subir o que caiu (SSM): `cd /opt/cerebro-amigo-v3 && git config --global --add safe.directory /opt/cerebro-amigo-v3 && export IMAGE_TAG=$(docker inspect cerebro-amigo-v3-api-gateway-1 --format '{{.Config.Image}}' | sed 's/.*://') && docker compose up -d --no-build`.
   > **Gotcha:** sem `safe.directory` + `IMAGE_TAG` real, o compose cai p/ `:latest` (inexistente) e quebra. Ver `docs/infra-baseline.md`.
5. Logs: CloudWatch Logs `/cerebro/<svc>` (ou `docker logs <container>`).

### EC2 CPU/mem/disco alto
- CPU: `docker stats` via SSM; ver qual container. Deploy em curso? (transiente, ignora).
- Disco: `docker system df`; rodar `docker system prune -af` (ver `docs/runbooks/ec2-disk-hygiene.md`). Prune pós-deploy já é automático.
- Mem: regime é ~1 GB/4 GB. Se subir sustentado, ver vazamento (Sentry) ou `docker stats`.

### RDS
- CPU/conexões: provável query pesada ou vazamento de pool no gateway. Ver Sentry + `pg_stat_activity` (via box, Session Manager — RDS é privado).
- FreeStorage < 2 GB: crescimento anômalo. Ver maiores tabelas; storage gp3 cresce com `modify-db-instance --allocated-storage`.
- **Single-AZ (ADR-043 Adendo):** sem failover automático. Falha de instância/AZ = restore (PITR/snapshot `cerebro-postgres-enc-pre-singleaz-*`), não failover. Gatilho p/ religar Multi-AZ: 1º paciente pagante ou crédito Founders Hub.

## Logs (CloudWatch)
- Containers: log groups `/cerebro/{api-gateway,orchestrator-py,agents-py,notifier-py,web}` (awslogs driver, retenção 14d).
- Checkup/web (ASG): `/cerebro-amigo/checkup`, `/cerebro-amigo/web`.
- Lambdas: `/aws/lambda/cerebro-*`.

## Crise clínica (NÃO é alarme de infra)
Protocolo de crise tem trilha própria (ADR-041, watchdog `classifier_error`). Alerta de crise ao médico = entrega garantida com retry/escalonamento — independente desta observabilidade de infra. Ver `clinical-safety`.

## Ativar SMS (quando quiser)
```
aws sns subscribe --topic-arn arn:aws:sns:sa-east-1:004177894935:cerebro-amigo-piloto-alertas \
  --protocol sms --notification-endpoint +55XXXXXXXXXXX --region sa-east-1
```

## IaC
- `infra/aws/observability-piloto.yaml` (sa-east-1): SNS + alarmes EC2/RDS + log groups.
- `infra/aws/uptime-piloto.yaml` (us-east-1): Route53 health checks + alarmes + SNS.
- `infra/aws/ec2-cloudwatch-logs-policy.json`: grant de logs na role `EC2-SSM-CerebroAmigo` (awslogs driver).
