using ApiGateway.Data;
using ApiGateway.Endpoints; // ReconAssinaturaRow
using Microsoft.EntityFrameworkCore;

namespace ApiGateway.Services;

/// <summary>
/// Reconciliação Asaas agendada (ADR-055 Fase E) — rede de segurança contra webhook
/// perdido (assinatura presa em status divergente do que o Asaas tem).
///
/// DETECT-ONLY, igual ao endpoint GET /api/v1/admin/asaas/reconciliacao: NUNCA escreve
/// em `assinaturas`. Corrigir é decisão humana — uma leitura possivelmente transitória
/// do Asaas não pode auto-suspender um médico pagante nem auto-liberar acesso sem
/// pagamento. Aqui só roda a MESMA detecção periodicamente e LOGA em WARNING quando há
/// divergência, pra virar alerta de ops (CloudWatch metric filter sobre o stderr do
/// container) em vez de depender de alguém abrir o painel.
///
/// Gates: roda só se ASAAS_API_KEY estiver setada (AsaasClient.Configurado) e
/// ASAAS_RECONCILE_INTERVAL_HORAS > 0 (default 24h). Fail-open: qualquer erro é logado
/// e a próxima rodada segue normalmente.
/// </summary>
public sealed class AsaasReconcileService : BackgroundService
{
    // Espera o boot assentar antes da 1ª rodada (não competir com health check inicial).
    private static readonly TimeSpan AtrasoInicial = TimeSpan.FromMinutes(5);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IConfiguration _cfg;
    private readonly ILogger<AsaasReconcileService> _logger;

    public AsaasReconcileService(
        IServiceScopeFactory scopeFactory, IConfiguration cfg, ILogger<AsaasReconcileService> logger)
    {
        _scopeFactory = scopeFactory;
        _cfg = cfg;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var horas = int.TryParse(_cfg["ASAAS_RECONCILE_INTERVAL_HORAS"], out var h) ? h : 24;
        if (horas <= 0)
        {
            _logger.LogInformation("asaas.reconcile.disabled (ASAAS_RECONCILE_INTERVAL_HORAS<=0)");
            return;
        }

        try { await Task.Delay(AtrasoInicial, stoppingToken); }
        catch (OperationCanceledException) { return; }

        using var timer = new PeriodicTimer(TimeSpan.FromHours(horas));
        do
        {
            try { await ReconciliarAsync(stoppingToken); }
            catch (OperationCanceledException) { break; }
            catch (Exception ex) { _logger.LogError(ex, "asaas.reconcile.falha (segue na próxima rodada)"); }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    private async Task ReconciliarAsync(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var asaas = scope.ServiceProvider.GetRequiredService<AsaasClient>();

        if (!asaas.Configurado)
        {
            _logger.LogDebug("asaas.reconcile.skip (ASAAS_API_KEY não configurada)");
            return;
        }

        // Mesma query do endpoint manual: assinaturas vinculadas ao Asaas e ainda vivas.
        var assinaturas = await db.Database.SqlQueryRaw<ReconAssinaturaRow>(@"
            SELECT a.id AS assinatura_id, a.medico_id, m.nome AS medico_nome,
                   a.status AS status_local, a.asaas_subscription_id
            FROM assinaturas a JOIN medicos m ON m.id = a.medico_id
            WHERE a.asaas_subscription_id IS NOT NULL AND a.status <> 'cancelada'").ToListAsync(ct);

        int divergentes = 0, indisponiveis = 0;
        foreach (var a in assinaturas)
        {
            ct.ThrowIfCancellationRequested();
            var statusAsaas = await asaas.ObterStatusAssinaturaAsync(a.AsaasSubscriptionId!, ct);
            if (statusAsaas is null) { indisponiveis++; continue; }

            var esperado = statusAsaas.ToUpperInvariant() switch
            {
                "ACTIVE" => "ativa",
                "EXPIRED" or "INACTIVE" => "suspensa",
                _ => null,
            };
            if (esperado is not null && !string.Equals(esperado, a.StatusLocal, StringComparison.OrdinalIgnoreCase))
            {
                divergentes++;
                // Dado administrativo (sem PII clínica): médico/assinatura/status.
                _logger.LogWarning(
                    "asaas.reconcile.divergencia assinatura={AssinaturaId} medico={Medico} local={Local} asaas={Asaas} esperado={Esperado}",
                    a.AssinaturaId, a.MedicoNome, a.StatusLocal, statusAsaas, esperado);
            }
        }

        if (divergentes > 0)
            _logger.LogWarning(
                "asaas.reconcile.resumo verificadas={Total} divergencias={Div} indisponiveis={Ind} — correção é manual (GET /api/v1/admin/asaas/reconciliacao)",
                assinaturas.Count, divergentes, indisponiveis);
        else
            _logger.LogInformation(
                "asaas.reconcile.ok verificadas={Total} indisponiveis={Ind}", assinaturas.Count, indisponiveis);
    }
}
