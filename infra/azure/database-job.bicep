targetScope = 'resourceGroup'

param location string = resourceGroup().location
param containerEnvironmentId string
param registryLoginServer string
param identityResourceId string
param keyVaultUri string
param postgresHost string
param postgresDatabase string = 'cerebro_v3'
param postgresAdminUser string = 'cerebroadmin'
param imageTag string

@description('Tags comuns para governança e custo.')
param tags object = {
  project: 'cerebro-amigo'
  env: 'portfolio'
  'managed-by': 'bicep'
}

resource migrationsJob 'Microsoft.App/jobs@2024-03-01' = {
  name: 'job-cerebro-migrations'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identityResourceId}': {}
    }
  }
  properties: {
    environmentId: containerEnvironmentId
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 1800
      replicaRetryLimit: 0
      manualTriggerConfig: {
        parallelism: 1
        replicaCompletionCount: 1
      }
      registries: [
        {
          server: registryLoginServer
          identity: identityResourceId
        }
      ]
      secrets: [
        {
          name: 'postgres-admin-password'
          keyVaultUrl: '${keyVaultUri}secrets/postgres-admin-password'
          identity: identityResourceId
        }
        {
          name: 'db-gateway-password'
          keyVaultUrl: '${keyVaultUri}secrets/db-gateway-password'
          identity: identityResourceId
        }
        {
          name: 'db-workers-password'
          keyVaultUrl: '${keyVaultUri}secrets/db-workers-password'
          identity: identityResourceId
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'migrations'
          image: '${registryLoginServer}/migrations:${imageTag}'
          env: [
            {
              name: 'POSTGRES_HOST'
              value: postgresHost
            }
            {
              name: 'POSTGRES_DATABASE'
              value: postgresDatabase
            }
            {
              name: 'POSTGRES_ADMIN_USER'
              value: postgresAdminUser
            }
            {
              name: 'POSTGRES_ADMIN_PASSWORD'
              secretRef: 'postgres-admin-password'
            }
            {
              name: 'DB_GATEWAY_PASSWORD'
              secretRef: 'db-gateway-password'
            }
            {
              name: 'DB_WORKERS_PASSWORD'
              secretRef: 'db-workers-password'
            }
          ]
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
        }
      ]
    }
  }
}

output jobName string = migrationsJob.name
