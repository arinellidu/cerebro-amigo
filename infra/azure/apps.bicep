targetScope = 'resourceGroup'

param location string = resourceGroup().location
param containerEnvironmentId string
param registryLoginServer string
param identityResourceId string
param keyVaultUri string
param imageTag string
param frontendUrl string = 'https://www.cerebroamigo.com.br'

@description('Região do Azure AI Speech (ADR-082) — mesma do foundation.bicep (speechLocation).')
param speechRegion string = 'eastus'

@description('Tags comuns para governança e custo.')
param tags object = {
  project: 'cerebro-amigo'
  env: 'portfolio'
  'managed-by': 'bicep'
}

var registry = [
  {
    server: registryLoginServer
    identity: identityResourceId
  }
]

var commonSecrets = [
  {
    name: 'postgres-workers-dsn'
    keyVaultUrl: '${keyVaultUri}secrets/postgres-workers-dsn'
    identity: identityResourceId
  }
  {
    name: 'internal-api-token'
    keyVaultUrl: '${keyVaultUri}secrets/internal-api-token'
    identity: identityResourceId
  }
  {
    name: 'encryption-key'
    keyVaultUrl: '${keyVaultUri}secrets/encryption-key'
    identity: identityResourceId
  }
  {
    name: 'anthropic-api-key'
    keyVaultUrl: '${keyVaultUri}secrets/anthropic-api-key'
    identity: identityResourceId
  }
]

resource orchestrator 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-cerebro-orchestrator'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identityResourceId}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerEnvironmentId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: false
        allowInsecure: false
        targetPort: 8081
        transport: 'auto'
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
      registries: registry
      secrets: commonSecrets
    }
    template: {
      containers: [
        {
          name: 'orchestrator'
          image: '${registryLoginServer}/orchestrator-py:${imageTag}'
          env: [
            { name: 'APP_ENV', value: 'production' }
            { name: 'LOG_LEVEL', value: 'INFO' }
            { name: 'FRONTEND_URL', value: frontendUrl }
            { name: 'SHADOW_MODE', value: 'true' }
            { name: 'CRISIS_RESILIENCE_ENABLED', value: 'false' }
            { name: 'LLM_PROVIDER', value: 'anthropic' }
            { name: 'ANTHROPIC_API_KEY', secretRef: 'anthropic-api-key' }
            { name: 'LANGSMITH_TRACING', value: 'false' }
            { name: 'LANGSMITH_HIDE_INPUTS', value: 'true' }
            { name: 'LANGSMITH_HIDE_OUTPUTS', value: 'true' }
            { name: 'PII_REDACTION_ENABLED', value: 'true' }
            { name: 'POSTGRES_DSN_URL', secretRef: 'postgres-workers-dsn' }
            { name: 'INTERNAL_API_TOKEN', secretRef: 'internal-api-token' }
            { name: 'ENCRYPTION_KEY', secretRef: 'encryption-key' }
            { name: 'NOTIFIER_PY_URL', value: 'http://ca-cerebro-notifier' }
          ]
          probes: [
            {
              type: 'Startup'
              httpGet: { path: '/health', port: 8081 }
              initialDelaySeconds: 5
              periodSeconds: 5
              failureThreshold: 30
            }
            {
              type: 'Readiness'
              httpGet: { path: '/ready', port: 8081 }
              initialDelaySeconds: 5
              periodSeconds: 10
              failureThreshold: 6
            }
          ]
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
        rules: [
          {
            name: 'http'
            http: { metadata: { concurrentRequests: '10' } }
          }
        ]
      }
    }
  }
}

resource agents 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-cerebro-agents'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identityResourceId}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerEnvironmentId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: false
        allowInsecure: false
        targetPort: 8082
        transport: 'auto'
        traffic: [
          { latestRevision: true, weight: 100 }
        ]
      }
      registries: registry
      // ADR-082: agents-py transcreve (Azure Speech) e baixa/deleta o áudio
      // efêmero do escriba presencial no Blob.
      secrets: concat(commonSecrets, [
        {
          name: 'storage-connection-string'
          keyVaultUrl: '${keyVaultUri}secrets/storage-connection-string'
          identity: identityResourceId
        }
        {
          name: 'speech-key'
          keyVaultUrl: '${keyVaultUri}secrets/speech-key'
          identity: identityResourceId
        }
      ])
    }
    template: {
      containers: [
        {
          name: 'agents'
          image: '${registryLoginServer}/agents-py:${imageTag}'
          env: [
            { name: 'APP_ENV', value: 'production' }
            { name: 'LOG_LEVEL', value: 'INFO' }
            { name: 'AGENTS_MODE', value: 'manual' }
            { name: 'SHADOW_MODE', value: 'true' }
            { name: 'LLM_PROVIDER', value: 'anthropic' }
            { name: 'ANTHROPIC_API_KEY', secretRef: 'anthropic-api-key' }
            { name: 'AZURE_SPEECH_KEY', secretRef: 'speech-key' }
            { name: 'AZURE_SPEECH_REGION', value: speechRegion }
            { name: 'AZURE_STORAGE_CONNECTION_STRING', secretRef: 'storage-connection-string' }
            { name: 'BLOB_CONTAINER_AUDIO', value: 'audio-efemero' }
            { name: 'EMBEDDINGS_ENABLED', value: 'false' }
            { name: 'MAX_DAILY_LLM_USD', value: '0' }
            { name: 'LANGSMITH_TRACING', value: 'false' }
            { name: 'LANGSMITH_HIDE_INPUTS', value: 'true' }
            { name: 'LANGSMITH_HIDE_OUTPUTS', value: 'true' }
            { name: 'PII_REDACTION_ENABLED', value: 'true' }
            { name: 'POSTGRES_DSN_URL', secretRef: 'postgres-workers-dsn' }
            { name: 'INTERNAL_API_TOKEN', secretRef: 'internal-api-token' }
            { name: 'ENCRYPTION_KEY', secretRef: 'encryption-key' }
          ]
          probes: [
            {
              type: 'Startup'
              httpGet: { path: '/health', port: 8082 }
              initialDelaySeconds: 5
              periodSeconds: 5
              failureThreshold: 30
            }
            {
              type: 'Readiness'
              httpGet: { path: '/ready', port: 8082 }
              initialDelaySeconds: 5
              periodSeconds: 10
              failureThreshold: 6
            }
          ]
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
        rules: [
          {
            name: 'http'
            http: { metadata: { concurrentRequests: '10' } }
          }
        ]
      }
    }
  }
}

resource notifier 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-cerebro-notifier'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identityResourceId}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerEnvironmentId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: false
        allowInsecure: false
        targetPort: 8083
        transport: 'auto'
        traffic: [
          { latestRevision: true, weight: 100 }
        ]
      }
      registries: registry
      secrets: concat(commonSecrets, [
        {
          name: 'vapid-public-key'
          keyVaultUrl: '${keyVaultUri}secrets/vapid-public-key'
          identity: identityResourceId
        }
        {
          name: 'vapid-private-key'
          keyVaultUrl: '${keyVaultUri}secrets/vapid-private-key'
          identity: identityResourceId
        }
      ])
    }
    template: {
      containers: [
        {
          name: 'notifier'
          image: '${registryLoginServer}/notifier-py:${imageTag}'
          env: [
            { name: 'APP_ENV', value: 'production' }
            { name: 'LOG_LEVEL', value: 'INFO' }
            { name: 'NOTIFIER_MODE', value: 'manual' }
            { name: 'EMAIL_PROVIDER', value: 'resend' }
            { name: 'EMAIL_FALLBACK_ENABLED', value: 'false' }
            { name: 'CONSULTA_LEMBRETES_ENABLED', value: 'false' }
            { name: 'POSTGRES_DSN_URL', secretRef: 'postgres-workers-dsn' }
            { name: 'INTERNAL_API_TOKEN', secretRef: 'internal-api-token' }
            { name: 'ENCRYPTION_KEY', secretRef: 'encryption-key' }
            { name: 'VAPID_PUBLIC_KEY', secretRef: 'vapid-public-key' }
            { name: 'VAPID_PRIVATE_KEY', secretRef: 'vapid-private-key' }
            { name: 'VAPID_SUBJECT', value: 'mailto:noreply@cerebroamigo.com.br' }
          ]
          probes: [
            {
              type: 'Startup'
              httpGet: { path: '/health', port: 8083 }
              initialDelaySeconds: 5
              periodSeconds: 5
              failureThreshold: 30
            }
            {
              type: 'Readiness'
              httpGet: { path: '/ready', port: 8083 }
              initialDelaySeconds: 5
              periodSeconds: 10
              failureThreshold: 6
            }
          ]
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
        rules: [
          {
            name: 'http'
            http: { metadata: { concurrentRequests: '10' } }
          }
        ]
      }
    }
  }
}

resource gateway 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-cerebro-gateway'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identityResourceId}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerEnvironmentId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        allowInsecure: false
        targetPort: 5000
        transport: 'auto'
        traffic: [
          { latestRevision: true, weight: 100 }
        ]
      }
      registries: registry
      secrets: [
        {
          name: 'postgres-gateway-dsn'
          keyVaultUrl: '${keyVaultUri}secrets/postgres-gateway-dsn'
          identity: identityResourceId
        }
        {
          name: 'jwt-secret'
          keyVaultUrl: '${keyVaultUri}secrets/jwt-secret'
          identity: identityResourceId
        }
        {
          name: 'internal-api-token'
          keyVaultUrl: '${keyVaultUri}secrets/internal-api-token'
          identity: identityResourceId
        }
        {
          name: 'encryption-key'
          keyVaultUrl: '${keyVaultUri}secrets/encryption-key'
          identity: identityResourceId
        }
        {
          name: 'edge-auth-secret'
          keyVaultUrl: '${keyVaultUri}secrets/edge-auth-secret'
          identity: identityResourceId
        }
        {
          // ADR-082: gateway assina SAS de upload/download no Blob.
          name: 'storage-connection-string'
          keyVaultUrl: '${keyVaultUri}secrets/storage-connection-string'
          identity: identityResourceId
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'gateway'
          image: '${registryLoginServer}/api-gateway:${imageTag}'
          env: [
            { name: 'ASPNETCORE_ENVIRONMENT', value: 'Production' }
            { name: 'ASPNETCORE_FORWARDEDHEADERS_ENABLED', value: 'true' }
            { name: 'EXPOSE_ERROR_DETAILS', value: 'false' }
            { name: 'POSTGRES_DSN', secretRef: 'postgres-gateway-dsn' }
            { name: 'JWT_SECRET', secretRef: 'jwt-secret' }
            { name: 'INTERNAL_API_TOKEN', secretRef: 'internal-api-token' }
            { name: 'ENCRYPTION_KEY', secretRef: 'encryption-key' }
            { name: 'EDGE_AUTH_SECRET', secretRef: 'edge-auth-secret' }
            { name: 'ORCHESTRATOR_PY_URL', value: 'http://ca-cerebro-orchestrator' }
            { name: 'AGENTS_PY_URL', value: 'http://ca-cerebro-agents' }
            { name: 'NOTIFIER_PY_URL', value: 'http://ca-cerebro-notifier' }
            { name: 'FRONTEND_URL', value: frontendUrl }
            { name: 'PORTAL_PACIENTE_URL', value: frontendUrl }
            { name: 'Cors__Origins__0', value: frontendUrl }
            { name: 'STUN_URLS', value: 'stun:stun.l.google.com:19302' }
            // ADR-082: SAS do Blob (containers criados no foundation.bicep).
            { name: 'AZURE_STORAGE_CONNECTION_STRING', secretRef: 'storage-connection-string' }
            { name: 'BLOB_CONTAINER_MEDICO_DOCS', value: 'documentos-demo' }
            { name: 'BLOB_CONTAINER_AUDIO_MSGS', value: 'audio-mensagens' }
            { name: 'BLOB_CONTAINER_AUDIO', value: 'audio-efemero' }
          ]
          probes: [
            {
              type: 'Startup'
              httpGet: { path: '/health', port: 5000 }
              initialDelaySeconds: 5
              periodSeconds: 5
              failureThreshold: 30
            }
            {
              type: 'Readiness'
              httpGet: { path: '/ready', port: 5000 }
              initialDelaySeconds: 5
              periodSeconds: 10
              failureThreshold: 6
            }
          ]
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
        rules: [
          {
            name: 'http'
            http: { metadata: { concurrentRequests: '20' } }
          }
        ]
      }
    }
  }
}

output gatewayFqdn string = gateway.properties.configuration.ingress.fqdn
output gatewayUrl string = 'https://${gateway.properties.configuration.ingress.fqdn}'
output orchestratorName string = orchestrator.name
output agentsName string = agents.name
output notifierName string = notifier.name
