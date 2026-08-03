// docker-bake.hcl — targets Docker do deployment AWS anterior.
// Mantido para builds locais/referência histórica; não há workflow ativo que
// publique estas imagens. O runtime do portfólio segue o ADR-080.

variable "ECR" {
  default = "004177894935.dkr.ecr.sa-east-1.amazonaws.com"
}

variable "TAG" {
  default = "latest"
}

// NEXT_PUBLIC_* do web são build-time (inlined no bundle do cliente). O CI passa
// via env (GitHub Secrets) → estas variables → args do target web. Default "" =
// build local sem captcha/push (não quebra dev). Ver runbook web-vercel-to-ec2-env.
variable "NEXT_PUBLIC_TURNSTILE_SITE_KEY"   { default = "" }
variable "NEXT_PUBLIC_VAPID_PUBLIC_KEY"     { default = "" }
variable "NEXT_PUBLIC_HUB_URL"              { default = "" }
variable "NEXT_PUBLIC_MANUAL_PIX_CHAVE"     { default = "" }
variable "NEXT_PUBLIC_MANUAL_PIX_NOME"      { default = "" }
variable "NEXT_PUBLIC_MANUAL_PAGAMENTO_URL" { default = "" }

// Grupos históricos por destino do ADR-045. Não representam o runtime atual.
//   "clinical" → box clínico (compose/SSM)
//   "checkup"  → ASG cerebro-checkup-asg (instance refresh)
//   "default"  → os 6 (build completo manual)
group "default" {
  targets = ["web", "api-gateway", "orchestrator-py", "agents-py", "notifier-py", "checkup"]
}

group "clinical" {
  targets = ["web", "api-gateway", "orchestrator-py", "agents-py", "notifier-py"]
}

group "checkup" {
  targets = ["checkup"]
}

target "web" {
  context    = "."
  dockerfile = "apps/web/Dockerfile"
  tags       = ["${ECR}/cerebro-amigo/web:${TAG}"]
  platforms  = ["linux/amd64"]
  args = {
    NEXT_PUBLIC_TURNSTILE_SITE_KEY   = "${NEXT_PUBLIC_TURNSTILE_SITE_KEY}"
    NEXT_PUBLIC_VAPID_PUBLIC_KEY     = "${NEXT_PUBLIC_VAPID_PUBLIC_KEY}"
    NEXT_PUBLIC_HUB_URL              = "${NEXT_PUBLIC_HUB_URL}"
    NEXT_PUBLIC_MANUAL_PIX_CHAVE     = "${NEXT_PUBLIC_MANUAL_PIX_CHAVE}"
    NEXT_PUBLIC_MANUAL_PIX_NOME      = "${NEXT_PUBLIC_MANUAL_PIX_NOME}"
    NEXT_PUBLIC_MANUAL_PAGAMENTO_URL = "${NEXT_PUBLIC_MANUAL_PAGAMENTO_URL}"
  }
}

target "api-gateway" {
  context    = "apps/api-gateway"
  dockerfile = "Dockerfile"
  tags       = ["${ECR}/cerebro-amigo/api-gateway:${TAG}"]
  platforms  = ["linux/amd64"]
}

// target "api-gateway-scala" REMOVIDO — ADR-067 pausado, ADR-071 decomissionou.
// Source fora da árvore desde 2026-07-26: tag git `archive/api-gateway-scala`.
// Reativar exige novo ADR (restaurar source + target + groups default/clinical).

target "orchestrator-py" {
  context    = "apps/orchestrator-py"
  dockerfile = "Dockerfile"
  tags       = ["${ECR}/cerebro-amigo/orchestrator-py:${TAG}"]
  platforms  = ["linux/amd64"]
}

target "agents-py" {
  context    = "apps/agents-py"
  dockerfile = "Dockerfile"
  tags       = ["${ECR}/cerebro-amigo/agents-py:${TAG}"]
  platforms  = ["linux/amd64"]
}

target "notifier-py" {
  context    = "apps/notifier-py"
  dockerfile = "Dockerfile"
  tags       = ["${ECR}/cerebro-amigo/notifier-py:${TAG}"]
  platforms  = ["linux/amd64"]
}

target "checkup" {
  context    = "."
  dockerfile = "apps/checkup/Dockerfile"
  tags       = ["${ECR}/cerebro-amigo/checkup:${TAG}"]
  platforms  = ["linux/amd64"]
}
