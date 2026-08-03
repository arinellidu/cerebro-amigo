# Runbook — Trava de custo do piloto

Guardrails de custo da conta `004177894935` (sa-east-1). Montado 2026-06-22.

## O que está no ar

| Item | Recurso | Onde |
|------|---------|------|
| Budget mensal | `cerebro-amigo-mensal` — teto **US$ 120**, alertas **50/80/100%** ACTUAL + **100%** FORECASTED → `alerts@arinelli.com` | CFN `cerebro-cost-guardrails` (us-east-1), template `infra/aws/cost-guardrails.yaml` |
| Anomaly Detection | monitor `Default-Services-Monitor` + assinatura nova `cerebro-amigo-anomalia` (abs ≥ **US$ 20**, DAILY) → `alerts@arinelli.com` | criada via `aws ce create-anomaly-subscription` |
| Tags de custo | `project=cerebro-amigo`, `env=prod-pilot` em 3 EC2 + EBS + RDS + 2 ALB + 2 ASG | `infra/aws/cost-tags.sh` |
| Stop/start | box clínico + RDS (opcional web/checkup) | `infra/aws/cost-stop-start.sh` |

> O budget rastreia **custo bruto** (`IncludeCredit/Refund=false`): crédito que está acabando **não** mascara o alerta. Substituiu o antigo `My Monthly Cost Budget` ($100, alertas → tsoww7@/arinpar@), deletado.

## Budget — operar

```bash
# ver budget + thresholds
aws budgets describe-budget --account-id 004177894935 --budget-name cerebro-amigo-mensal
# mudar o teto (redeploy do stack)
aws cloudformation deploy --template-file infra/aws/cost-guardrails.yaml \
  --stack-name cerebro-cost-guardrails --region us-east-1 \
  --parameter-overrides MonthlyLimitUsd=<novo> NotifyEmail=alerts@arinelli.com
```

Budgets manda e-mail direto — **não** exige confirmação de assinatura (diferente de SNS).

## Tags — ativar como Cost Allocation Tag

`cost-tags.sh` taggea os recursos e tenta ativar `project`/`env` como cost allocation tags.
A ativação **falha na 1ª vez** ("Tag keys not found") porque o billing só "vê" a tag key
~24h depois de existir num recurso. **Reexecute o script (ou só o trecho de ativação) no dia seguinte:**

```bash
aws ce update-cost-allocation-tags-status --region us-east-1 \
  --cost-allocation-tags-status TagKey=project,Status=Active TagKey=env,Status=Active
```

Depois de Ativo, custo por `project`/`env` aparece no Cost Explorer (só dali pra frente; não é retroativo).
ASG tem `PropagateAtLaunch=true` → instância nova de scale-out já nasce taggeada.

## Stop/start — desligar em janela sem ninguém

```bash
./infra/aws/cost-stop-start.sh status                 # estado (seguro, só lê)
./infra/aws/cost-stop-start.sh stop                   # box clínico + RDS
./infra/aws/cost-stop-start.sh stop  --include-public # + web/checkup (ASG → 0)
./infra/aws/cost-stop-start.sh start                  # religa (RDS primeiro, espera, depois EC2)
```

### ⚠️ Avisos obrigatórios

- **OUTAGE TOTAL.** O RDS `cerebro-postgres-enc` é **compartilhado** (SPOF): clínico + checkup
  público + dashboard web batem nele. Parar o RDS derruba **o produto inteiro**, não só o médico.
  Só rode quando **ninguém** estiver usando: nenhum médico/paciente em atendimento, nenhum lead
  no checkup, **nenhuma janela de crise aberta**. O script exige digitar `DESLIGAR`/`LIGAR`
  (pule só com `--yes` em automação).
- **EC2 stop ≈ economia zero hoje.** O Savings Plan `6c71ed92` (Compute, t3, $0.0772/h,
  até **2027-06-18**) é compute **pré-pago** — para de cobrar nada por instância parada;
  o compromisso é pago igual. **O único ganho real de desligar = horas de RDS.**
  Revisar a utilidade de parar EC2 só **depois de 2027-06-18**.
- **RDS auto-religa em 7 dias.** Stop de RDS é temporário por design da AWS; o script trata
  Single-AZ (Multi-AZ não pode ser parado — hoje é Single-AZ).
- **Ordem.** stop = app (EC2/ASG) → depois RDS. start = RDS (espera `available`) → depois EC2/ASG.
  Após `start`, **valide saúde** antes de liberar uso:
  `curl -fsS https://api.cerebroamigo.com.br/health` e `https://www.cerebroamigo.com.br`.

## Onde o dinheiro realmente vai — e por que stop/start quase não ajuda hoje

MTD junho por serviço (`aws ce get-cost-and-usage`), maiores: **ELB ~$9** (2 ALB fixos) ·
**VPC/IPv4 público ~$10** · Savings Plan (pré-pago) · **Tax ~$7**.

- **RDS = ~$0** — confirmado em **maio fechado** *e* junho MTD, sem RI ativa (coberto/grandfathered).
- **EC2** roda sob Savings Plan pré-pago (sunk).

**Conclusão honesta:** parar EC2+RDS hoje **economiza ≈ nada** — EC2 é pré-pago e RDS já é $0.
Os scripts de stop/start passam a valer **(a) depois de 2027-06-18** (vence o Savings Plan) ou
**(b) se o RDS voltar a cobrar** (cobertura atual acabar — o budget/anomaly pega). Os alvos de
corte real **agora** são fixos e fora do stop/start: consolidar os 2 ALB (~$9→~$4),
soltar IPv4 público ocioso (~$10), ou esperar o Savings Plan vencer. Ver
[[project-infra-baseline-2026-06-21]] e [[project-aws-credit-masking]].
