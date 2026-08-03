# Runbook — Readiness do decouple do checkup (ADR-045)

**Companion** do `checkup-decouple-cutover.md` (que tem os passos). Este doc é o
**check de prontidão + lacunas** levantadas na auditoria de lançamento — leia antes de
provisionar. Vira blocker quando o lançamento for **full público** (SEO/ads): hoje o
checkup roda no box clínico (`A → 18.229.175.231`); um spike público **compete por CPU/RAM
com os serviços clínicos no mesmo EC2**. Decouple = isolá-lo em ASG+ALB próprio.

> Provisionamento custa (t3.small min:2) e mexe em superfície pública → **go do Patrick**.

## O que o IaC provisiona (`infra/aws/checkup-asg-alb.yaml`)
ALB internet-facing 80/443 (ACM, 3 AZs) · SG do ALB (80/443 público) + SG das instâncias
(3001 só do ALB, sem SSH) · Target Group :3001 health `/api/health` · Launch Template
AL2023 + docker (puxa imagem do ECR + segredos do SSM) · ASG t3.small **min 2 / max 6**,
target-tracking CPU 60% · IAM role (SSM, ECR pull, CloudWatch logs, SES restrito a
`noreply@`, `ssm:GetParameter`) · listener 80→301, 443→forward (+ regra CloudFront
`X-CF-Origin-Secret` condicional). Outputs: `AlbDnsName`, `InstanceSgId`, `AsgName`.

## Pré-requisitos (antes de `cloudformation deploy`)
- **Gate 0 (segurança, OBRIGATÓRIO):** role `checkup_app` restrita ao schema `checkup`,
  acesso negado às tabelas clínicas. Validar `SELECT FROM pacientes` como `checkup_app` →
  **permission denied**. `CHECKUP_DATABASE_URL` no SSM SecureString. **Não avançar sem isso.**
- ACM cert `checkup.cerebroamigo.com.br` validado (CNAME no DNS da Vercel).
- SSM: `/cerebro-amigo/checkup/{database-url, anthropic-api-key, image-tag, resend-api-key}`.
- Imagem `cerebro-amigo/checkup:TAG` no ECR.
- VPC/subnets/`RDS sg-01b07c7f4a5e0b2c5` (porta 5432).

## Lacunas / riscos (mitigar no cutover)
1. **IaC NÃO altera o SG do RDS** — o ingress 5432 a partir do `InstanceSgId` é passo
   **manual** (Fase 3). Risco: operador esquece → instâncias healthy mas app sem DB.
2. **Gate 0 fora do IaC** — script SQL no runbook, validação manual. Não pular.
3. **Flip DNS (Fase 5) manual na Vercel** — baixar TTL 60s antes; rollback = recriar
   `A 18.229.175.231`. Sem automação.
4. **Regra CloudFront `X-CF-Origin-Secret` só se `CfOriginSecret` não-vazio** — risco de
   provisionar sem o hardening de origem; endurecer pós-cutover (443 fica aberto durante).
5. **Health check grace 90s** pode ser curto se o boot do app passar de 90s → instância
   reciclada em loop. Conferir tempo real de boot e subir o grace se preciso.
6. **`deploy.yml` do checkup** passa a usar instance refresh do ASG (Fase 6) — ajuste
   não está no IaC; confirmar o job antes de remover o checkup do compose do box clínico.

## Validação pós-cutover
`dig checkup.cerebroamigo.com.br` → CNAME do ALB · `curl -I https://checkup...` → 200 ·
`bash apps/checkup/scripts/smoke.sh https://checkup.cerebroamigo.com.br` verde ·
instâncias `healthy` no Target Group · box clínico sem o container do checkup.
