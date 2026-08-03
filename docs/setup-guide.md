# AWS — Setup inicial do Cérebro Amigo

Guia para o **primeiro deploy** em uma conta AWS limpa. Após esse setup, todo
deploy futuro acontece via `git push origin main` (GitHub Actions cuida).

**Conta:** 004177894935 · **Região:** sa-east-1 (São Paulo)

## Pré-requisitos

- [ ] AWS CLI configurada (`aws sts get-caller-identity` retorna seu user)
- [ ] RDS Postgres rodando (já tem: `cerebro-postgres.ch8u4aig6zs6.sa-east-1.rds.amazonaws.com`)
- [ ] Repositório no GitHub
- [ ] API keys: Anthropic, Resend, LangSmith (opcional)
- [ ] VAPID keys (use as do `.env` local pra não invalidar subs já registradas em dev)

## Passo 1 — Provisionar EC2 (via terminal local)

```bash
cd infra/aws

# Opcional: restringir SSH ao seu IP (recomendado)
export SSH_FROM="$(curl -s ifconfig.me)/32"

./ec2-create.sh
```

O script é **idempotente** — pode rodar várias vezes sem efeito colateral. Cria:

- Security group `cerebro-app-sg`
- Regra no SG do RDS aceitando 5432 do SG da app
- Key pair SSH (`cerebro-deploy.pem` salvo localmente)
- EC2 t2.micro Amazon Linux 2023 (free tier)
- Elastic IP fixo

**Anota o IP** no final do output. Vai usar nos próximos passos.

> ⚠️ Se rodar uma vez sem `SSH_FROM` e depois quiser restringir, edita o SG:
> ```bash
> aws ec2 revoke-security-group-ingress --region sa-east-1 \
>   --group-id <APP_SG_ID> --protocol tcp --port 22 --cidr 0.0.0.0/0
> aws ec2 authorize-security-group-ingress --region sa-east-1 \
>   --group-id <APP_SG_ID> --protocol tcp --port 22 --cidr <SEU_IP>/32
> ```

## Passo 2 — Bootstrap do EC2 (via SSH)

Copia o bootstrap pro EC2 e executa:

```bash
EC2_IP=<IP-DO-OUTPUT-ANTERIOR>

scp -i cerebro-deploy.pem ec2-bootstrap.sh ec2-user@$EC2_IP:~/
ssh -i cerebro-deploy.pem ec2-user@$EC2_IP 'bash ~/ec2-bootstrap.sh'
```

O script instala Docker + compose plugin, cria 2GB de swap (crítico),
ativa o daemon, cria `/opt/cerebro`, e **gera uma SSH key** dentro do EC2.

No final ele imprime a chave pública. **Copia ela.**

## Passo 3 — Cadastra deploy key no GitHub

GitHub → seu repo → Settings → **Deploy keys** → Add deploy key
- Title: `EC2 prod sa-east-1`
- Key: cola a SSH pública do EC2
- Read access — pra git pull (NÃO marcar "Allow write")

## Passo 4 — Clona o repo no EC2 e faz primeiro deploy

```bash
ssh -i cerebro-deploy.pem ec2-user@$EC2_IP
# (agora dentro do EC2)

# Relogue ou ative o group docker no shell atual pra não precisar de sudo
newgrp docker

# Clona o repo
git clone git@github.com:SEU_USUARIO/SEU_REPO.git /opt/cerebro
cd /opt/cerebro

# Cria .env de produção
cp infra/aws/.env.production.template .env
nano .env   # ou vi — preenche todos os valores marcados __PREENCHER__

# IMPORTANTE: gera/troca o RESEND_API_KEY (a antiga foi exposta em chat)
# E confirma que VAPID_PUBLIC_KEY/PRIVATE_KEY são as mesmas do dev local

# Primeiro build (vai demorar ~3-5 min, Next.js consome o swap)
docker compose up -d --build

# Verifica
docker compose ps
docker compose logs --tail=20
```

Esperado: 5 containers `Up healthy` em ~1-2 min depois do build.

Teste:
```bash
curl http://localhost:5050/health
# {"status":"ok"}
```

Sai do SSH e teste da sua máquina:
```bash
curl http://$EC2_IP:3000        # PWA Next.js
curl http://$EC2_IP:5050/health # API Gateway
```

> Importante: as portas 3000/5050/8081-8083 estão expostas internamente nos
> containers, mas o security group só liberou 22/80/443. Pra acessar pela
> internet, configure um reverse proxy (nginx no EC2 ou Cloudflare na frente)
> mapeando 80/443 → containers. Veja passo 8.

## Passo 5 — Configurar GitHub Actions secrets

GitHub → seu repo → Settings → Secrets and variables → Actions → **New repository secret**:

| Nome | Valor |
|---|---|
| `EC2_HOST` | IP público do EC2 (do passo 1) |
| `EC2_USER` | `ec2-user` |
| `EC2_SSH_KEY` | Conteúdo do `cerebro-deploy.pem` (cat o arquivo todo, cole) |

A partir daí, todo merge na `main` triggera o workflow `Deploy` que:
1. SSH no EC2
2. `git pull origin main`
3. `docker compose up -d --build`
4. Valida healthchecks
5. Falha o job se algum container ficar unhealthy

Teste manual: GitHub → Actions → Deploy → Run workflow.

## Passo 6 — Lambda cleanup magic_links

Pra ganhar os $20 de crédito do "Create a web app using AWS Lambda" + manter
o DB limpo.

### 6.1 Cria a function (via Console — mais simples uma vez)

1. AWS Console → Lambda → Create function
2. Nome: `cerebro-cleanup-magic-links`
3. Runtime: Python 3.12
4. Architecture: x86_64
5. Permissions: Create a new role with basic Lambda permissions
6. **Advanced settings → VPC**: marca, escolhe `vpc-0edf8eb7d2e60b397` + as 3 subnets, e o SG `cerebro-app-sg`
7. Create function

### 6.2 Env vars

Configuration → Environment variables → Edit:
- `POSTGRES_HOST` = endpoint do RDS
- `POSTGRES_PORT` = 5432
- `POSTGRES_DB` = cerebro
- `POSTGRES_USER` = postgres
- `POSTGRES_PASSWORD` = (sua senha)

### 6.3 Empacota e deploya

```bash
cd infra/aws/lambda/cleanup-magic-links
./deploy.sh
```

### 6.4 Trigger diário via EventBridge

Configuration → Triggers → Add trigger → EventBridge (CloudWatch Events):
- Rule type: Schedule expression
- Expression: `cron(0 3 * * ? *)` (03:00 UTC = 00:00 BRT, fora do horário ativo)

### 6.5 Teste manual

Configuration → Test → New event → `{}`:
- Esperado response 200 com `{"magic_links_deleted": N, "push_subscriptions_deleted": M}`

## Passo 7 — Lambda webhook do Resend (opcional)

Mesmo padrão da Lambda anterior. Adicional:
- Adicionar trigger **API Gateway** ao Lambda
- Copiar URL do API Gateway
- No Resend dashboard → Webhooks → Add endpoint → cola a URL, marca eventos `email.bounced`, `email.complained`, `email.delivered`
- Resend mostra o "signing secret" — copia e adiciona como env var `RESEND_WEBHOOK_SECRET` no Lambda

Detalhes do empacotamento: `cd infra/aws/lambda/resend-webhook && ./deploy.sh`.

## Passo 8 — Domínio + Cloudflare grátis (HTTPS)

**Não obrigatório pra MVP**, mas necessário em produção real (push notifications,
PWA, cookies HttpOnly, etc.). Push em browsers só funciona em `localhost` OU
HTTPS verdadeiro.

### 8.1 Compra domínio

Recomendo **Registro.br** (domínios .com.br ~R$ 40/ano) ou **Cloudflare Registrar**
(.com ~$10/ano, com Cloudflare grátis nativo).

### 8.2 Aponta DNS pro EC2

Cloudflare → adiciona o domínio → segue as instruções de mudar os nameservers
no registrador. Depois:

- Tipo A → `app` → IP do EC2 → Proxy ON (laranjinha)
- Tipo A → `@` → IP do EC2 → Proxy ON

### 8.3 Cert HTTPS automático

Cloudflare → SSL/TLS → modo **Full**. Cloudflare termina TLS na frente e fala
HTTP plain com o EC2. Cert grátis, renovação automática.

### 8.4 nginx no EC2 fazendo reverse proxy 80 → containers

```bash
ssh -i cerebro-deploy.pem ec2-user@$EC2_IP

# Adicione um serviço nginx ao docker-compose.yml OU instale nginx no host:
sudo dnf install -y nginx
sudo tee /etc/nginx/conf.d/cerebro.conf > /dev/null <<'NGINX'
server {
    listen 80 default_server;
    server_name _;

    # PWA Next.js
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # API Gateway
    location /api/ {
        proxy_pass http://127.0.0.1:5050;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_http_version 1.1;
        # SSE endpoints — não buferizar
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header Connection '';
        chunked_transfer_encoding off;
    }
}
NGINX

sudo systemctl enable --now nginx
```

E atualize `.env` no EC2:
```
PORTAL_PACIENTE_URL=https://app.SEU_DOMINIO.com.br
```

Restart api-gateway pra pegar nova URL:
```bash
docker compose up -d api-gateway
```

## Passo 9 — Smoke test final

Da sua máquina:

```bash
DOMAIN=app.cerebroamigo.com.br   # ou IP do EC2 se ainda sem domínio

curl -i https://$DOMAIN/api/health
# {"status":"ok"}

# Cria paciente teste via API Gateway em produção (com JWT médico)
# ... (mesmo curl do dev, só trocando localhost:5050 por https://$DOMAIN)
```

Browse `https://$DOMAIN/` — vê o PWA Next.js. Browser oferece instalar.

## Troubleshooting

### EC2 com OOM no build do `web`

Sintoma: `docker compose up -d --build` mata o container em `npm run build`,
container fica em loop crash, ou ssh trava.

Causa: t2.micro tem 1GB RAM, Next.js precisa de 2-3GB pra build.

Fix: confirma que o swap foi criado (bootstrap deveria ter feito):
```bash
free -h   # Swap deve mostrar 2.0Gi
swapon --show
```

Se vazio:
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
```

### Deploy via GitHub falha em "Permission denied (publickey)"

Causa: `EC2_SSH_KEY` secret tem newlines mal-formatadas ou foi colado errado.

Fix: re-gera o secret colando o conteúdo COMPLETO do `.pem`, incluindo as
linhas `-----BEGIN ...-----` e `-----END ...-----`.

### `docker compose up` quebra com "container Healthy/Started" mas curl retorna timeout

Causa: o EC2 expõe portas 22/80/443 só. Containers escutam em 3000/5050/etc
**no network do Docker**, sem reverse proxy ainda.

Fix: passo 8 do guide (nginx ou Cloudflare).

### Lambda timeout ao conectar no RDS

Causa: Lambda fora da VPC do RDS. Função padrão pode acessar internet mas
não chega no RDS privado.

Fix: Configuration → VPC → editar — colocar nas 3 subnets da VPC + SG `cerebro-app-sg`.

## Custo previsto

Com free tier (primeiros 12 meses):

| Recurso | Custo/mês |
|---|---|
| EC2 t2.micro 750h | $0 (free tier) |
| EBS gp3 20GB | $0 (até 30GB free) |
| Elastic IP (enquanto associado) | $0 (até 1 EIP em uso) |
| RDS db.t2.micro | $0 (free tier) |
| Lambda | $0 (1M req/mês always-free) |
| Egress / data transfer | $1-5 |
| **Total** | **~$5/mês** |

Depois dos 12 meses, escala pra ~$15-25/mês. Os $100 de crédito cobrem
~20 meses.

## Próximos itens (fora desse setup)

- [ ] Backup automático do RDS (snapshot diário — RDS faz por padrão se enabled)
- [ ] CloudWatch alarms pra disk usage e CPU
- [ ] Comprar domínio e configurar Cloudflare
- [ ] Verificar domínio no Resend pra mandar email pra qualquer destinatário (não só sandbox)
- [ ] Migrar `.env` pra Parameter Store (mais higiênico que arquivo no EC2)
