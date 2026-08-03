# =============================================================================
# Ativação do ADR-082 em prod (portfólio Vercel + Azure, rg-cerebro-demo)
# Blob (SAS) + Azure AI Speech no lugar de S3 + Amazon Transcribe.
#
# Idempotente. NÃO ecoa segredos. NÃO toca no PostgreSQL (por isso não
# redeploya o foundation.bicep inteiro — recriar o foundation exigiria a senha
# do admin do Postgres; os ajustes de storage/Speech são feitos pontualmente
# e batem com o que o foundation.bicep declara para o próximo full-deploy).
#
# Uso:  powershell -ExecutionPolicy Bypass -File infra\azure\activate-adr082.ps1
# =============================================================================
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$env:AZURE_CONFIG_DIR = Join-Path $repoRoot '.azure-cerebro'

$rg      = 'rg-cerebro-demo'
$suffix  = '7zcnncyxvk'
$storage = "stcerebro$suffix"
$vault   = "kv-cerebro-$suffix"
$acr     = "acrcerebro$suffix"
$speech  = "spch-cerebro-$suffix"
$speechRegion = 'eastus'
$frontendUrl  = 'https://www.cerebroamigo.com.br'
$imageTag = Get-Date -Format 'yyyyMMdd-HHmm'

Write-Host "== ADR-082: ativando (imageTag=$imageTag) =="
az account show --query name -o tsv

# ── 1. Provider CognitiveServices ────────────────────────────────────────────
$state = az provider show -n Microsoft.CognitiveServices --query registrationState -o tsv
if ($state -ne 'Registered') {
  Write-Host '1. Registrando provider Microsoft.CognitiveServices...'
  az provider register -n Microsoft.CognitiveServices --wait
} else {
  Write-Host '1. Provider CognitiveServices OK'
}

# ── 2. Storage: shared key (SAS por account key) + CORS ─────────────────────
Write-Host '2. Storage: allowSharedKeyAccess=true + CORS do Blob...'
az storage account update -g $rg -n $storage --allow-shared-key-access true -o none
# A propagação da shared key pode levar alguns segundos.
Start-Sleep -Seconds 15
az storage cors clear --services b --account-name $storage -o none
az storage cors add --services b `
  --methods GET HEAD OPTIONS PUT `
  --origins $frontendUrl http://localhost:3000 `
  --allowed-headers '*' --exposed-headers '*' --max-age 3600 `
  --account-name $storage -o none

# ── 3. Azure AI Speech (fast transcription; região própria) ─────────────────
$exists = az cognitiveservices account list -g $rg --query "[?name=='$speech'] | length(@)" -o tsv
if ($exists -eq '0') {
  Write-Host "3. Criando Speech $speech em $speechRegion..."
  az cognitiveservices account create -n $speech -g $rg `
    --kind SpeechServices --sku S0 -l $speechRegion `
    --tags project=cerebro-amigo env=portfolio managed-by=bicep --yes -o none
} else {
  Write-Host '3. Speech já existe'
}

# ── 4. Segredos no Key Vault (sem ecoar) ─────────────────────────────────────
Write-Host '4. Gravando storage-connection-string e speech-key no Key Vault...'
$conn = az storage account show-connection-string -g $rg -n $storage --query connectionString -o tsv
az keyvault secret set --vault-name $vault -n storage-connection-string --value $conn -o none
$skey = az cognitiveservices account keys list -n $speech -g $rg --query key1 -o tsv
az keyvault secret set --vault-name $vault -n speech-key --value $skey -o none
Remove-Variable conn, skey

# ── 5. Imagens novas no ACR (build remoto; contexto = dir do app) ───────────
Write-Host "5. Buildando imagens :$imageTag no ACR (4 builds, alguns minutos)..."
az acr build -r $acr -t "api-gateway:$imageTag"     (Join-Path $repoRoot 'apps\api-gateway')
az acr build -r $acr -t "agents-py:$imageTag"       (Join-Path $repoRoot 'apps\agents-py')
az acr build -r $acr -t "orchestrator-py:$imageTag" (Join-Path $repoRoot 'apps\orchestrator-py')
az acr build -r $acr -t "notifier-py:$imageTag"     (Join-Path $repoRoot 'apps\notifier-py')

# ── 6. apps.bicep (envs/secrets novos + imagens novas) ───────────────────────
Write-Host '6. Aplicando apps.bicep...'
az deployment group create -g $rg -n "cerebro-apps-adr082-$imageTag" `
  -f (Join-Path $PSScriptRoot 'apps.bicep') `
  -p containerEnvironmentId="/subscriptions/10a230b7-7df2-4a00-b64f-c732548c64ff/resourceGroups/rg-cerebro-demo/providers/Microsoft.App/managedEnvironments/cae-cerebro-$suffix" `
     registryLoginServer="$acr.azurecr.io" `
     identityResourceId="/subscriptions/10a230b7-7df2-4a00-b64f-c732548c64ff/resourceGroups/rg-cerebro-demo/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-cerebro-apps-$suffix" `
     keyVaultUri="https://$vault.vault.azure.net/" `
     imageTag=$imageTag `
     frontendUrl=$frontendUrl `
     speechRegion=$speechRegion `
  --query 'properties.provisioningState' -o tsv

# ── 7. Smoke ─────────────────────────────────────────────────────────────────
Write-Host '7. Smoke...'
$fqdn = az containerapp show -g $rg -n ca-cerebro-gateway --query properties.configuration.ingress.fqdn -o tsv
Write-Host "   gateway: https://$fqdn"
try {
  $h = Invoke-RestMethod "https://$fqdn/health"
  Write-Host "   /health => $($h.status)"
  $r = Invoke-RestMethod "https://$fqdn/ready"
  Write-Host "   /ready  => $($r.status)"
} catch {
  Write-Warning "   smoke falhou: $($_.Exception.Message)"
}
az containerapp revision list -g $rg -n ca-cerebro-gateway --query "[?properties.active].{rev:name,ready:properties.healthState}" -o table
az containerapp revision list -g $rg -n ca-cerebro-agents  --query "[?properties.active].{rev:name,ready:properties.healthState}" -o table

Write-Host '== ADR-082 ativado. Push na main deploya a CSP nova do web pela Vercel. =='
