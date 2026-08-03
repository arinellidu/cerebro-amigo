#!/usr/bin/env bash
# cost-stop-start.sh — liga/desliga compute do piloto em janelas sem ninguem usando.
#
#   ./cost-stop-start.sh status                      (so mostra estado — seguro)
#   ./cost-stop-start.sh stop   [--include-public] [--yes]
#   ./cost-stop-start.sh start  [--include-public] [--yes]
#
# Alvo padrao: box clinico (EC2 cerebro-app) + RDS.
# --include-public  tambem escala os ASG web/checkup p/ 0 (stop) / 1 (start).
# --yes             pula a confirmacao interativa (use com cuidado em automacao).
#
# ====================  AVISOS  ====================
#  ⚠️  OUTAGE TOTAL. O RDS e' COMPARTILHADO (SPOF): parar o RDS derruba
#      TODO o produto — clinico, checkup PUBLICO e dashboard web — nao so o medico.
#      So rode quando NINGUEM estiver usando: nenhum medico/paciente atendendo,
#      nenhum lead no checkup, nenhuma janela de crise aberta.
#
#  💰  Sob o Savings Plan ativo 6c71ed92 (compute t3 pre-pago ate 2027-06-18),
#      PARAR EC2 NAO ECONOMIZA (o compromisso e' pago de qualquer jeito).
#      O ganho real de desligar = horas de RDS. (Revisar apos 2027-06-18.)
# ==================================================
set -euo pipefail

REGION="sa-east-1"
EXPECTED_ACCOUNT="004177894935"
CLINICAL_EC2="i-057860cd97edafefb"   # cerebro-app (box clinico, standalone)
RDS_ID="cerebro-postgres-enc"
PUBLIC_ASGS=("cerebro-web-asg" "cerebro-checkup-asg")

ACTION="${1:-}"; shift || true
INCLUDE_PUBLIC=0; YES=0
for a in "$@"; do
  case "$a" in
    --include-public) INCLUDE_PUBLIC=1 ;;
    --yes) YES=1 ;;
    *) echo "flag desconhecida: $a"; exit 2 ;;
  esac
done

acct="$(aws sts get-caller-identity --query Account --output text)"
[[ "$acct" == "$EXPECTED_ACCOUNT" ]] || { echo "ABORT: conta $acct != $EXPECTED_ACCOUNT"; exit 1; }

ec2_state() { aws ec2 describe-instances --region "$REGION" --instance-ids "$1" \
  --query 'Reservations[0].Instances[0].State.Name' --output text 2>/dev/null || echo "unknown"; }
rds_state() { aws rds describe-db-instances --region "$REGION" --db-instance-identifier "$1" \
  --query 'DBInstances[0].DBInstanceStatus' --output text 2>/dev/null || echo "unknown"; }
asg_state() { aws autoscaling describe-auto-scaling-groups --region "$REGION" \
  --auto-scaling-group-names "$1" \
  --query 'AutoScalingGroups[0].{min:MinSize,des:DesiredCapacity,n:length(Instances)}' \
  --output text 2>/dev/null || echo "unknown"; }

show_status() {
  echo "== Estado atual (regiao $REGION) =="
  echo "  EC2 clinico  $CLINICAL_EC2 : $(ec2_state "$CLINICAL_EC2")"
  echo "  RDS          $RDS_ID : $(rds_state "$RDS_ID")"
  for asg in "${PUBLIC_ASGS[@]}"; do
    echo "  ASG          $asg : $(asg_state "$asg")  (min/desired/instancias)"
  done
}

confirm() {
  local word="$1"
  [[ $YES -eq 1 ]] && return 0
  echo
  echo "⚠️  Isto causa OUTAGE TOTAL (RDS compartilhado). NAO rode com medico/paciente ativo."
  echo "    Confirme digitando: $word"
  read -r -p "> " ans
  [[ "$ans" == "$word" ]] || { echo "Cancelado."; exit 1; }
}

case "$ACTION" in
  status)
    show_status
    ;;

  stop)
    show_status
    confirm "DESLIGAR"
    echo "== STOP =="
    # 1) Camada de app primeiro (para conexoes antes do banco)
    if [[ $INCLUDE_PUBLIC -eq 1 ]]; then
      for asg in "${PUBLIC_ASGS[@]}"; do
        echo "  ASG $asg -> min=0 desired=0"
        aws autoscaling update-auto-scaling-group --region "$REGION" \
          --auto-scaling-group-name "$asg" --min-size 0 --desired-capacity 0
      done
    fi
    if [[ "$(ec2_state "$CLINICAL_EC2")" == "running" ]]; then
      echo "  EC2 $CLINICAL_EC2 -> stop"
      aws ec2 stop-instances --region "$REGION" --instance-ids "$CLINICAL_EC2" >/dev/null
    else
      echo "  EC2 ja nao esta running — pulando"
    fi
    # 2) Banco por ultimo
    if [[ "$(rds_state "$RDS_ID")" == "available" ]]; then
      echo "  RDS $RDS_ID -> stop  (auto-religa em 7 dias; Single-AZ ok)"
      aws rds stop-db-instance --region "$REGION" --db-instance-identifier "$RDS_ID" >/dev/null
    else
      echo "  RDS nao esta 'available' — pulando (estado: $(rds_state "$RDS_ID"))"
    fi
    echo "OK. Desligamento iniciado. Lembre: RDS para de cobrar instancia-hora; storage continua."
    ;;

  start)
    show_status
    confirm "LIGAR"
    echo "== START =="
    # 1) Banco primeiro e ESPERA ficar disponivel
    if [[ "$(rds_state "$RDS_ID")" == "stopped" ]]; then
      echo "  RDS $RDS_ID -> start"
      aws rds start-db-instance --region "$REGION" --db-instance-identifier "$RDS_ID" >/dev/null
      echo "  aguardando RDS available..."
      aws rds wait db-instance-available --region "$REGION" --db-instance-identifier "$RDS_ID"
      echo "  RDS available"
    else
      echo "  RDS nao esta 'stopped' — pulando (estado: $(rds_state "$RDS_ID"))"
    fi
    # 2) App depois (encontra o banco pronto)
    if [[ "$(ec2_state "$CLINICAL_EC2")" == "stopped" ]]; then
      echo "  EC2 $CLINICAL_EC2 -> start"
      aws ec2 start-instances --region "$REGION" --instance-ids "$CLINICAL_EC2" >/dev/null
    else
      echo "  EC2 ja nao esta stopped — pulando"
    fi
    if [[ $INCLUDE_PUBLIC -eq 1 ]]; then
      for asg in "${PUBLIC_ASGS[@]}"; do
        echo "  ASG $asg -> min=1 desired=1"
        aws autoscaling update-auto-scaling-group --region "$REGION" \
          --auto-scaling-group-name "$asg" --min-size 1 --desired-capacity 1
      done
    fi
    echo "OK. Religamento iniciado. VALIDE a saude antes de liberar uso:"
    echo "  - gateway:  curl -fsS https://api.cerebroamigo.com.br/health"
    echo "  - portal:   curl -fsS https://www.cerebroamigo.com.br"
    echo "  (docker compose sobe sozinho no boot do box; aguarde ~1-2min.)"
    ;;

  *)
    echo "Uso: $0 {status|stop|start} [--include-public] [--yes]"
    exit 2
    ;;
esac
