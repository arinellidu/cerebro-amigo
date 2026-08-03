# Runbook — desacoplar Check-up para infra própria (ALB + ASG)

Move `apps/checkup` do box clínico compartilhado (`i-057860cd97edafefb`) para ALB +
Auto Scaling Group de t3.small (escala horizontal por CPU). Objetivo: superfície
pública anônima isolada do stack clínico — resize/escala/restart do checkup **nunca**
toca o caminho de crise. Ver ADR-045 e `infra/aws/checkup-asg-alb.yaml`.

Princípio de segurança: o checkup continua servindo no box clínico até o **flip de DNS**
(Fase 5). Tudo antes é **aditivo e reversível** (stack nova roda em paralelo, testada
pelo DNS do ALB). Só a Fase 5 é externa; Fase 6 é a única destrutiva.

Fatos fixos: VPC `vpc-0edf8eb7d2e60b397`; subnets públicas `subnet-080b40f72f1971227`
(1a) / `subnet-0c781b1f0ea120f58` (1b) / `subnet-026f35019da57ea52` (1c); RDS SG
`sg-01b07c7f4a5e0b2c5`; ECR `cerebro-amigo/checkup`; zona DNS **na Vercel**
(NS `ns1.vercel-dns.com`); domínio `checkup.cerebroamigo.com.br`.

---

## Fase 0 — GATE DE SEGURANÇA (bloqueia tudo) · role de DB restrito

Um box exposto à internet **não pode** carregar credencial que leia tabela clínica.
Migration 0039 prevê role `checkup_app` mínimo, mas cria no runbook (fora do DDL) — então
**confirme o estado real em prod antes de prosseguir**.

1. Descobrir como o `CHECKUP_DATABASE_URL` atual conecta (usuário). Hoje vive no `.env`
   do box clínico.
2. Conectar ao RDS como admin e validar/criar o role restrito:

```sql
-- role só-checkup (idempotente)
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='checkup_app') THEN
    CREATE ROLE checkup_app LOGIN PASSWORD '<forte>' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

REVOKE ALL ON SCHEMA public FROM checkup_app;
GRANT USAGE ON SCHEMA checkup TO checkup_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA checkup TO checkup_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA checkup TO checkup_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA checkup GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO checkup_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA checkup GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO checkup_app;
ALTER ROLE checkup_app SET search_path = checkup;

-- PROVA do isolamento: deve dar 0 e/ou permission denied
SET ROLE checkup_app;
SELECT count(*) FROM pacientes;     -- esperado: ERROR permission denied
RESET ROLE;
```

3. Guardar segredos em SSM SecureString (a role `EC2-Checkup` lê `/cerebro-amigo/checkup/*`):

```bash
aws ssm put-parameter --region sa-east-1 --type SecureString --overwrite \
  --name /cerebro-amigo/checkup/database-url \
  --value 'postgres://checkup_app:<senha>@<rds-host>:5432/cerebro_v3?sslmode=require'
aws ssm put-parameter --region sa-east-1 --type SecureString --overwrite \
  --name /cerebro-amigo/checkup/anthropic-api-key --value '<CHECKUP_ANTHROPIC_API_KEY>'
aws ssm put-parameter --region sa-east-1 --type String --overwrite \
  --name /cerebro-amigo/checkup/image-tag --value '<SHA-em-prod>'
```

> **NÃO avançar** enquanto `SELECT ... FROM pacientes` como `checkup_app` não der permission denied.

## Fase 1 — Cert ACM (validação DNS na Vercel)

```bash
aws acm request-certificate --region sa-east-1 \
  --domain-name checkup.cerebroamigo.com.br --validation-method DNS \
  --query CertificateArn --output text
# pegar o CNAME de validação:
aws acm describe-certificate --region sa-east-1 --certificate-arn <arn> \
  --query "Certificate.DomainValidationOptions[0].ResourceRecord"
```

Adicionar o CNAME de validação na **Vercel DNS** → aguardar `Status=ISSUED`.

## Fase 2 — Deploy do stack (aditivo, não afeta o checkup atual)

```bash
aws cloudformation deploy --region sa-east-1 \
  --stack-name cerebro-checkup \
  --template-file infra/aws/checkup-asg-alb.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides AcmCertificateArn=<arn> CheckupImageTag=<SHA>
aws cloudformation describe-stacks --region sa-east-1 --stack-name cerebro-checkup \
  --query "Stacks[0].Outputs"   # AlbDnsName, InstanceSgId, AsgName
```

## Fase 3 — Perímetro RDS (mudança sensível — explícita)

Liberar 5432 do SG das instâncias do checkup para o RDS:

```bash
aws ec2 authorize-security-group-ingress --region sa-east-1 \
  --group-id sg-01b07c7f4a5e0b2c5 \
  --protocol tcp --port 5432 --source-group <InstanceSgId-do-output>
```

## Fase 4 — Validar ANTES de virar o DNS

```bash
# instâncias healthy no target group:
aws elbv2 describe-target-health --region sa-east-1 --target-group-arn <tg-arn>
# bater no app pelo ALB, fingindo o Host (sem mexer no DNS real):
curl -ksi --resolve checkup.cerebroamigo.com.br:443:$(dig +short <AlbDnsName> | head -1) \
  https://checkup.cerebroamigo.com.br/api/health
# smoke completo:
CHECKUP_BASE_URL=https://checkup.cerebroamigo.com.br bash apps/checkup/scripts/smoke.sh
```

Tudo verde (health 200, eventos gravando no `cerebro_v3.checkup.*`, PDF, /crise) → seguir.

## Fase 5 — Cutover DNS (externo, reversível)

Zona na **Vercel DNS**. Trocar `checkup.cerebroamigo.com.br`: hoje `A 18.229.175.231`
→ **CNAME** para `<AlbDnsName>`.
1. Baixar TTL antes (ex.: 60s) e esperar propagar.
2. Remover o A → criar o CNAME (via painel Vercel Domains ou API).
3. Verificar: `dig checkup.cerebroamigo.com.br` resolve pro ALB; HTTPS 200.

**Rollback:** recriar `A 18.229.175.231`. O container clínico ainda serve (só removido na Fase 6).

## Fase 6 — Limpeza do box clínico (destrutiva — só após 24-48h estável)

1. Remover o serviço `checkup` de `docker-compose.yml` (libera o `mem_limit: 256m` +
   folga clínica). `docker compose up -d --remove-orphans` no box via deploy.
2. Ajustar `deploy.yml`: imagem do checkup continua buildando/pushando no ECR, mas o
   deploy passa a **rolar o ASG** (`aws autoscaling start-instance-refresh
   --auto-scaling-group-name cerebro-checkup-asg`) após atualizar
   `/cerebro-amigo/checkup/image-tag`; remover o checkup do `docker compose` do box clínico.
3. Opcional: tirar a inline `CerebroAmigoSES` da role `EC2-SSM-CerebroAmigo` se só o
   checkup usava SES (clínico usa Resend) — confirmar antes.
4. ADR-045 → `Accepted`. Atualizar CLAUDE.md (seção de portas: checkup fora do box).

## Rollback geral

- Antes da Fase 5: nada externo mudou — `aws cloudformation delete-stack` apaga tudo.
- Depois da Fase 5: reapontar DNS pro `A 18.229.175.231` (checkup clínico intacto até Fase 6).
- Reverter ingress RDS: `aws ec2 revoke-security-group-ingress ... --source-group <InstanceSgId>`.

## Custo

Ocioso: 1× t3.small (~$24) + ALB (~$20) ≈ **$44/mês**. Pico: +~$24 por t3.small que o ASG
subir (cai ao esvaziar). Savings Plan corta ~30-40%.
