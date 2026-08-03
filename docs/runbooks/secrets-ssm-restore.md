# Runbook — backup/restore de segredos clínicos no SSM (DR)

**Criado:** 2026-06-18. **Contexto:** os segredos clínicos viviam **só** no `.env` do box
(`/opt/cerebro-amigo-v3/.env`). O `deploy.yml` **preserva** o `.env` entre deploys (não o
regenera), mas um **rebuild do box** perderia tudo. Backup em SSM SecureString fecha esse gap
(CLAUDE.md: "ANTHROPIC_API_KEY ... SSM Parameter Store SecureString").

> **Importante:** a fonte **viva** ainda é o `.env` do box. O deploy **NÃO** injeta do SSM
> (wiring de injeção ficou para depois — ver "Evolução"). O SSM é **backup/fonte-de-verdade
> para DR e rotação**, não a fonte de runtime.

## Parâmetros (região `sa-east-1`, KMS default `alias/aws/ssm`)

| Nome | Conteúdo | Origem no `.env` |
|---|---|---|
| `/cerebro-amigo/clinical/anthropic-api-key` | `ANTHROPIC_API_KEY` | `ANTHROPIC_API_KEY=` |
| `/cerebro-amigo/clinical/langsmith-api-key` | `LANGSMITH_API_KEY` | `LANGSMITH_API_KEY=` |
| `/cerebro-amigo/clinical/gateway-db-password` | senha do role PG `cerebro_gateway` | `Password=` dentro de `POSTGRES_DSN` |

(Já existe `/cerebro-amigo/checkup/database-url` para o checkup — mesma convenção.)

## IAM

A role do box `EC2-SSM-CerebroAmigo` tem a inline policy **`CerebroClinicalSecretsSsm`**:
`ssm:PutParameter/GetParameter/GetParameters/GetParametersByPath` em
`arn:...:parameter/cerebro-amigo/clinical/*` + `kms:Encrypt/Decrypt/GenerateDataKey` condicionado
a `kms:ViaService=ssm.sa-east-1.amazonaws.com`. (Adicionada via IAM do operador, não da role.)

## Ao ROTACIONAR um segredo

Atualize **os dois**: o `.env` do box (runtime) **e** o param SSM (backup). Senão o SSM fica stale.
Ex. após rotacionar a Anthropic key:
```bash
# no box (Session Manager)
aws ssm put-parameter --region sa-east-1 --name /cerebro-amigo/clinical/anthropic-api-key \
  --type SecureString --overwrite \
  --value "$(sed -n 's/^ANTHROPIC_API_KEY=//p' /opt/cerebro-amigo-v3/.env | head -1)"
```

## RESTORE (rebuild de box) — reconstruir o `.env` a partir do SSM

```bash
# no box novo, com a role EC2-SSM-CerebroAmigo anexada. Região sa-east-1.
ENV=/opt/cerebro-amigo-v3/.env
fetch() { aws ssm get-parameter --region sa-east-1 --name "$1" --with-decryption \
            --query 'Parameter.Value' --output text; }

ANTH=$(fetch /cerebro-amigo/clinical/anthropic-api-key)
LANG=$(fetch /cerebro-amigo/clinical/langsmith-api-key)
GWPW=$(fetch /cerebro-amigo/clinical/gateway-db-password)

# aplicar no .env (ANTHROPIC_API_KEY, LANGSMITH_API_KEY diretos;
# GWPW vai no Password= do POSTGRES_DSN — formato .NET do gateway).
# NUNCA ecoar os valores. Editar com sed/python preservando o resto do .env.
```

> Os segredos que **não** estão neste backup (senha `cerebroadmin` = `POSTGRES_PASSWORD`, DSN dos
> workers `POSTGRES_DSN_URL`, VAPID, JWT_SECRET, INTERNAL_API_TOKEN, RESEND, etc.) seguem só no
> `.env`. Estender este backup para eles é um TODO (ver DEBT/Evolução) se DR completo for exigido.

## Evolução (não feito)

Injeção automática no deploy: o `deploy.yml`/boot do box puxar do SSM e montar o `.env`, tornando
o SSM a fonte de runtime (não só backup). Mudança de pipeline — avaliar quando o time crescer ou
o DR virar requisito formal.
