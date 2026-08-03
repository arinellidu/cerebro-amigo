#!/usr/bin/env bash
# =============================================================================
# setup-medico-docs.sh — bucket PRIVADO p/ documentos + foto do médico (ADR-066).
#
# Guarda PII direta de médico (RG/CPF/diploma/contratos/avatar). Provisiona:
#   - bucket S3 privado (4 flags de public-access-block)
#   - criptografia default (SSE-S3 / AES256 + bucket key)
#   - IAM INLINE policy na role do EC2: Get/Put/Delete só no prefixo `medico/`
#     (espelha o padrão do setup-diario-audio.sh; sem a IAM, o presign assina mas
#      o S3 devolve AccessDenied — foi o bug do áudio).
#
# NÃO há lifecycle de expiração: documentos de conta são permanentes (≠ áudio efêmero).
#
# Uso:
#   export EC2_ROLE_NAME="EC2-SSM-CerebroAmigo"   # nome real da role da instância
#   export AWS_PROFILE="seu-perfil"               # ou IAM role/SSO
#   bash infra/aws/setup-medico-docs.sh
# =============================================================================
set -euo pipefail

BUCKET="${S3_BUCKET_MEDICO_DOCS:-cerebro-amigo-medico-docs}"
REGION="${AWS_REGION:-sa-east-1}"
POLICY_NAME="CerebroAmigoMedicoDocsS3"

: "${EC2_ROLE_NAME:?ERRO: exporte EC2_ROLE_NAME (nome da IAM role da EC2)}"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
echo "Conta AWS: $ACCOUNT_ID | Região: $REGION | Bucket: $BUCKET"

# ─── 1. Bucket ────────────────────────────────────────────────────────────────
echo ""; echo "==> [1/4] S3 bucket: $BUCKET"
if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "    Bucket já existe — pulando criação."
else
  aws s3 mb "s3://$BUCKET" --region "$REGION"
  echo "    Bucket criado."
fi

# ─── 2. Block public access (todos os 4 flags) ───────────────────────────────
echo ""; echo "==> [2/4] Public Access Block"
aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
echo "    Acesso público bloqueado (4/4)."

# ─── 3. Criptografia default (SSE-S3) ────────────────────────────────────────
echo ""; echo "==> [3/4] Default encryption (AES256)"
aws s3api put-bucket-encryption --bucket "$BUCKET" \
  --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'
echo "    SSE-S3 default aplicada."

# ─── 4. IAM inline policy na role do EC2 (só prefixo medico/) ─────────────────
echo ""; echo "==> [4/4] IAM inline policy '$POLICY_NAME' na role $EC2_ROLE_NAME"
POLICY_JSON="$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "MedicoDocsObjects",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::$BUCKET/medico/*"
    },
    {
      "Sid": "MedicoDocsList",
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::$BUCKET",
      "Condition": { "StringLike": { "s3:prefix": ["medico/*"] } }
    }
  ]
}
JSON
)"
aws iam put-role-policy --role-name "$EC2_ROLE_NAME" \
  --policy-name "$POLICY_NAME" --policy-document "$POLICY_JSON"
echo "    Inline policy aplicada (Get/Put/Delete em medico/*)."

echo ""
echo "============================================================"
echo " Bucket de documentos do médico — pronto e PRIVADO."
echo " Bucket : s3://$BUCKET ($REGION, sem acesso público, SSE-S3)"
echo " IAM    : inline '$POLICY_NAME' na role $EC2_ROLE_NAME (medico/*)"
echo " Env    : confira S3_BUCKET_MEDICO_DOCS=$BUCKET no .env do box"
echo "============================================================"
