#!/usr/bin/env bash
# setup-ecr.sh — Cria os 6 repositórios ECR e configura lifecycle policies.
#
# Executar UMA VEZ antes do primeiro deploy ECR-based.
# Pré-requisitos:
#   - AWS CLI configurado (aws configure ou env vars)
#   - Permissões: ecr:CreateRepository, ecr:PutLifecyclePolicy,
#                 iam:AttachRolePolicy (para step de IAM abaixo)
#
# Uso:
#   EC2_ROLE_NAME=cerebro-amigo-ec2-role bash infra/aws/setup-ecr.sh

set -euo pipefail

AWS_REGION="sa-east-1"
AWS_ACCOUNT_ID="004177894935"
ECR_BASE="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
EC2_ROLE_NAME="${EC2_ROLE_NAME:-EC2-SSM-CerebroAmigo}"
CI_POLICY_NAME="${CI_POLICY_NAME:-CerebroAmigoGitHubDeploy}"

SERVICES=(
  "cerebro-amigo/web"
  "cerebro-amigo/api-gateway"
  "cerebro-amigo/api-gateway-scala"
  "cerebro-amigo/orchestrator-py"
  "cerebro-amigo/agents-py"
  "cerebro-amigo/notifier-py"
)

# Lifecycle policy: manter as 10 imagens mais recentes, expirar o resto.
# NOTA: `tagPrefixList: [""]` é INVÁLIDO no ECR (string vazia rejeitada). Para
# "manter as N mais recentes independente de tag" use `tagStatus: any`.
LIFECYCLE_POLICY='{
  "rules": [
    {
      "rulePriority": 1,
      "description": "Manter ultimas 10 imagens (rollback ate 10 deploys)",
      "selection": {
        "tagStatus": "any",
        "countType": "imageCountMoreThan",
        "countNumber": 10
      },
      "action": { "type": "expire" }
    }
  ]
}'

echo "=== Criando repositórios ECR em ${AWS_REGION} ==="

for repo in "${SERVICES[@]}"; do
  echo -n "  $repo ... "
  if aws ecr describe-repositories \
      --repository-names "$repo" \
      --region "$AWS_REGION" \
      --output text 2>/dev/null | grep -q "$repo"; then
    echo "já existe"
  else
    aws ecr create-repository \
      --repository-name "$repo" \
      --region "$AWS_REGION" \
      --image-scanning-configuration scanOnPush=true \
      --encryption-configuration encryptionType=AES256 \
      --output text > /dev/null
    echo "criado"
  fi

  aws ecr put-lifecycle-policy \
    --repository-name "$repo" \
    --region "$AWS_REGION" \
    --lifecycle-policy-text "$LIFECYCLE_POLICY" \
    --output text > /dev/null
  echo "    lifecycle policy aplicada"
done

# Repos fora do array SERVICES que também precisam de lifecycle.
# - cerebro-amigo/checkup: criado pelo setup do ASG do checkup (decoupled, ADR-045),
#   não por este script. Sem lifecycle acumulava 100+ imagens. Só aplica a policy
#   (NÃO cria o repo aqui).
# Legados V2 (cerebro/api-gateway, cerebro/orchestrator) NÃO entram: são candidatos
# a remoção, não a manter. Ver docs/runbooks/ec2-disk-hygiene.md.
EXTRA_LIFECYCLE_REPOS=(
  "cerebro-amigo/checkup"
)
for repo in "${EXTRA_LIFECYCLE_REPOS[@]}"; do
  if aws ecr describe-repositories --repository-names "$repo" --region "$AWS_REGION" \
      --output text >/dev/null 2>&1; then
    aws ecr put-lifecycle-policy \
      --repository-name "$repo" \
      --region "$AWS_REGION" \
      --lifecycle-policy-text "$LIFECYCLE_POLICY" \
      --output text > /dev/null
    echo "  $repo → lifecycle keep-last-10 aplicada (repo pré-existente)"
  else
    echo "  $repo → não existe ainda, pulando (criado pelo setup do ASG do checkup)"
  fi
done

echo ""
echo "=== Configurando permissões ECR pull na IAM role da EC2 ==="
echo "  Role: $EC2_ROLE_NAME"

# Política de pull para a EC2 (somente leitura — não precisa de push)
ECR_PULL_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ECRPull",
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage"
      ],
      "Resource": "*"
    }
  ]
}
EOF
)

POLICY_NAME="CerebroAmigoECRPull"
POLICY_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:policy/${POLICY_NAME}"

# Cria ou atualiza a policy
if aws iam get-policy --policy-arn "$POLICY_ARN" 2>/dev/null | grep -q "$POLICY_NAME"; then
  echo "  Policy $POLICY_NAME já existe — verificar se está attachada ao role"
else
  aws iam create-policy \
    --policy-name "$POLICY_NAME" \
    --policy-document "$ECR_PULL_POLICY" \
    --output text > /dev/null
  echo "  Policy $POLICY_NAME criada"
fi

aws iam attach-role-policy \
  --role-name "$EC2_ROLE_NAME" \
  --policy-arn "$POLICY_ARN" 2>/dev/null || true
echo "  Policy attachada ao role $EC2_ROLE_NAME"

echo ""
echo "=== Concedendo ECR push ao CI (policy ${CI_POLICY_NAME}) ==="
# Antes só imprimia as permissões — agora aplica de fato (nova versão default
# da managed policy do usuário do CI). Sem isso o `docker push` no build falha
# com 'not authorized to perform: ecr:GetAuthorizationToken'.
CI_POLICY_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:policy/${CI_POLICY_NAME}"
if aws iam get-policy --policy-arn "$CI_POLICY_ARN" >/dev/null 2>&1; then
  TMP_CI=$(mktemp)
  # Preserva os statements existentes (SSM) e adiciona ECR auth + push.
  CUR_VER=$(aws iam get-policy --policy-arn "$CI_POLICY_ARN" --query 'Policy.DefaultVersionId' --output text)
  aws iam get-policy-version --policy-arn "$CI_POLICY_ARN" --version-id "$CUR_VER" \
    --query 'PolicyVersion.Document' --output json > "$TMP_CI"
  if grep -q '"ecr:GetAuthorizationToken"' "$TMP_CI"; then
    echo "  ECR já presente na policy do CI — nada a fazer"
  else
    python3 - "$TMP_CI" "$AWS_ACCOUNT_ID" <<'PY'
import json, sys
doc_path, acct = sys.argv[1], sys.argv[2]
doc = json.load(open(doc_path))
doc["Statement"] += [
    {"Sid": "ECRAuth", "Effect": "Allow",
     "Action": "ecr:GetAuthorizationToken", "Resource": "*"},
    {"Sid": "ECRPush", "Effect": "Allow",
     "Action": ["ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer",
                "ecr:BatchGetImage", "ecr:PutImage", "ecr:InitiateLayerUpload",
                "ecr:UploadLayerPart", "ecr:CompleteLayerUpload"],
     "Resource": f"arn:aws:ecr:sa-east-1:{acct}:repository/cerebro-amigo/*"},
]
json.dump(doc, open(doc_path, "w"))
PY
    aws iam create-policy-version --policy-arn "$CI_POLICY_ARN" \
      --policy-document "file://$TMP_CI" --set-as-default --output text > /dev/null
    echo "  ECR push concedido ao CI (nova versão default de ${CI_POLICY_NAME})"
  fi
  rm -f "$TMP_CI"
else
  echo "  AVISO: policy ${CI_POLICY_NAME} não encontrada — pulando (CI pode falhar no push)"
fi

echo ""
echo "=== Smoke test: login no ECR ==="
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ECR_BASE" \
  && echo "  Login ECR OK" \
  || echo "  AVISO: login ECR falhou — verificar credenciais/role"

echo ""
echo "=== Setup concluído ==="
echo ""
echo "URLs dos repositórios:"
for repo in "${SERVICES[@]}"; do
  svc="${repo#cerebro-amigo/}"
  echo "  $svc  →  ${ECR_BASE}/${repo}"
done
echo ""
echo "Próximo passo: faça um push na branch main para acionar o primeiro deploy."
echo ""
echo "─── ROLLBACK ───────────────────────────────────────────────────────────"
echo ""
echo "Para reverter para um SHA anterior:"
echo ""
echo "  1. Conecte na EC2 via SSM ou Session Manager"
echo "  2. Execute:"
echo ""
echo "     export IMAGE_TAG=<sha-anterior>"
echo "     aws ecr get-login-password --region sa-east-1 \\"
echo "       | docker login --username AWS --password-stdin ${ECR_BASE}"
echo "     cd /opt/cerebro-amigo-v3"
echo "     git checkout <sha-anterior> -- docker-compose.yml"
echo "     docker compose pull"
echo "     docker compose up -d --remove-orphans"
echo ""
echo "  Os SHAs disponíveis ficam nas tags do ECR:"
echo "     aws ecr list-images --repository-name cerebro-amigo/orchestrator-py --region sa-east-1"
echo ""
