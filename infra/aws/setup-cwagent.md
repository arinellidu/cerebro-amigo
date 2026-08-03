# CWAgent + alarme de memória — EC2 `cerebro-app` (t3.small)

Objetivo: publicar **RAM e swap** no CloudWatch (EC2 não publica memória por padrão) e
disparar e-mail quando a pressão de memória justificar subir `t3.small → t3.medium`.

Gatilho de decisão, não chute: enquanto não tocar, a instância fica no `small`.

- Instância: `i-057860cd97edafefb` (cerebro-app), região `sa-east-1`
- Role do box: `EC2-SSM-CerebroAmigo`
- SNS reusado: `arn:aws:sns:sa-east-1:004177894935:cerebro-amigo-checkup-alertas` (assinante: alerts@arinelli.com)
- Config do agent: [`cwagent-config.json`](./cwagent-config.json) — namespace `CWAgent`, dims `[InstanceId]`

Baseline medido em 2026-06-11 (box ~ocioso, sem usuários): `available` 681 MB / 1913,
app inteiro ~628 MiB, orchestrator a 28% da reserva, **zero OOM**, swap 274 MB (13%).

---

## Passo 1 — IAM: liberar `PutMetricData` na role (rodar em terminal AWS autenticado)

A inline `CerebroAmigoCloudWatchLogs` só tem `logs:*`. CWAgent precisa de `PutMetricData`.
Policy mínima (restrita ao namespace `CWAgent`):

```bash
aws iam put-role-policy \
  --role-name EC2-SSM-CerebroAmigo \
  --policy-name CerebroAmigoCWAgentMetrics \
  --policy-document '{"Version":"2012-10-17","Statement":[{"Sid":"CWAgentPutMetrics","Effect":"Allow","Action":"cloudwatch:PutMetricData","Resource":"*","Condition":{"StringEquals":{"cloudwatch:namespace":"CWAgent"}}}]}'
```

## Passo 2 — Instalar e subir o agent no box (Session Manager)

Console → EC2 → `i-057860cd97edafefb` → Connect → Session Manager. Depois:

```bash
# Instala (AL2023=dnf, AL2=yum; fallback rpm cobre ambos)
sudo dnf install -y amazon-cloudwatch-agent 2>/dev/null \
  || sudo yum install -y amazon-cloudwatch-agent 2>/dev/null \
  || (curl -fsSL "https://amazoncloudwatch-agent-sa-east-1.s3.sa-east-1.amazonaws.com/amazon_linux/$(uname -m)/latest/amazon-cloudwatch-agent.rpm" -o /tmp/cwagent.rpm && sudo rpm -U /tmp/cwagent.rpm)

# Grava a config (cole o conteúdo de cwagent-config.json entre os EOF)
sudo tee /opt/aws/amazon-cloudwatch-agent/etc/cwagent-config.json > /dev/null <<'JSON'
<<< cole aqui o conteúdo de infra/aws/cwagent-config.json >>>
JSON

# Carrega config e inicia (habilita no boot automaticamente)
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config -m ec2 -s -c file:/opt/aws/amazon-cloudwatch-agent/etc/cwagent-config.json

# Confere
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a status
```

Em ~2 min as métricas `mem_used_percent` / `swap_used_percent` aparecem no namespace `CWAgent`.

## Passo 3 — Alarmes (rodar em terminal AWS autenticado)

Já podem ser criados antes do agent subir — ficam `INSUFFICIENT_DATA` até a métrica fluir.

```bash
# RAM > 85% por 10 min sustentados → avaliar upgrade
aws cloudwatch put-metric-alarm --region sa-east-1 \
  --alarm-name cerebro-app-mem-alta \
  --alarm-description "RAM do EC2 cerebro-app > 85% por 10min — avaliar t3.small->medium" \
  --namespace CWAgent --metric-name mem_used_percent \
  --dimensions Name=InstanceId,Value=i-057860cd97edafefb \
  --statistic Average --period 300 --evaluation-periods 2 --threshold 85 \
  --comparison-operator GreaterThanThreshold \
  --treat-missing-data notBreaching \
  --alarm-actions arn:aws:sns:sa-east-1:004177894935:cerebro-amigo-checkup-alertas \
  --ok-actions arn:aws:sns:sa-east-1:004177894935:cerebro-amigo-checkup-alertas

# Swap > 40% por 15 min → pressão de RAM crescente (aviso antecipado; baseline hoje 13%)
aws cloudwatch put-metric-alarm --region sa-east-1 \
  --alarm-name cerebro-app-swap-alta \
  --alarm-description "Swap do EC2 cerebro-app > 40% por 15min — pressao de RAM crescente" \
  --namespace CWAgent --metric-name swap_used_percent \
  --dimensions Name=InstanceId,Value=i-057860cd97edafefb \
  --statistic Average --period 300 --evaluation-periods 3 --threshold 40 \
  --comparison-operator GreaterThanThreshold \
  --treat-missing-data notBreaching \
  --alarm-actions arn:aws:sns:sa-east-1:004177894935:cerebro-amigo-checkup-alertas \
  --ok-actions arn:aws:sns:sa-east-1:004177894935:cerebro-amigo-checkup-alertas
```

## Quando o alarme tocar

1. `mem-alta` disparou → ver `docker stats` no box: qual container subiu.
   - **orchestrator/web/gateway** (sem teto) crescendo → headroom acabando → **subir para t3.medium**.
   - **agents-py/checkup/notifier** batendo no teto duro → comportamento esperado, ignorar.
2. Upgrade = stop / change instance type / start (~2 min downtime). Fazer em janela de baixo tráfego.
3. `swap-alta` antes do `mem-alta` = aviso macio; observar tendência antes de pagar.
