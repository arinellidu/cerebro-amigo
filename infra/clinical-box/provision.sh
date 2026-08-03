#!/bin/bash
# Provisiona o box único do stack clínico (ADR-079). Roda no LAPTOP do operador
# (aws cli com credenciais de admin), NÃO no box. Idempotente por tag/nome.
# Cria: SG (80/443 + TURN), EC2 t3.medium AL2023 (SP 6c71ed92 cobre), volume de
# dados 20GB gp3 cifrado, EIP e buckets S3 de áudio (nomes pré-teardown → casam
# com as policies já existentes na role EC2-SSM-CerebroAmigo).
set -euo pipefail

REGION=sa-east-1
NAME=cerebro-clinical-box
SG_NAME=cerebro-clinical-sg
PROFILE_NAME=EC2-SSM-CerebroAmigo

VPC_ID=$(aws ec2 describe-vpcs --region $REGION \
  --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
SUBNET_ID=$(aws ec2 describe-subnets --region $REGION \
  --filters Name=vpc-id,Values=$VPC_ID --query 'Subnets[0].SubnetId' --output text)

# ── Security group ───────────────────────────────────────────────────────────
SG_ID=$(aws ec2 describe-security-groups --region $REGION \
  --filters Name=group-name,Values=$SG_NAME Name=vpc-id,Values=$VPC_ID \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || echo None)
if [ "$SG_ID" = "None" ] || [ -z "$SG_ID" ]; then
  SG_ID=$(aws ec2 create-security-group --region $REGION --group-name $SG_NAME \
    --description "Box unico clinico (ADR-079): HTTP/HTTPS + TURN" \
    --vpc-id "$VPC_ID" --query GroupId --output text)
  aws ec2 authorize-security-group-ingress --region $REGION --group-id "$SG_ID" \
    --ip-permissions \
      'IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0}],Ipv6Ranges=[{CidrIpv6=::/0}]' \
      'IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0}],Ipv6Ranges=[{CidrIpv6=::/0}]' \
      'IpProtocol=udp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0}]' \
      'IpProtocol=tcp,FromPort=3478,ToPort=3478,IpRanges=[{CidrIp=0.0.0.0/0}]' \
      'IpProtocol=udp,FromPort=3478,ToPort=3478,IpRanges=[{CidrIp=0.0.0.0/0}]' \
      'IpProtocol=udp,FromPort=49152,ToPort=49251,IpRanges=[{CidrIp=0.0.0.0/0}]'
fi
echo "SG: $SG_ID"

# ── Buckets S3 de áudio (privados; nomes casam com policies da role) ─────────
for b in cerebro-amigo-audio-sa-east-1 cerebro-amigo-audio-msgs cerebro-amigo-social; do
  if ! aws s3api head-bucket --bucket "$b" 2>/dev/null; then
    aws s3api create-bucket --bucket "$b" --region $REGION \
      --create-bucket-configuration LocationConstraint=$REGION
    aws s3api put-public-access-block --bucket "$b" --public-access-block-configuration \
      BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
    echo "bucket criado: $b"
  fi
done
# Áudio do escriba/diário é EFÊMERO (delete pós-transcrição); lifecycle 1d = 2ª defesa.
aws s3api put-bucket-lifecycle-configuration --bucket cerebro-amigo-audio-sa-east-1 \
  --lifecycle-configuration '{"Rules":[{"ID":"efemero-1d","Status":"Enabled","Filter":{},"Expiration":{"Days":1}}]}'
# Mensagens de áudio paciente→médico: retenção 60d (ADR-064).
aws s3api put-bucket-lifecycle-configuration --bucket cerebro-amigo-audio-msgs \
  --lifecycle-configuration '{"Rules":[{"ID":"retencao-60d","Status":"Enabled","Filter":{},"Expiration":{"Days":60}}]}'

# ── Instância ────────────────────────────────────────────────────────────────
EXISTING=$(aws ec2 describe-instances --region $REGION \
  --filters "Name=tag:Name,Values=$NAME" "Name=instance-state-name,Values=pending,running,stopped" \
  --query 'Reservations[0].Instances[0].InstanceId' --output text 2>/dev/null || echo None)
if [ "$EXISTING" != "None" ] && [ -n "$EXISTING" ]; then
  echo "instância já existe: $EXISTING"; INSTANCE_ID=$EXISTING
else
  AMI_ID=$(aws ssm get-parameter --region $REGION \
    --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
    --query Parameter.Value --output text)

  USERDATA=$(base64 <<'UD'
#!/bin/bash
set -euxo pipefail
dnf install -y docker
systemctl enable --now docker
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL https://github.com/docker/compose/releases/download/v2.39.4/docker-compose-linux-x86_64 \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
# Volume de dados (segundo device) → /data (xfs, fstab por UUID, nofail)
DEV=$(lsblk -dn -o NAME,TYPE | awk '$2=="disk" && $1!~"nvme0"{print "/dev/"$1; exit}')
if [ -n "$DEV" ] && ! blkid "$DEV"; then mkfs.xfs "$DEV"; fi
mkdir -p /data
UUID=$(blkid -s UUID -o value "$DEV")
grep -q "$UUID" /etc/fstab || echo "UUID=$UUID /data xfs defaults,nofail 0 2" >> /etc/fstab
mount -a
mkdir -p /data/postgres /data/pgcerts /opt/cerebro-amigo-v3
chown 999:999 /data/postgres
# Swap 4G (builds no box + folga p/ o stack)
if [ ! -f /swapfile ]; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab && swapon -a
fi
sysctl -w vm.swappiness=10
echo 'vm.swappiness=10' > /etc/sysctl.d/99-swap.conf
UD
)

  INSTANCE_ID=$(aws ec2 run-instances --region $REGION \
    --image-id "$AMI_ID" --instance-type t3.medium \
    --iam-instance-profile Name=$PROFILE_NAME \
    --security-group-ids "$SG_ID" --subnet-id "$SUBNET_ID" \
    --block-device-mappings \
      '[{"DeviceName":"/dev/xvda","Ebs":{"VolumeSize":30,"VolumeType":"gp3","Encrypted":true}},{"DeviceName":"/dev/sdf","Ebs":{"VolumeSize":20,"VolumeType":"gp3","Encrypted":true}}]' \
    --user-data "$USERDATA" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$NAME},{Key=Projeto,Value=cerebro-amigo}]" \
    --query 'Instances[0].InstanceId' --output text)
  echo "instância: $INSTANCE_ID"
  aws ec2 wait instance-running --region $REGION --instance-ids "$INSTANCE_ID"
fi

# ── EIP ──────────────────────────────────────────────────────────────────────
ALLOC_ID=$(aws ec2 describe-addresses --region $REGION \
  --filters "Name=tag:Name,Values=$NAME" \
  --query 'Addresses[0].AllocationId' --output text 2>/dev/null || echo None)
if [ "$ALLOC_ID" = "None" ] || [ -z "$ALLOC_ID" ]; then
  ALLOC_ID=$(aws ec2 allocate-address --region $REGION --domain vpc \
    --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=$NAME}]" \
    --query AllocationId --output text)
fi
aws ec2 associate-address --region $REGION --instance-id "$INSTANCE_ID" \
  --allocation-id "$ALLOC_ID" --allow-reassociation >/dev/null
EIP=$(aws ec2 describe-addresses --region $REGION --allocation-ids "$ALLOC_ID" \
  --query 'Addresses[0].PublicIp' --output text)

echo "=============================================="
echo "instance: $INSTANCE_ID"
echo "EIP:      $EIP"
echo "próximo:  segredos SSM + tarball + deploy (ver ADR-079)"
