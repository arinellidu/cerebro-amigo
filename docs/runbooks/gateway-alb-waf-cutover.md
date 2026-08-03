# Runbook — Fronting do api-gateway com ALB + WAF (ADR-074 §2)

**Objetivo:** pôr um ALB regional + AWS WAF na frente do `api-gateway` (.NET, box clínico
`i-057860cd97edafefb`), que hoje é servido **direto pelo EIP** `18.229.175.231` (sem ALB).
WAF v2 só anexa a ALB/CloudFront — por isso o ALB. Escolhido ALB (não CloudFront) porque o
gateway faz **SSE** (conversa paciente↔IA, sinalização de teleconsulta) e precisa de
`idle_timeout` longo (300s); CloudFront teria teto de origem ~60s e quebraria os gaps.

Template: `infra/aws/gateway-alb-waf.yaml`. **Reversível por DNS.**

> ⚠️ **Defense-in-depth, não bloqueador.** O gateway já exige `X-Edge-Auth` (ADR-074 — randoms
> levam 403 barato) e tem `login_rate_limits` (Postgres, migration 0043). Este fronting é camada
> extra. Não há urgência de outage; faça em janela tranquila.

> ⚠️ **Auto mode bloqueia mutação prod** (CF apply / DNS). Rode os comandos abaixo você mesmo
> (prefixo `!` na sessão, ou fora do auto mode).

---

## Pré-requisitos (bloqueadores)

### 1. Cert ACM para `api.cerebroamigo.com.br` (não existe ainda)
Só há cert de `checkup.*` e `www.*`. Provisione (sa-east-1, validação DNS):

```bash
aws acm request-certificate --region sa-east-1 \
  --domain-name api.cerebroamigo.com.br \
  --validation-method DNS \
  --query CertificateArn --output text
```

Pegue o registro CNAME de validação e **adicione na zona DNS (na Vercel, ADR-073)** —
⚠️ a zona DNS está na Vercel; quem tem acesso de escrita é o Patrick (a Rafaela não lê a zona).

```bash
aws acm describe-certificate --region sa-east-1 --certificate-arn <ARN> \
  --query 'Certificate.DomainValidationOptions[0].ResourceRecord' --output json
```

Aguarde `Status=ISSUED` antes de seguir.

---

## Deploy (change-set → review → execute)

```bash
# 1. change-set (NÃO aplica)
aws cloudformation create-change-set --region sa-east-1 \
  --stack-name cerebro-gateway-alb-waf --change-set-type CREATE \
  --change-set-name gateway-alb-waf-v1 \
  --template-body file://infra/aws/gateway-alb-waf.yaml \
  --parameters ParameterKey=AcmCertificateArn,ParameterValue=<ARN_DO_CERT_API>

aws cloudformation wait change-set-create-complete --region sa-east-1 \
  --stack-name cerebro-gateway-alb-waf --change-set-name gateway-alb-waf-v1

# 2. revisar
aws cloudformation describe-change-set --region sa-east-1 \
  --stack-name cerebro-gateway-alb-waf --change-set-name gateway-alb-waf-v1 \
  --query 'Changes[].ResourceChange.{Action:Action,Type:ResourceType,Id:LogicalResourceId}' --output table

# 3. executar
aws cloudformation execute-change-set --region sa-east-1 \
  --stack-name cerebro-gateway-alb-waf --change-set-name gateway-alb-waf-v1
aws cloudformation wait stack-create-complete --region sa-east-1 --stack-name cerebro-gateway-alb-waf
```

Pega o DNS do ALB:
```bash
aws cloudformation describe-stacks --region sa-east-1 --stack-name cerebro-gateway-alb-waf \
  --query "Stacks[0].Outputs" --output table
```

---

## Validação ANTES do cutover de DNS (testar pelo ALB direto)

`api.*` ainda aponta pro EIP — teste o ALB pelo DNS dele (`Host:` forçado):

```bash
ALB=<AlbDnsName do output>
# health (exento X-Edge-Auth) -> 200
curl -ks -o /dev/null -w 'health=%{http_code}\n' -H 'Host: api.cerebroamigo.com.br' "https://$ALB/health"
# target saudável?
aws elbv2 describe-target-health --region sa-east-1 \
  --target-group-arn $(aws elbv2 describe-target-groups --region sa-east-1 --names cerebro-gateway-tg --query 'TargetGroups[0].TargetGroupArn' --output text) \
  --query 'TargetHealthDescriptions[].TargetHealth.State' --output text
```

🔴 **Teste SSE crítico** (a razão de ser ALB e não CloudFront): exercite a conversa
paciente↔IA por mais de 60s de gap e confirme que o stream **não corta** pelo ALB
(`idle_timeout 300`). Sem isso, não vire o DNS.

WAF em **count** (default): nenhum bloqueio ainda; só métrica. Confira sampled requests:
```bash
aws cloudwatch get-metric-statistics --region sa-east-1 --namespace AWS/WAFV2 \
  --metric-name CountedRequests --start-time <...> --end-time <...> --period 3600 --statistics Sum \
  --dimensions Name=WebACL,Value=cerebro-gateway-waf Name=Rule,Value=aws-common Name=Region,Value=sa-east-1
```

---

## Cutover de DNS (reversível)

Na zona DNS (Vercel): apontar `api.cerebroamigo.com.br` → `<AlbDnsName>` (CNAME), **TTL baixo (60s)**.

Pós-propagação, valide pelo nome real:
```bash
curl -s -o /dev/null -w 'me_no_header=%{http_code} (esperado 403)\n' https://api.cerebroamigo.com.br/api/v1/me
curl -s -o /dev/null -w 'health=%{http_code} (esperado 200)\n' https://api.cerebroamigo.com.br/health
```
+ smoke do dashboard/portal (BFF→gateway via ALB) e **da conversa SSE**.

**Rollback:** reverter o CNAME `api.*` de volta pro EIP `18.229.175.231`. TTL 60s = ~1min.

---

## Hardening pós-cutover

1. **Fechar o bypass do WAF.** Enquanto `:443`/`:5050` do box aceitarem direto da internet,
   dá pra furar o WAF batendo no EIP. O `X-Edge-Auth` já barra (403) o que não é origem, mas
   p/ valer o WAF: restringir o `:443` do host (Caddy) e garantir que `:5050` só aceite do
   `AlbSg` (o stack já adiciona esse ingress; revisar se há regra ampla pré-existente no
   `cerebro-app-sg` que abra 5050/443 ao mundo).
2. **Flip do WAF p/ block.** Após 1–2 semanas observando `count` sem falso-positivo em payload
   clínico, atualizar o stack com `ManagedRulesAction=block` (rate-based já é block):
   ```bash
   aws cloudformation update-stack --region sa-east-1 --stack-name cerebro-gateway-alb-waf \
     --use-previous-template \
     --parameters ParameterKey=AcmCertificateArn,UsePreviousValue=true \
                  ParameterKey=ManagedRulesAction,ParameterValue=block
   ```
3. **Observabilidade.** Adicionar o ALB do gateway ao `uptime-piloto.yaml` e alarmes 5xx/WAF
   blocked ao `observability-piloto.yaml`.
4. **ADR.** Registrar addendum no ADR-074 (ou ADR próprio): fronting do gateway concretiza a
   cláusula §2; documentar a escolha ALB-sobre-CloudFront pelo SSE.
