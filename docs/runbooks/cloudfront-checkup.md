# Runbook — CloudFront para checkup.cerebroamigo.com.br

**ADR-047** · Reduz LCP de ~3 s → ~1 s com edge cache no PoP de São Paulo.

> **Origem é o ALB do checkup** (ADR-045, já em produção) — não mais o Caddy do
> box clínico. O `infra/aws/cloudfront-checkup.yaml` já reflete isso
> (`OriginDomain` = DNS do ALB, `OriginProtocol=http-only`), e o enforcement do
> segredo de origem é uma **listener rule do ALB** (em
> `infra/aws/checkup-asg-alb.yaml`, parâmetro `CfOriginSecret`) — não o Caddy.

> ⚠️ **PENDÊNCIA IAM (invalidação no CI):** o passo "Invalidar cache CF" do
> `deploy.yml` precisa, no user `cerebro-github-actions`, de
> `ssm:GetParameter` em `/cerebro-amigo/checkup/cf-distribution-id` **OU** de
> `cloudfront:ListDistributions` (fallback por alias), além de
> `cloudfront:CreateInvalidation`. Sem isso, o CloudFront pode servir
> HTML/chunks de um build anterior após cada deploy do checkup. Conceder uma das
> duas opções resolve. Remover este aviso quando o job ficar verde.

## Visão geral

```text
Usuário BR
    │  HTTPS
    ▼
CloudFront (edge SP)
    │  HTTP:80 + header X-CF-Origin-Secret
    ▼
ALB cerebro-checkup-alb
    │  listener :80, rule priority 1: header confere -> forward; senão -> 301 HTTPS
    ▼
Target Group -> instâncias t3.small (Next.js checkup :3001)
```

DNS: zona na **Vercel**. Hoje `checkup` resolve pro **DNS do ALB** (CNAME); o
cutover troca pro domínio do CloudFront.
ACM: o cert do CloudFront deve estar em **us-east-1** (exigência CF), independente
da região do resto da infra. (O cert do ALB segue no ACM `sa-east-1`.)

---

## Fase 0 — Pré-requisitos

- [ ] AWS CLI com permissões CloudFront + ACM + CloudFormation + SSM
- [ ] Acesso ao painel Vercel DNS (para alterar CNAME)
- [ ] ALB do checkup no ar (ADR-045) e `checkup.cerebroamigo.com.br` resolvendo pra ele

---

## Fase 1 — Criar cert ACM em us-east-1

> CloudFront exige cert em us-east-1.

```bash
aws acm request-certificate \
  --region us-east-1 \
  --domain-name checkup.cerebroamigo.com.br \
  --validation-method DNS \
  --query CertificateArn --output text
```

Pega o CNAME de validação:

```bash
aws acm describe-certificate \
  --region us-east-1 \
  --certificate-arn <ARN> \
  --query 'Certificate.DomainValidationOptions[0].ResourceRecord'
```

Adiciona esse CNAME na **Vercel DNS** (Domains → cerebroamigo.com.br → Add Record:
Type `CNAME`, Name `_abc123.checkup`, Value `_xyz789.acm-validations.aws.`).
Aguarda `ISSUED`:

```bash
watch -n 30 "aws acm describe-certificate --region us-east-1 \
  --certificate-arn <ARN> --query 'Certificate.Status' --output text"
```

---

## Fase 2 — Secret de origem (SSM) + listener rule no ALB

O segredo impede acesso direto ao ALB bypassando o CloudFront. Quem valida é a
**listener rule do ALB** (não o Caddy).

```bash
# 1) Gera o secret e grava no SSM
SECRET=$(openssl rand -hex 32)
aws ssm put-parameter --region sa-east-1 \
  --name /cerebro-amigo/checkup/cf-origin-secret \
  --value "$SECRET" --type SecureString --overwrite
echo "Secret gravado no SSM (/cerebro-amigo/checkup/cf-origin-secret)."
```

```bash
# 2) Atualiza o stack do ALB/ASG passando o secret -> cria a rule do header
#    (os demais parâmetros usam os valores atuais; CfOriginSecret vazio = sem rule)
aws cloudformation deploy --region sa-east-1 \
  --stack-name <stack-do-asg-alb> \
  --template-file infra/aws/checkup-asg-alb.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    AcmCertificateArn=<ARN_ACM_SA_EAST_1_DO_ALB> \
    CfOriginSecret="$SECRET" \
  --no-fail-on-empty-changeset
```

> Heads-up: re-deploy do stack reseta `DesiredCapacity` pro `MinSize` (hoje 2) —
> comportamento esperado; o target-tracking sobe de novo se a CPU pedir.

---

## Fase 3 — Deploy do stack CloudFront (us-east-1)

```bash
SECRET=$(aws ssm get-parameter --region sa-east-1 \
  --name /cerebro-amigo/checkup/cf-origin-secret --with-decryption \
  --query Parameter.Value --output text)

aws cloudformation deploy \
  --region us-east-1 \
  --stack-name cerebro-checkup-cf \
  --template-file infra/aws/cloudfront-checkup.yaml \
  --parameter-overrides \
    AcmCertificateArn=<ARN_DA_FASE_1> \
    OriginSecret="$SECRET" \
  --capabilities CAPABILITY_IAM \
  --no-fail-on-empty-changeset
```

> `OriginDomain` já tem default = DNS do ALB; só passe se for diferente.
> Deploy leva ~10 min (CloudFront propaga globalmente).

Pega o domínio CF e salva o Distribution ID no SSM (pro CI invalidar):

```bash
aws cloudformation describe-stacks --region us-east-1 \
  --stack-name cerebro-checkup-cf \
  --query 'Stacks[0].Outputs[?OutputKey==`DistributionDomain`].OutputValue' --output text

DIST_ID=$(aws cloudformation describe-stacks --region us-east-1 \
  --stack-name cerebro-checkup-cf \
  --query 'Stacks[0].Outputs[?OutputKey==`DistributionId`].OutputValue' --output text)
aws ssm put-parameter --region sa-east-1 \
  --name /cerebro-amigo/checkup/cf-distribution-id \
  --value "$DIST_ID" --type String --overwrite
```

---

## Fase 4 — Smoke no domínio CF (antes de mudar o DNS)

```bash
CF_DOMAIN="d1abcdefg.cloudfront.net"  # substituir pelo real

curl -sv -H "Host: checkup.cerebroamigo.com.br" "https://$CF_DOMAIN/" 2>&1 | grep -E "< HTTP|x-cache|server"
curl -sv -H "Host: checkup.cerebroamigo.com.br" "https://$CF_DOMAIN/depressao" 2>&1 | grep -E "< HTTP|x-cache"
curl -sv -H "Host: checkup.cerebroamigo.com.br" "https://$CF_DOMAIN/api/health" 2>&1 | grep -E "< HTTP"

# Cache nas landings: 1º hit Miss, 2º hit Hit
curl -I -H "Host: checkup.cerebroamigo.com.br" "https://$CF_DOMAIN/depressao" | grep -i "x-cache\|age\|cache-control"
```

Se o `/api/health` der erro, confira a **listener rule** do ALB (Fase 2): sem ela,
o CloudFront recebe 301 do :80 e o smoke quebra.

---

## Fase 5 — Cutover DNS (ALB → CloudFront)

Na Vercel DNS (zona cerebroamigo.com.br):

1. **Reduz TTL** do registro `checkup` para 60s. Aguarda o TTL antigo propagar (~5 min).
2. **Troca o CNAME** `checkup`: de `<DNS do ALB>` para `<domínio CloudFront>`.
   (Se hoje for um registro A/ALIAS, troque por CNAME apontando ao domínio CF.)
3. Aguarda ~2 min.
4. `curl -I https://checkup.cerebroamigo.com.br/depressao` — confirma `x-cache: Hit from cloudfront`.

---

## Fase 6 — Smoke final

```bash
for path in / /depressao /ansiedade /tdah-adulto /medico; do
  status=$(curl -s -o /dev/null -w "%{http_code}" "https://checkup.cerebroamigo.com.br$path")
  echo "$path → $status"
done

curl -s https://checkup.cerebroamigo.com.br/api/health | python3 -m json.tool

# /crise não deve cachear (conteúdo sensível)
curl -I https://checkup.cerebroamigo.com.br/crise | grep -i "cache-control\|x-cache"
# Esperado: x-cache: Miss from cloudfront (CachingDisabled)
```

---

## Invalidar cache (após cada deploy do checkup)

Passo do job `deploy-checkup` (ver pendência IAM no topo):

```bash
DIST_ID=$(aws ssm get-parameter --region sa-east-1 \
  --name /cerebro-amigo/checkup/cf-distribution-id \
  --query Parameter.Value --output text)
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*"
```

---

## Rollback

DNS volta ao ALB em < 2 min: na Vercel, CNAME `checkup` de volta pro **DNS do ALB**.
O stack CF pode ficar **Disabled** (não deletar — evita recriar o cert).

```bash
# CloudFront console: Distribution → Disable  (ou stack update com Enabled: false)
```

---

## Endurecimento pós-cutover (recomendado, NÃO durante o cutover)

Depois do cutover estável, o listener **:443** do ALB ainda aceita acesso direto
(forward sem header) — bypass do CloudFront p/ quem souber o DNS do ALB. **Forma
recomendada de fechar:** restringir o ingress do SG do ALB (portas 80 e 443) à
**managed prefix list do CloudFront** (`com.amazonaws.global.cloudfront.origin-facing`),
em vez de `0.0.0.0/0` — bloqueia qualquer acesso que não venha do CloudFront, em todas
as portas, sem mexer em listener. (Alternativa: rule de header no :443 **+** trocar o
*default action* do :443 para `fixed-response 403` — só a rule não basta, pois o default
continua dando forward.) **Não fazer durante o cutover** (risco de lockout enquanto o DNS
ainda aponta direto pro ALB).
