#!/usr/bin/env bash
# cost-tags.sh — aplica tags de custo (project/env) nos recursos do piloto
# e ativa as tag keys como Cost Allocation Tags no Billing.
#
# Tags: project=cerebro-amigo  env=prod-pilot
# Recursos: 3 EC2 (cerebro-app/web/checkup) + EBS anexados + RDS + 2 ALB + 2 ASG.
# ASG recebe tag com PropagateAtLaunch=true → instancias futuras ja nascem taggeadas.
#
# Idempotente (create-tags sobrescreve). Seguro: so adiciona metadado, nao altera infra.
#
# Uso: ./cost-tags.sh            (aplica)
#      ./cost-tags.sh --dry-run  (so mostra o que faria)
set -euo pipefail

REGION="sa-east-1"
EXPECTED_ACCOUNT="004177894935"
P_KEY="project"; P_VAL="cerebro-amigo"
E_KEY="env";     E_VAL="prod-pilot"
RDS_ID="cerebro-postgres-enc"
ASGS=("cerebro-web-asg" "cerebro-checkup-asg")
DRY=0; [[ "${1:-}" == "--dry-run" ]] && DRY=1

acct="$(aws sts get-caller-identity --query Account --output text)"
[[ "$acct" == "$EXPECTED_ACCOUNT" ]] || { echo "ABORT: conta $acct != $EXPECTED_ACCOUNT"; exit 1; }
run() { if [[ $DRY -eq 1 ]]; then echo "  [dry-run] $*"; else "$@"; fi; }
# Bash 3.2 (macOS) nao tem mapfile — coleta linhas de forma portavel.
read_lines() { _RL=(); local l; while IFS= read -r l; do [[ -n "$l" ]] && _RL+=("$l"); done; }

echo "== Tags project=$P_VAL / env=$E_VAL (regiao $REGION) =="

# --- EC2: instancias (todas as cerebro-*) + volumes EBS anexados ---
echo "-- EC2 instances + EBS --"
read_lines < <(aws ec2 describe-instances --region "$REGION" \
  --filters "Name=tag:Name,Values=cerebro-*" "Name=instance-state-name,Values=running,stopped" \
  --query 'Reservations[].Instances[].InstanceId' --output text | tr '\t' '\n')
INSTANCE_IDS=("${_RL[@]:-}")
for id in "${INSTANCE_IDS[@]}"; do
  [[ -z "$id" ]] && continue
  echo "  instancia $id"
  run aws ec2 create-tags --region "$REGION" --resources "$id" \
    --tags "Key=$P_KEY,Value=$P_VAL" "Key=$E_KEY,Value=$E_VAL"
  # volumes anexados (linha EC2-Other no billing)
  read_lines < <(aws ec2 describe-volumes --region "$REGION" \
    --filters "Name=attachment.instance-id,Values=$id" \
    --query 'Volumes[].VolumeId' --output text | tr '\t' '\n')
  VOLS=("${_RL[@]:-}")
  for v in "${VOLS[@]}"; do
    [[ -z "$v" ]] && continue
    echo "    volume $v"
    run aws ec2 create-tags --region "$REGION" --resources "$v" \
      --tags "Key=$P_KEY,Value=$P_VAL" "Key=$E_KEY,Value=$E_VAL"
  done
done

# --- RDS ---
echo "-- RDS $RDS_ID --"
RDS_ARN="$(aws rds describe-db-instances --region "$REGION" \
  --db-instance-identifier "$RDS_ID" --query 'DBInstances[0].DBInstanceArn' --output text)"
run aws rds add-tags-to-resource --region "$REGION" --resource-name "$RDS_ARN" \
  --tags "Key=$P_KEY,Value=$P_VAL" "Key=$E_KEY,Value=$E_VAL"

# --- ALBs (ELBv2) ---
echo "-- ALBs --"
read_lines < <(aws elbv2 describe-load-balancers --region "$REGION" \
  --query 'LoadBalancers[].LoadBalancerArn' --output text | tr '\t' '\n')
ALB_ARNS=("${_RL[@]:-}")
for arn in "${ALB_ARNS[@]}"; do
  [[ -z "$arn" ]] && continue
  echo "  $arn"
  run aws elbv2 add-tags --region "$REGION" --resource-arns "$arn" \
    --tags "Key=$P_KEY,Value=$P_VAL" "Key=$E_KEY,Value=$E_VAL"
done

# --- ASGs (com PropagateAtLaunch p/ instancias futuras) ---
echo "-- ASGs --"
for asg in "${ASGS[@]}"; do
  echo "  $asg"
  run aws autoscaling create-or-update-tags --region "$REGION" --tags \
    "ResourceId=$asg,ResourceType=auto-scaling-group,Key=$P_KEY,Value=$P_VAL,PropagateAtLaunch=true" \
    "ResourceId=$asg,ResourceType=auto-scaling-group,Key=$E_KEY,Value=$E_VAL,PropagateAtLaunch=true"
done

# --- Ativar como Cost Allocation Tags (Billing / Cost Explorer) ---
# Servico CE = us-east-1. So funciona depois que o billing ja "viu" as tag keys
# (pode levar ~24h apos taggear). Se falhar agora, rode de novo amanha.
echo "-- Ativando cost allocation tags (us-east-1) --"
if [[ $DRY -eq 1 ]]; then
  echo "  [dry-run] ce update-cost-allocation-tags-status project/env -> Active"
else
  aws ce update-cost-allocation-tags-status --region us-east-1 \
    --cost-allocation-tags-status \
      "TagKey=$P_KEY,Status=Active" "TagKey=$E_KEY,Status=Active" \
    && echo "  OK: project/env = Active (aparece no CE em ~24h, so daqui pra frente)" \
    || echo "  AVISO: ativacao falhou (tag key ainda nao conhecida pelo billing). Reexecute em ~24h."
fi

echo "== Concluido =="
