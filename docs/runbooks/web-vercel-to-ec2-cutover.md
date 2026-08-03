# Runbook — migrar o frontend web (apps/web) da Vercel para EC2 (ASG + ALB)

Tira o `apps/web` (dashboard médico + portal paciente /p/* + BFF) da Vercel e põe em
box próprio no EC2 sa-east-1, atrás de ALB + Auto Scaling Group. **Motivo:** cartão
atual não paga a Vercel + cold start serverless (/dashboard 624ms). Container
`node server.js` = processo sempre quente → mata o cold start.

Artefatos desta migração:
- `infra/aws/web-asg-alb.yaml` — CloudFormation do ALB+ASG (clone do checkup, ADR-045).
- `apps/web/Dockerfile` — patch dos `NEXT_PUBLIC_*` como build-arg (build-time).
- `.github/docker-bake.hcl` + `.github/workflows/deploy.yml` — build com os args + job `deploy-web`.
- `docs/runbooks/web-vercel-to-ec2-env.md` — mapeamento de env (ler junto).

**Princípio:** tudo é **aditivo** até a Fase 6. A Vercel continua servindo a produção
até o cutover de DNS. Rollback = devolver o DNS. Não há passo destrutivo antes da Fase 7.

> Ordem importa: o stack (Fase 3) tem que existir ANTES de mergear o CI (Fase 4),
> senão o job `deploy-web` falha com "ASG not found" — e os arquivos do CI estão no
> filtro `web`, então o próprio merge dispara o job.

---

## Fase 0 — Pré-requisitos (sem efeito em produção)

1. **GitHub Secrets** (repo → Settings → Secrets → Actions) — os 6 `NEXT_PUBLIC_*`,
   copiados do dashboard da Vercel. Sem eles a imagem builda, mas captcha (Turnstile)
   e Web Push saem vazios no bundle:
   ```
   NEXT_PUBLIC_TURNSTILE_SITE_KEY   NEXT_PUBLIC_VAPID_PUBLIC_KEY   NEXT_PUBLIC_HUB_URL
   NEXT_PUBLIC_MANUAL_PIX_CHAVE     NEXT_PUBLIC_MANUAL_PIX_NOME    NEXT_PUBLIC_MANUAL_PAGAMENTO_URL
   ```
2. Decidir parâmetros do stack: `MinSize` (1 barato / 2 HA), `ApiGatewayUrl`
   (público dia-1 / IP privado hardening), tipo (`t3.small`).

---

## Fase 1 — Cert ACM (www + apex), validação DNS na Vercel

ALB exige o cert na MESMA região (sa-east-1). Precisa do apex no SAN p/ o redirect apex→www.

```bash
ARN=$(aws acm request-certificate --region sa-east-1 \
  --domain-name www.cerebroamigo.com.br \
  --subject-alternative-names cerebroamigo.com.br \
  --validation-method DNS \
  --query CertificateArn --output text)
echo $ARN

# CNAMEs de validação (criar no DNS atual = Vercel):
aws acm describe-certificate --region sa-east-1 --certificate-arn "$ARN" \
  --query 'Certificate.DomainValidationOptions[].ResourceRecord' --output table

# após criar os CNAMEs, esperar ISSUED:
aws acm wait certificate-validated --region sa-east-1 --certificate-arn "$ARN"
```

---

## Fase 2 — Parâmetros SSM (segredos/config do BFF)

```bash
# SHA de uma imagem web que JÁ existe no ECR (build recente de main); só pra o ASG
# bootar algo. A imagem definitiva (com NEXT_PUBLIC) vem na Fase 4.
aws ssm put-parameter --region sa-east-1 --name /cerebro-amigo/web/image-tag \
  --type String --overwrite --value "<SHA-existente-no-ECR>"

# MESMO valor em toda instância do ASG (senão Server Action quebra entre instâncias).
# base64 32B = formato que o Next espera p/ NEXT_SERVER_ACTIONS_ENCRYPTION_KEY:
aws ssm put-parameter --region sa-east-1 --name /cerebro-amigo/web/server-actions-key \
  --type SecureString --overwrite --value "$(openssl rand -base64 32)"

# = INTERNAL_API_TOKEN do box clínico:
aws ssm put-parameter --region sa-east-1 --name /cerebro-amigo/web/internal-api-token \
  --type SecureString --overwrite --value "<INTERNAL_API_TOKEN>"

# = token de métricas do checkup (cockpit ADR-050):
aws ssm put-parameter --region sa-east-1 --name /cerebro-amigo/web/checkup-metrics-token \
  --type SecureString --overwrite --value "<CHECKUP_METRICS_TOKEN>"
```

---

## Fase 3 — Deploy do stack (aditivo; não toca a Vercel)

```bash
aws cloudformation deploy --region sa-east-1 \
  --template-file infra/aws/web-asg-alb.yaml \
  --stack-name cerebro-web --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides AcmCertificateArn="$ARN" WebImageTag="<SHA-existente-no-ECR>"
  # opcionais: MinSize=2  ApiGatewayUrl=http://<ip-priv-clinico>:5050

# pegar o ALB DNS (guardar p/ Fases 5 e 6) e o SG das instâncias:
aws cloudformation describe-stacks --region sa-east-1 --stack-name cerebro-web \
  --query "Stacks[0].Outputs" --output table
```

> Se usar `ApiGatewayUrl` privado: liberar o ingress 5050 no SG do box clínico a
> partir do `WebInstanceSgId` (output do stack) — passo manual de perímetro.

---

## Fase 4 — Mergear o CI (gera a imagem definitiva + popula o ASG)

Branch + PR com os 4 patches (Dockerfile, bake, deploy.yml — e o yaml/runbooks).
No merge em `main`: `build-clinical` builda a imagem web **com os NEXT_PUBLIC embutidos**,
e o job `deploy-web` faz `put-parameter image-tag=<novo SHA>` + instance refresh do
`cerebro-web-asg` (zero-downtime). Acompanhar o run até verde.

---

## Fase 5 — Validar ANTES de virar o DNS

```bash
ALB=<alb-dns-do-output>

# 1) targets healthy:
TG=$(aws elbv2 describe-target-groups --region sa-east-1 \
  --query "TargetGroups[?starts_with(TargetGroupName,'cerebro-web')].TargetGroupArn | [0]" --output text)
aws elbv2 describe-target-health --region sa-east-1 --target-group-arn "$TG" \
  --query 'TargetHealthDescriptions[].TargetHealth.State'   # esperado: ["healthy"]

# 2) bater no app pelo ALB fingindo o Host (sem mexer no DNS real):
IP=$(dig +short "$ALB" | head -1)
curl -sk --resolve www.cerebroamigo.com.br:443:$IP \
  https://www.cerebroamigo.com.br/ -o /dev/null -w "home: %{http_code}\n"
curl -sk --resolve www.cerebroamigo.com.br:443:$IP \
  https://www.cerebroamigo.com.br/login -o /dev/null -w "login: %{http_code}\n"

# 3) redirect apex→www:
curl -sk --resolve cerebroamigo.com.br:443:$IP \
  https://cerebroamigo.com.br/ -o /dev/null -w "apex: %{http_code} -> %{redirect_url}\n"  # 301 -> www

# 4) NEXT_PUBLIC embutido no bundle (não pode sair vazio):
curl -sk --resolve www.cerebroamigo.com.br:443:$IP https://www.cerebroamigo.com.br/medicos/cadastro \
  | grep -o 'NEXT_PUBLIC_TURNSTILE_SITE_KEY[^,]*' | head   # ou inspecionar o JS do Turnstile
```

Dentro de uma instância (Session Manager) se algo falhar:
```bash
aws ssm start-session --target <instance-id> --region sa-east-1
sudo docker logs --tail 50 web
curl -s localhost:3000 -o /dev/null -w "%{http_code}\n"
# BFF→gateway alcançável?
curl -s "$API_GATEWAY_URL/health" -o /dev/null -w "%{http_code}\n"
```

Só prossiga com tudo verde: targets healthy, home/login 200, apex 301, captcha/push presentes.

---

## Fase 6 — Cutover de DNS (externo, REVERSÍVEL)

**Gotcha:** apex (`cerebroamigo.com.br`) **não pode** ser CNAME pra ALB, e o ALB não
tem IP fixo (não dá A record). Cutover limpo = **mover a zona pro Route53** (ALIAS
nativo p/ ALB), o que também tira a dependência de DNS da Vercel (alinhado ao motivo
da migração).

**Antes (1h):** baixar o TTL dos registros www + apex na Vercel p/ 60s.

### Opção A (recomendada) — zona no Route53
```bash
# 1) criar hosted zone (se ainda não houver) e recriar os registros atuais.
# 2) apex ALIAS A → ALB; www ALIAS A → ALB (ALIAS resolve o ALB sem IP fixo):
#    (pegar CanonicalHostedZoneID do ALB)
aws elbv2 describe-load-balancers --region sa-east-1 --names cerebro-web-alb \
  --query 'LoadBalancers[0].{DNS:DNSName,ZoneId:CanonicalHostedZoneId}'
# criar no Route53: A/ALIAS cerebroamigo.com.br → ALB ; A/ALIAS www → ALB
# 3) trocar os NS do domínio (no registrar) p/ os 4 NS do Route53.
```
Outros registros (api.*, checkup.* etc.) têm que ser recriados no Route53 antes de
virar os NS, senão caem. Listar tudo na Vercel primeiro.

### Opção B (rápida, só www) — manter zona na Vercel
www CNAME → ALB DNS. apex fica problemático (sem ALIAS p/ ALB na Vercel); aceitar
apex quebrado temporariamente ou só redirecionar www. Não recomendada p/ produção.

**Validar pós-propagação:**
```bash
dig +short www.cerebroamigo.com.br
curl -sI https://www.cerebroamigo.com.br/ | head -1
curl -sI https://cerebroamigo.com.br/ | head -1     # 301 -> www
```

---

## Fase 7 — Desligar Vercel + limpeza (destrutivo — só após 24-48h estável)

1. **Pausar/deletar** o projeto na Vercel (parar o serve). Conferir que o tráfego some.
2. **Remover `web` do `docker-compose.yml`** do box clínico (agora só roda no ASG) —
   commit. Evita 2 frontends rodando + libera RAM no box.
3. Remover o **warming cron** da Vercel (`app/api/cron/warm` + `vercel.json`) — vira
   inútil com container quente.
4. Conferir se a zona DNS antiga na Vercel pode ser desativada (se moveu p/ Route53).
5. **ADR** em `docs/adrs/` — supersede a decisão "web na Vercel".

---

## Atualizar o stack quando o template muda (ex.: HealthCheckPath → /api/health)

O CI (`deploy-web`) só faz `put-parameter image-tag` + instance refresh — **não** roda
`cloudformation deploy`. Qualquer mudança no `web-asg-alb.yaml` (TargetGroup, ALB, ASG,
LaunchTemplate) só entra em produção com um `cloudformation deploy` **manual** do stack
`cerebro-web`, por quem tem perfil admin (o CI user não tem IAM de cloudformation/elbv2
— ver `project-ci-iam-path-scoped`).

**⚠️ Gotcha de ordem (inverter = OUTAGE):** o path `/api/health` só existe na imagem
nova. Se flipar o `HealthCheckPath` ANTES de a imagem nova estar viva em TODAS as
instâncias, o ALB sonda `/api/health` na imagem velha → **404** (fora do matcher
`200-399`) → todos os targets unhealthy → **site fora**.

Ordem correta (zero-downtime):

1. **Imagem nova viva PRIMEIRO.** Mergear o código (`apps/web/app/api/health/route.ts`
   + patch do `Dockerfile`) em `main`. O `deploy-web` builda e faz o instance refresh;
   o ALB ainda sonda `/` (config atual do TG), então fica healthy o tempo todo.
   Confirmar que TODAS as instâncias servem `/api/health` (Session Manager numa
   instância de cada AZ):
   ```bash
   aws ssm start-session --target <instance-id> --region sa-east-1
   curl -s localhost:3000/api/health -o /dev/null -w "%{http_code}\n"   # 200 (ou 503->200 no boot)
   ```

2. **SÓ ENTÃO flipar o HealthCheckPath** (cloudformation deploy manual). Reusa o ACM
   ARN atual do stack (não tem default → tem que passar):
   ```bash
   ARN=$(aws cloudformation describe-stacks --region sa-east-1 --stack-name cerebro-web \
     --query "Stacks[0].Parameters[?ParameterKey=='AcmCertificateArn'].ParameterValue | [0]" --output text)
   aws cloudformation deploy --region sa-east-1 \
     --template-file infra/aws/web-asg-alb.yaml \
     --stack-name cerebro-web --capabilities CAPABILITY_NAMED_IAM \
     --parameter-overrides AcmCertificateArn="$ARN"
   # acompanhar o TG migrar p/ /api/health e seguir healthy:
   TG=$(aws elbv2 describe-target-groups --region sa-east-1 \
     --query "TargetGroups[?starts_with(TargetGroupName,'cerebro-web')].TargetGroupArn | [0]" --output text)
   aws elbv2 describe-target-health --region sa-east-1 --target-group-arn "$TG" \
     --query 'TargetHealthDescriptions[].TargetHealth.State'   # ["healthy", ...]
   ```
   (Update do `HealthCheckPath` é in-place no TG — sem re-registro de target, sem gap;
   as instâncias respondem `/` E `/api/health` durante a troca de path.)

**Rollback:** se os targets ficarem unhealthy após o flip, reverter o `HealthCheckPath`
p/ `/` no yaml + `cloudformation deploy` de novo (emergência: `aws elbv2
modify-target-group --health-check-path / --target-group-arn "$TG"`, mas isso dá drift
do stack — corrigir no yaml depois).

---

## Rollback geral

- **Antes da Fase 6:** nada em produção mudou — é só não virar o DNS. Stack fica
  idle (custo do ALB ~$20/mo até deletar: `aws cloudformation delete-stack --stack-name cerebro-web`).
- **Depois da Fase 6:** devolver o DNS pra Vercel (TTL 60s → minutos). Não deletar o
  projeto Vercel até estável (por isso a Fase 7 espera 24-48h).
- **App quebrado no ASG:** `deploy-web` com SHA anterior (put-parameter image-tag +
  start-instance-refresh) — imagens antigas ficam no ECR (lifecycle keep last 10).

## Custo

ALB ~$20/mo + 1× t3.small ~$15/mo ≈ **$35/mo** (MinSize=2 → +$15). Substitui o Vercel
Pro ($20 + uso). Crédito AWS já secou — ver `project-aws-credit-masking`.
