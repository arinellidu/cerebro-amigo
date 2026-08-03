#!/usr/bin/env bash
# Provisiona o volume EBS de dados do Postgres self-hosted (ADR-077).
# Idempotente: re-execução com o volume já montado é no-op.
# Rodar como root na instância (via SSM).
#
# Dois caminhos:
#  a) volume EBS extra JÁ anexado à instância → detectado localmente, sem AWS API
#     (a role EC2-SSM-CerebroAmigo não tem ec2:*Volume; anexar de fora: aws ec2
#     create-volume --encrypted + attach-volume com credencial de operador);
#  b) nenhum volume extra → cria+anexa via AWS CLI (exige IAM ec2:{Describe,Create,
#     Attach}Volume+CreateTags na role da instância).
set -euo pipefail

VOLUME_NAME="cerebro-postgres-data"
VOLUME_SIZE_GB=20                 # docs/migration/00-discovery.md §7.3 (dados+50%, mínimo 20 GB)
VOLUME_TYPE="gp3"
MOUNT_POINT="/data/postgres"
ATTACH_DEVICE="/dev/sdf"          # em nitro aparece como /dev/nvmeXn1; resolvido por volume-id abaixo
PG_UID=999                        # postgres da imagem oficial
PG_GID=999

log() { echo "[setup-data-volume] $*"; }

ensure_fstab_and_owner() {
  local dev="$1"
  local uuid
  uuid=$(blkid -s UUID -o value "$dev")
  [ -n "$uuid" ] || { log "ERRO: sem UUID em $dev"; exit 1; }
  if ! grep -q "UUID=$uuid" /etc/fstab; then
    echo "UUID=$uuid $MOUNT_POINT xfs defaults,nofail 0 2" >> /etc/fstab
    log "fstab: entrada adicionada (UUID=$uuid, nofail)"
  else
    log "fstab: entrada já existe — ok"
  fi
  mkdir -p "$MOUNT_POINT"
  if ! mountpoint -q "$MOUNT_POINT"; then
    systemctl daemon-reload 2>/dev/null || true
    mount "$MOUNT_POINT"
    log "montado em $MOUNT_POINT"
  else
    log "já montado em $MOUNT_POINT — ok"
  fi
  if [ "$(stat -c '%u:%g' "$MOUNT_POINT")" != "$PG_UID:$PG_GID" ]; then
    chown "$PG_UID:$PG_GID" "$MOUNT_POINT"
    log "chown $PG_UID:$PG_GID aplicado"
  else
    log "owner $PG_UID:$PG_GID já correto — ok"
  fi
}

# ── Curto-circuito idempotente: já montado → só garantir fstab/owner ─────────
if mountpoint -q "$MOUNT_POINT"; then
  DEV=$(findmnt -no SOURCE "$MOUNT_POINT")
  log "no-op: $MOUNT_POINT já montado ($DEV); conferindo fstab/owner"
  ensure_fstab_and_owner "$DEV"
  exit 0
fi

# ── Caminho (a): volume EBS extra já anexado → usar sem tocar na AWS API ────
ROOT_DISK=$(lsblk -no PKNAME "$(findmnt -no SOURCE /)" | head -1)
# só links de disco inteiro (sem -part*/-ns-*), dedup por device real, sem o disco root
mapfile -t CANDIDATES < <(
  for link in /dev/disk/by-id/nvme-Amazon_Elastic_Block_Store_vol*; do
    [ -e "$link" ] || continue
    [[ "$link" == *-part* || "$link" == *-ns-* ]] && continue
    readlink -f "$link"
  done | sort -u | grep -vx "/dev/$ROOT_DISK" || true
)
if [ "${#CANDIDATES[@]}" -eq 1 ]; then
  DEV="${CANDIDATES[0]}"
  log "device EBS extra detectado localmente: $DEV (pulando AWS API)"
  if blkid "$DEV" >/dev/null 2>&1; then
    log "filesystem já presente em $DEV ($(blkid -s TYPE -o value "$DEV")) — NÃO formatando"
  else
    log "sem filesystem — mkfs.xfs em $DEV"
    mkfs.xfs -q "$DEV"
  fi
  ensure_fstab_and_owner "$DEV"
  log "concluído"
  exit 0
elif [ "${#CANDIDATES[@]}" -gt 1 ]; then
  log "ERRO: ${#CANDIDATES[@]} volumes EBS extras anexados — ambíguo, resolva manualmente: ${CANDIDATES[*]}"
  exit 1
fi
log "nenhum volume extra anexado — caminho (b): criar/anexar via AWS API"

# ── Identidade da instância via IMDSv2 ───────────────────────────────────────
TOKEN=$(curl -sf -X PUT http://169.254.169.254/latest/api/token \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 300")
imds() { curl -sf -H "X-aws-ec2-metadata-token: $TOKEN" "http://169.254.169.254/latest/meta-data/$1"; }
INSTANCE_ID=$(imds instance-id)
AZ=$(imds placement/availability-zone)
REGION=$(imds placement/region)
log "instância $INSTANCE_ID em $AZ"

# ── Volume: localizar por tag ou criar (cifrado — LGPD/ADR-077) ─────────────
VOL_ID=$(aws ec2 describe-volumes --region "$REGION" \
  --filters "Name=tag:Name,Values=$VOLUME_NAME" "Name=availability-zone,Values=$AZ" \
            "Name=status,Values=creating,available,in-use" \
  --query 'Volumes[0].VolumeId' --output text)

if [ "$VOL_ID" = "None" ] || [ -z "$VOL_ID" ]; then
  log "criando volume $VOLUME_TYPE ${VOLUME_SIZE_GB}G cifrado em $AZ"
  VOL_ID=$(aws ec2 create-volume --region "$REGION" \
    --availability-zone "$AZ" --size "$VOLUME_SIZE_GB" --volume-type "$VOLUME_TYPE" \
    --encrypted \
    --tag-specifications "ResourceType=volume,Tags=[{Key=Name,Value=$VOLUME_NAME},{Key=project,Value=cerebro-amigo},{Key=env,Value=prod-pilot}]" \
    --query 'VolumeId' --output text)
  aws ec2 wait volume-available --region "$REGION" --volume-ids "$VOL_ID"
  log "volume criado: $VOL_ID"
else
  log "volume existente: $VOL_ID"
fi

# ── Anexar (se ainda não anexado a esta instância) ───────────────────────────
ATTACHED_TO=$(aws ec2 describe-volumes --region "$REGION" --volume-ids "$VOL_ID" \
  --query 'Volumes[0].Attachments[0].InstanceId' --output text)
if [ "$ATTACHED_TO" = "$INSTANCE_ID" ]; then
  log "já anexado a esta instância — ok"
elif [ "$ATTACHED_TO" = "None" ] || [ -z "$ATTACHED_TO" ]; then
  log "anexando $VOL_ID em $ATTACH_DEVICE"
  aws ec2 attach-volume --region "$REGION" --volume-id "$VOL_ID" \
    --instance-id "$INSTANCE_ID" --device "$ATTACH_DEVICE" >/dev/null
  aws ec2 wait volume-in-use --region "$REGION" --volume-ids "$VOL_ID"
else
  log "ERRO: $VOL_ID anexado a OUTRA instância ($ATTACHED_TO) — abortando"
  exit 1
fi

# ── Resolver device nvme pelo volume-id (nitro) e aguardar udev ──────────────
BY_ID="/dev/disk/by-id/nvme-Amazon_Elastic_Block_Store_${VOL_ID/-/}"
for _ in $(seq 1 30); do [ -e "$BY_ID" ] && break; sleep 2; done
[ -e "$BY_ID" ] || { log "ERRO: device de $VOL_ID não apareceu ($BY_ID)"; exit 1; }
DEV=$(readlink -f "$BY_ID")
log "device: $DEV"

# ── Formatar SOMENTE se não houver filesystem (guarda blkid) ─────────────────
if blkid "$DEV" >/dev/null 2>&1; then
  log "filesystem já presente em $DEV ($(blkid -s TYPE -o value "$DEV")) — NÃO formatando"
else
  log "sem filesystem — mkfs.xfs em $DEV"
  mkfs.xfs -q "$DEV"
fi

ensure_fstab_and_owner "$DEV"
log "concluído"
