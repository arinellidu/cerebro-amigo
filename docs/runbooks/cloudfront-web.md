# Runbook — CloudFront na frente do web (www.cerebroamigo.com.br)

IaC: `infra/aws/cloudfront-web.yaml`. **Opcional e gated** — leia antes de deployar.

## Vale a pena? (decisão antes de tudo)

Público é BR e o origin já está em `sa-east-1`. Ganho do CF para BR-only é **modesto**
(edge GRU + HTTP/3 + brotli + cache de estático) e **adiciona custo** (crédito AWS
secou — ver [[project-aws-credit-masking]]). Só compensa com tráfego não-BR ou após
mover a zona DNS para o Route53. O site já está rápido (sem cold start, `/_next/image`
WebP). **Default: não fazer agora.** Este runbook existe para quando/se valer.

## Diferença crítica vs checkup (ADR-047)

O web tem **auth (cookies), BFF `/api/*`, SSE e Server Actions (POST)**. Por isso o
`DefaultCacheBehavior` é **pass-through sem cache** (CachingDisabled + AllViewer); só
`/_next/static`, `/_next/image` e estáticos são cacheados. Não copiar o default
cacheado do checkup.

## ⚠️ Bloqueador técnico: SSE

ALB tem `idle_timeout=300s` de propósito (conversa paciente↔IA fica >60s sem byte com
o LLM "pensando"). CloudFront limita `OriginReadTimeout` a **60s** sem aumento de cota
(máx 180s via support). SSE além do timeout → CF derruba → **conversa e teleconsulta
quebram**. **Validar conversa + teleconsulta atrás do CF ANTES de virar o DNS.** Se
quebrar: pedir cota `OriginReadTimeout=180s`, ou servir SSE por hostname separado
direto no ALB (muda o client), ou não cutover.

## Gates (todos passam pelo Patrick / DNS)

1. **Cert ACM em us-east-1** cobrindo `www` (o do ALB é sa-east-1, não serve p/ CF).
   Validação = CNAME na zona Vercel (Patrick).
2. **Origin secret** no stack `cerebro-web` + mesmo valor no CF (protege o origin de
   acesso direto, bypassando o CF).
3. **DNS**: `www` CNAME → domínio do CF (hoje aponta ALB direto). Zona do Patrick.

## Procedimento (admin = `adonaiarinelli`; CI não tem IAM de cloudfront)

```bash
# 1) Cert us-east-1 (Patrick valida o CNAME)
ARN_CF=$(aws acm request-certificate --region us-east-1 \
  --domain-name www.cerebroamigo.com.br --validation-method DNS \
  --query CertificateArn --output text)
aws acm describe-certificate --region us-east-1 --certificate-arn "$ARN_CF" \
  --query 'Certificate.DomainValidationOptions[].ResourceRecord'   # -> Patrick cria o CNAME
aws acm wait certificate-validated --region us-east-1 --certificate-arn "$ARN_CF"

# 2) Origin secret: gera, guarda em SSM (sa-east-1) e seta no stack do ALB
SECRET=$(openssl rand -hex 24)
aws ssm put-parameter --region sa-east-1 --name /cerebro-amigo/web/cf-origin-secret \
  --type SecureString --overwrite --value "$SECRET"
# liga a CfOriginHeaderRule no ALB (cf deploy MANUAL — imagem ja viva, sem outage):
ACM_ALB=$(aws ssm get-parameter --region sa-east-1 --name /cerebro-amigo/web/acm-cert-arn --query Parameter.Value --output text)
aws cloudformation deploy --region sa-east-1 --template-file infra/aws/web-asg-alb.yaml \
  --stack-name cerebro-web --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides AcmCertificateArn="$ACM_ALB" CfOriginSecret="$SECRET"

# 3) Deploy da distribuicao CF (regiao us-east-1 por convencao; CF e global)
aws cloudformation deploy --region us-east-1 --template-file infra/aws/cloudfront-web.yaml \
  --stack-name cerebro-web-cdn \
  --parameter-overrides AcmCertificateArn="$ARN_CF" OriginSecret="$SECRET"
CF_DOMAIN=$(aws cloudformation describe-stacks --region us-east-1 --stack-name cerebro-web-cdn \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionDomain'].OutputValue|[0]" --output text)
echo "CF domain = $CF_DOMAIN"

# 4) VALIDAR SSE atras do CF ANTES do DNS (usa o dominio do CF com Host header):
#    - app: curl -s -H "Host: www.cerebroamigo.com.br" https://$CF_DOMAIN/api/health -> 200
#    - conversa + teleconsulta: testar com sessao real (login) apontando o navegador/hosts
#      p/ $CF_DOMAIN; confirmar que o stream sobrevive a gaps >60s. Se quebrar -> NAO virar.

# 5) Cutover DNS (Patrick): www CNAME -> $CF_DOMAIN (em vez do ALB). apex segue Vercel.
```

## Deploy do web com CF na frente

`deploy.yml` (`deploy-web`) **não precisa de invalidação**: o default é no-cache e o
`/_next/static` é imutável (hash no nome). Logo um deploy novo serve assets novos sem
invalidar. (Se algum dia cachear HTML, aí sim adicionar `create-invalidation` ao job +
o grant IAM de `cloudfront:CreateInvalidation` no CI user — hoje ele não tem.)

## Rollback

`www` CNAME de volta para o ALB (`cerebro-web-alb-...elb.amazonaws.com`) — Patrick.
Ou `aws cloudfront update-distribution` desabilitando (`Enabled: false`). O ALB segue
servindo direto o tempo todo, então o rollback é só DNS.
