#!/usr/bin/env bash
# =============================================================================
# setup-diario-audio.sh
# Provisiona infraestrutura para o Diário de Voz (S3 + IAM + migration).
#
# NOTA (2026-06-18): este script de MANAGED policy nunca rodou em prod (role
# placeholder). O bucket cerebro-amigo-audio-sa-east-1 + lifecycle 24h JÁ existiam,
# mas a IAM faltava → transcrição dava AccessDenied no s3:PutObject. Corrigido
# aplicando a `iam-policy-diario-audio.json` (já com s3:PutObjectTagging) como
# INLINE policy `CerebroAmigoAudioDiarioS3Transcribe` na role real do box
# `EC2-SSM-CerebroAmigo`. Para reproduzir num box novo: anexar essa policy à role.
#
# Pré-requisitos:
#   - AWS CLI configurado com perfil que tenha permissão de admin/PowerUser
#   - EC2_ROLE_NAME preenchido abaixo (nome da IAM role da instância EC2)
#   - POSTGRES_DSN exportado no ambiente (não passe como argumento — CloudTrail)
#
# Uso:
#   export POSTGRES_DSN="postgresql://user:pass@host:5432/db"
#   export EC2_ROLE_NAME="cerebro-amigo-ec2-role"   # ajuste ao nome real
#   export AWS_PROFILE="your-profile"               # ou use IAM role/SSO
#   bash infra/aws/setup-diario-audio.sh
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

BUCKET="cerebro-amigo-audio-sa-east-1"
REGION="sa-east-1"
POLICY_NAME="CerebroAmigoTranscribeS3DiarioAudio"
POLICY_FILE="$SCRIPT_DIR/iam-policy-diario-audio.json"
LIFECYCLE_FILE="$SCRIPT_DIR/s3-lifecycle-audio.json"
MIGRATION_FILE="$REPO_ROOT/infra/migrations/0004_diario_audio.sql"

# ─── Validações ──────────────────────────────────────────────────────────────

if [[ -z "${EC2_ROLE_NAME:-}" ]]; then
  echo "ERRO: EC2_ROLE_NAME não definido. Exporte antes de rodar." >&2
  exit 1
fi

if [[ -z "${POSTGRES_DSN:-}" ]]; then
  echo "ERRO: POSTGRES_DSN não definido. Exporte antes de rodar." >&2
  exit 1
fi

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
echo "Conta AWS: $ACCOUNT_ID | Região: $REGION"

# ─── 1. S3 bucket ────────────────────────────────────────────────────────────

echo ""
echo "==> [1/4] S3 bucket: $BUCKET"

if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "    Bucket já existe — pulando criação."
else
  aws s3 mb "s3://$BUCKET" --region "$REGION"
  echo "    Bucket criado."
fi

# Block public access (segurança)
aws s3api put-public-access-block \
  --bucket "$BUCKET" \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
echo "    Public access bloqueado."

# Lifecycle rule — delete objetos com tag auto-delete=true após 24h
aws s3api put-bucket-lifecycle-configuration \
  --bucket "$BUCKET" \
  --lifecycle-configuration "file://$LIFECYCLE_FILE"
echo "    Lifecycle rule aplicada (auto-delete=true → 24h)."

# ─── 2. IAM policy ───────────────────────────────────────────────────────────

echo ""
echo "==> [2/4] IAM policy: $POLICY_NAME"

POLICY_ARN="arn:aws:iam::${ACCOUNT_ID}:policy/${POLICY_NAME}"

if aws iam get-policy --policy-arn "$POLICY_ARN" 2>/dev/null; then
  echo "    Policy já existe — criando nova versão."
  aws iam create-policy-version \
    --policy-arn "$POLICY_ARN" \
    --policy-document "file://$POLICY_FILE" \
    --set-as-default
  # Remove versões antigas (máximo 5 versões por policy)
  aws iam list-policy-versions --policy-arn "$POLICY_ARN" \
    --query 'Versions[?!IsDefaultVersion].VersionId' --output text \
    | tr '\t' '\n' \
    | while read -r ver; do
        aws iam delete-policy-version --policy-arn "$POLICY_ARN" --version-id "$ver"
        echo "    Versão antiga $ver removida."
      done
else
  aws iam create-policy \
    --policy-name "$POLICY_NAME" \
    --policy-document "file://$POLICY_FILE" \
    --description "Permite EC2 transcrever áudio e acessar bucket de áudio efêmero (Diário de Voz)"
  echo "    Policy criada."
fi

# ─── 3. Attach policy na EC2 role ────────────────────────────────────────────

echo ""
echo "==> [3/4] Attach policy na role: $EC2_ROLE_NAME"

if aws iam list-attached-role-policies --role-name "$EC2_ROLE_NAME" \
    --query "AttachedPolicies[?PolicyArn=='$POLICY_ARN']" --output text | grep -q "$POLICY_ARN"; then
  echo "    Policy já anexada — pulando."
else
  aws iam attach-role-policy \
    --role-name "$EC2_ROLE_NAME" \
    --policy-arn "$POLICY_ARN"
  echo "    Policy anexada."
fi

# ─── 4. Migration 0004 ───────────────────────────────────────────────────────

echo ""
echo "==> [4/4] Migration 0004 — diario_audio"
psql "$POSTGRES_DSN" -f "$MIGRATION_FILE" -v ON_ERROR_STOP=1
echo "    Migration aplicada."

# ─── Resumo ──────────────────────────────────────────────────────────────────

echo ""
echo "============================================================"
echo " Diário de Voz — infra pronta!"
echo "============================================================"
echo " Bucket  : s3://$BUCKET (sa-east-1, lifecycle 24h)"
echo " Policy  : $POLICY_ARN"
echo " Role    : $EC2_ROLE_NAME"
echo " Schema  : diario_entradas.tipo + transcricao adicionados"
echo ""
echo " Próximo passo: reiniciar agents-py na EC2 para carregar"
echo " as novas variáveis AWS_REGION / credenciais via IAM role."
echo "============================================================"
