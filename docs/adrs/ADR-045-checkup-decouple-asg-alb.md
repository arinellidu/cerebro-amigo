# ADR-045 — Desacoplar o Check-up para infra própria (ALB + Auto Scaling Group)

- **Status:** Accepted (em produção desde 2026-06-12)
- **Data:** 2026-06-11
- **Contexto relacionado:** ADR-009 (isolamento de recurso no compose), ADR-042 (RLS de tenant),
  ADR-044 (LLM Anthropic), CLAUDE.md (isolamento clínico⇄público), `apps/checkup/CLAUDE.md`.

## Contexto

`apps/checkup` (Check-up Mental — triagem pública anônima, motor de aquisição) roda hoje
como 6º container no `docker-compose.yml` do **box clínico** compartilhado
(`i-057860cd97edafefb`, t3.small), atrás do mesmo Caddy, alcançando o mesmo RDS. Está
capado (`mem_limit: 256m`) justamente para não pressionar o caminho de crise.

Dois problemas:
1. **Acoplamento de escala.** Subir capacidade para o checkup (público, sujeito a pico
   viral de SEO) significaria mexer no box que roda o protocolo de crise — e trocar o
   tipo da EC2 exige **parar a instância** (~2-3 min), derrubando o caminho de crise.
   Automatizar esse resize colidiria com as regras inegociáveis #2 (crise) e #4 (médico
   no loop).
2. **Superfície de risco.** A única superfície pública anônima divide host e perímetro
   de rede com todo o stack clínico.

Alternativas descartadas:
- **Subir o box clínico (t3.small→medium) por causa do checkup:** rejeitado. O checkup é
  capado e não pressiona o clínico (medição 2026-06-11: box a 52% RAM, checkup 83 MiB);
  CPU nunca queima crédito burst. Pagar instância maior resolve gargalo inexistente e não
  remove o acoplamento de escala.
- **Vercel:** comprovadamente inviável — us-east não alcança o RDS `sa-east-1` (sem IP
  fixo p/ o SG do RDS); quebra persistência e fere residência de dado (LGPD). Ver
  memória de deploy do checkup.
- **Box único maior dedicado (t3.medium):** escala em degrau grosso e caro, paga folga
  ociosa; pior que escala horizontal de unidades pequenas para uma superfície web sem estado.

## Decisão

Mover o checkup para **infra própria, isolada do box clínico**: **Application Load
Balancer + Auto Scaling Group** de unidades **t3.small** (min 1 / max 6), escala horizontal
por **target tracking de CPU a 60%**. TLS termina no ALB via **ACM** (sem Caddy por box).
O checkup é stateless (grava no schema `checkup` do RDS) → escala out é seguro.

Garantias de isolamento (alinhadas ao CLAUDE.md):
- **IAM mínima** (`EC2-Checkup`): SSM core + ECR pull (só repo checkup) + CloudWatch logs +
  SES (condicionado a `FromAddress=noreply@cerebroamigo.com.br`) + leitura de
  `/cerebro-amigo/checkup/*`. **Sem Bedrock, sem perms clínicas, sem o S3 social.**
- **Rede:** instâncias só recebem do ALB na 3001 (sem inbound público, sem SSH — gestão por
  SSM). ALB nas 3 AZs.
- **DB:** acesso ao RDS **somente** via role `checkup_app` restrito ao schema `checkup`
  (gate de segurança da Fase 0 do runbook; provado com `permission denied` em tabela
  clínica). O box público nunca carrega credencial que leia dado clínico.

IaC em `infra/aws/checkup-asg-alb.yaml` (CloudFormation). Cutover ordenado e reversível em
`docs/runbooks/checkup-decouple-cutover.md` — o checkup atual segue servindo até o flip de
DNS; só então o container clínico é removido.

## Consequências

**Positivas:** pico viral do checkup nunca toca o caminho de crise; escala automática e
auto-cura (ASG + health check ELB); o "auto-upgrade por causa do checkup" que o dono queria
passa a ser seguro (escala out do box público, não stop do box clínico); libera o
`mem_limit: 256m` + folga no box clínico; perímetro de rede e IAM do público separados do
clínico; TLS gerido por ACM (sem renovação Let's Encrypt por box).

**Negativas / custo:** +~$44/mês ocioso (1× t3.small + ALB), +~$24/mês por unidade extra em
pico; mais peças de infra (ALB, TG, LT, ASG, ACM); deploy do checkup deixa de ser um
`compose up` no box e passa a **instance refresh** do ASG (ajuste no `deploy.yml`); a zona
DNS na Vercel exige o flip manual do record.

**Riscos mitigados:** mudança de perímetro do RDS é passo explícito (não embutido no stack);
cutover de DNS é reversível (reaponta o A antigo); limpeza do box clínico só após 24-48h
estável.
