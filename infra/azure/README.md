# Azure — ambiente de portfólio

Infraestrutura do ADR-080. Alvo: subscription `Cerebro`, região `eastus2`, dados
exclusivamente fictícios e teto Azure de US$ 30/mês.

## Arquivos

- `subscription.bicep`: providers não são registrados por Bicep; cria o budget da
  subscription depois do primeiro provisionamento.
- `foundation.bicep`: Log Analytics, Container Apps Environment, ACR Basic,
  Key Vault, Storage (containers + CORS + lifecycle), Azure AI Speech (ADR-082)
  e PostgreSQL Flexible Server.
- `apps.bicep`: quatro Container Apps; aplicado somente depois das imagens existirem.

## Ordem

1. Autenticar usando `AZURE_CONFIG_DIR` isolado e selecionar a subscription.
2. Registrar os providers listados neste documento.
3. Criar `rg-cerebro-demo` em `eastus2`.
4. Aplicar `foundation.bicep` com senha administrativa gerada fora do git.
5. Publicar as imagens no ACR.
6. Aplicar migrations e criar roles `cerebro_gateway`/`cerebro_workers`.
7. Gravar segredos no Key Vault.
8. Aplicar `apps.bicep`.
9. Configurar Vercel e executar os smokes do ADR-080.

Nunca grave parâmetros seguros em `.bicepparam`, logs ou histórico do shell.

## Segredos de storage e Speech (ADR-082)

No passo 7, além dos segredos já listados, grave no Key Vault (sem ecoar no shell):

- `storage-connection-string` — `az storage account show-connection-string`
  da conta `stcerebro<suffix>`. O gateway assina SAS com ela; o agents-py
  baixa/deleta o áudio efêmero do escriba.
- `speech-key` — `az cognitiveservices account keys list` da conta
  `spch-cerebro-<suffix>` (região `eastus`; fast transcription).

Na Vercel, configure `NEXT_PUBLIC_BLOB_ORIGIN` com o endpoint do blob
(output `blobEndpoint` do foundation, sem barra final) — a CSP do web usa
esse valor em img-src/connect-src/media-src.

## Providers

```text
Microsoft.App
Microsoft.CognitiveServices
Microsoft.ContainerRegistry
Microsoft.DBforPostgreSQL
Microsoft.KeyVault
Microsoft.OperationalInsights
Microsoft.Storage
Microsoft.Insights
```

## Convenções

- Grupo: `rg-cerebro-demo`
- Tags: `project=cerebro-amigo`, `env=portfolio`, `managed-by=bicep`
- O Bicep deriva nomes globais com `uniqueString(subscription().id)`.
- O banco é público apenas para serviços Azure no estágio de portfólio. Dados reais
  são proibidos nessa topologia.

## Estado promovido

- Web: `https://www.cerebroamigo.com.br` (Vercel → gateway Azure).
- Check-up: `https://checkup.cerebroamigo.com.br` (Vercel, sem banco e sem chave
  Anthropic pública).
- Gateway: `ca-cerebro-gateway` com ingress externo protegido por
  `EDGE_AUTH_SECRET`; `/health` e `/ready` são as únicas probes públicas.
- Serviços Python: ingress interno, escala `0..1`, modos `shadow`/`manual`.
- Senha das contas fictícias (médico e paciente Aurora): somente no segredo
  `demo-login-password` do Key Vault. O mesmo valor é configurado como
  `DEMO_LOGIN_PASSWORD` server-only na Vercel para o acesso de paciente em um clique;
  ele nunca é enviado ao navegador.

## Reset do portfólio

O SQL é idempotente. Ele sincroniza o hash da conta demo com o Key Vault e repõe
somente dados marcados como fictícios; não apaga trilhas de auditoria.

```powershell
$env:AZURE_CONFIG_DIR = ".azure-cerebro"
az account set --subscription Cerebro
az containerapp job start `
  --resource-group rg-cerebro-demo `
  --name job-cerebro-portfolio-seed
```

Confirme a execução sem imprimir segredos:

```powershell
az containerapp job execution list `
  --resource-group rg-cerebro-demo `
  --name job-cerebro-portfolio-seed `
  --query "[0].{name:name,status:properties.status}" `
  --output table
```

## Rollback DNS durante a coexistência

A AWS continua provisionada durante a observação. Para rollback, restaure apenas
estes registros A no DNS gerenciado pela Vercel:

| Registro | AWS |
|---|---:|
| `@` e `www` | `18.228.217.137` |
| `checkup` e `www.checkup` | `54.94.33.65` |

`api.cerebroamigo.com.br`, registros de e-mail e validações ACM não foram alterados
no cutover. Não remova recursos AWS antes dos gates do ADR-080, de 48 horas de
observação e de nova autorização explícita.
