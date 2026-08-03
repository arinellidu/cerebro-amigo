#!/usr/bin/env bash
# =============================================================================
# setup-audio-msgs.sh — bucket PRIVADO p/ mensagens de áudio paciente→médico (ADR-064).
#
# Guarda áudio clínico (recado do paciente p/ a psiquiatra). Provisiona:
#   - bucket S3 privado (4 flags de public-access-block)
#   - criptografia default (SSE-S3 / AES256 + bucket key)
#   - lifecycle 60 dias (Expiration) — retenção curta, espelha expira_em no DB
#   - IAM INLINE policy na role do EC2: Get/Put/Delete só no prefixo `audio/`
#     (keys são `audio/{paciente_id}/{uuid}.webm`)
#
# POR QUE existe: o gateway assina presigned PUT/GET, mas SEM a IAM o S3 devolve
# AccessDenied no upload — e SEM o bucket devolve NoSuchBucket. Em ambos os casos
# o portal do paciente cai no catch e mostra "Não consegui enviar", a linha nunca
# entra em mensagens_audio, e a aba "Áudios" do médico fica vazia. Mesmo bug que
# afetou o Diário de Voz (ver setup-diario-audio.sh) e os docs do médico.
#
# NÃO roda a migration 0050: a tabela mensagens_audio já existe em prod e o
# CREATE TABLE não é idempotente (abortaria). Se for box novo, aplique
# infra/migrations/0050_mensagens_audio.sql antes (manual).
#
# Uso:
#   export EC2_ROLE_NAME="EC2-SSM-CerebroAmigo"   # nome real da role da instância
#   export AWS_PROFILE="seu-perfil"               # ou IAM role/SSO
#   bash infra/aws/setup-audio-msgs.sh
# =============================================================================
set -euo pipefail

BUCKET="${S3_BUCKET_AUDIO_MSGS:-cerebro-amigo-audio-msgs}"
REGION="${AWS_REGION:-sa-east-1}"
POLICY_NAME="CerebroAmigoAudioMsgsS3"

: "${EC2_ROLE_NAME:?ERRO: exporte EC2_ROLE_NAME (nome da IAM role da EC2)}"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
echo "Conta AWS: $ACCOUNT_ID | Região: $REGION | Bucket: $BUCKET"

# ─── 1. Bucket ────────────────────────────────────────────────────────────────
echo ""; echo "==> [1/5] S3 bucket: $BUCKET"
if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "    Bucket já existe — pulando criação."
else
  aws s3 mb "s3://$BUCKET" --region "$REGION"
  echo "    Bucket criado."
fi

# ─── 2. Block public access (todos os 4 flags) ───────────────────────────────
echo ""; echo "==> [2/5] Public Access Block"
aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
echo "    Acesso público bloqueado (4/4)."

# ─── 3. Criptografia default (SSE-S3) ────────────────────────────────────────
echo ""; echo "==> [3/5] Default encryption (AES256)"
aws s3api put-bucket-encryption --bucket "$BUCKET" \
  --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'
echo "    SSE-S3 default aplicada."

# ─── 4. Lifecycle: expira objetos audio/ após 60 dias ────────────────────────
echo ""; echo "==> [4/5] Lifecycle (Expiration 60d em audio/*)"
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" \
  --lifecycle-configuration '{
    "Rules": [
      {
        "ID": "expira-audio-60d",
        "Status": "Enabled",
        "Filter": { "Prefix": "audio/" },
        "Expiration": { "Days": 60 },
        "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 1 }
      }
    ]
  }'
echo "    Lifecycle aplicada (audio/* → expira em 60d; espelha expira_em do DB)."

# ─── 5. IAM inline policy na role do EC2 (só prefixo audio/) ──────────────────
echo ""; echo "==> [5/5] IAM inline policy '$POLICY_NAME' na role $EC2_ROLE_NAME"
POLICY_JSON="$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AudioMsgsObjects",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::$BUCKET/audio/*"
    }
  ]
}
JSON
)"
aws iam put-role-policy --role-name "$EC2_ROLE_NAME" \
  --policy-name "$POLICY_NAME" --policy-document "$POLICY_JSON"
echo "    Inline policy aplicada (Get/Put/Delete em audio/*)."

echo ""
echo "============================================================"
echo " Mensagens de áudio (ADR-064) — bucket pronto e PRIVADO."
echo " Bucket : s3://$BUCKET ($REGION, sem acesso público, SSE-S3, lifecycle 60d)"
echo " IAM    : inline '$POLICY_NAME' na role $EC2_ROLE_NAME (audio/*)"
echo ""
echo " AÇÕES MANUAIS PENDENTES:"
echo "   1. Adicione no .env do box:  S3_BUCKET_AUDIO_MSGS=$BUCKET"
echo "   2. Reinicie o gateway:       docker compose up -d --force-recreate api-gateway"
echo "   3. Confirme a migration 0050 (tabela mensagens_audio) já aplicada no RDS."
echo "============================================================"
