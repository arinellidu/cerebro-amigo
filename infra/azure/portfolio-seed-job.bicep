targetScope = 'resourceGroup'

param location string = resourceGroup().location
param containerEnvironmentId string
param registryLoginServer string
param identityResourceId string
param keyVaultUri string
param postgresHost string
param imageTag string

resource seedJob 'Microsoft.App/jobs@2024-03-01' = {
  name: 'job-cerebro-portfolio-seed'
  location: location
  tags: {
    project: 'cerebro-amigo'
    env: 'portfolio'
    'managed-by': 'bicep'
  }
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
      replicaTimeout: 900
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
          name: 'demo-login-password'
          keyVaultUrl: '${keyVaultUri}secrets/demo-login-password'
          identity: identityResourceId
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'portfolio-seed'
          image: '${registryLoginServer}/portfolio-seed:${imageTag}'
          env: [
            { name: 'POSTGRES_HOST', value: postgresHost }
            { name: 'POSTGRES_DATABASE', value: 'cerebro_v3' }
            { name: 'POSTGRES_ADMIN_USER', value: 'cerebroadmin' }
            { name: 'POSTGRES_ADMIN_PASSWORD', secretRef: 'postgres-admin-password' }
            { name: 'DEMO_LOGIN_PASSWORD', secretRef: 'demo-login-password' }
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

output jobName string = seedJob.name
