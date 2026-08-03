targetScope = 'subscription'

@description('E-mail que recebe os alertas de custo.')
param notificationEmail string = 'arinpar33@gmail.com'

@description('Teto mensal do Azure em USD.')
param monthlyBudgetUsd int = 30

@description('Início do budget; deve ser primeiro dia do mês.')
param budgetStart string = utcNow('yyyy-MM-01')

resource budget 'Microsoft.Consumption/budgets@2023-11-01' = {
  name: 'cerebro-portfolio-monthly'
  properties: {
    amount: monthlyBudgetUsd
    category: 'Cost'
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: budgetStart
      endDate: '2036-01-01'
    }
    notifications: {
      Actual70: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 70
        thresholdType: 'Actual'
        contactEmails: [
          notificationEmail
        ]
        contactGroups: []
        contactRoles: []
        locale: 'en-us'
      }
      Actual85: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 85
        thresholdType: 'Actual'
        contactEmails: [
          notificationEmail
        ]
        contactGroups: []
        contactRoles: []
        locale: 'en-us'
      }
      Forecast95: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 95
        thresholdType: 'Forecasted'
        contactEmails: [
          notificationEmail
        ]
        contactGroups: []
        contactRoles: []
        locale: 'en-us'
      }
      Actual100: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 100
        thresholdType: 'Actual'
        contactEmails: [
          notificationEmail
        ]
        contactGroups: []
        contactRoles: []
        locale: 'en-us'
      }
    }
  }
}
