using ApiGateway.Data;
using ApiGateway.Services;
using Microsoft.EntityFrameworkCore;

namespace ApiGateway.Auth;

/// <summary>
/// Gate de ESCRITA do trial de aquisição (ADR-065). TERCEIRA camada, na mesma linha
/// das outras duas: AssinaturaGate decide se o dashboard abre (pagamento); FeatureGate
/// decide se o plano inclui IA; este decide se o VERBO de escrita é permitido enquanto
/// o médico está em "trial read-only" (pendente, em prazo, sem plano pago).
///
/// Verbo-aware: GET/HEAD/OPTIONS sempre passam (leitura liberada no trial). POST/PUT/
/// PATCH/DELETE em trial read-only → 403 `read_only_trial`. Quem já pagou um plano, ou
/// está fora do trial (ativa / vencido / suspensa), passa direto.
///
/// OPT-IN: só roda nos grupos decorados com <c>.RequireWriteAccess()</c>. O grupo de
/// PACIENTES NÃO recebe o filtro de propósito (allowlist por ausência — lock-in por base;
/// o cap de quantidade é tratado no handler). Crise, escalação, portal do paciente,
/// checkout, me/config, auth e internos NUNCA recebem o filtro → garantia estrutural de
/// clinical-safety (regra #2/#3), mesma do AssinaturaGate.
///
/// FAIL-OPEN: erro de DB, médico/assinatura ausente ou requisição não-médica → libera.
/// </summary>
public sealed class ReadOnlyTrialFilter : IEndpointFilter
{
    private static readonly HashSet<string> VerbosLeitura =
        new(StringComparer.OrdinalIgnoreCase) { "GET", "HEAD", "OPTIONS" };

    public async ValueTask<object?> InvokeAsync(
        EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var http = context.HttpContext;
        var user = http.User;

        // Só gateia médico autenticado. Paciente / anônimo / owner / admin passam direto.
        if (user?.Identity?.IsAuthenticated != true || !user.IsInRole("medico"))
            return await next(context);

        // Leitura sempre liberada no trial (o objetivo é justamente o médico navegar tudo).
        if (VerbosLeitura.Contains(http.Request.Method))
            return await next(context);

        try
        {
            var sub = user.FindFirst("sub")?.Value;
            if (!Guid.TryParse(sub, out var usuarioId))
                return await next(context); // sem sub válido → fail-open

            var db = http.RequestServices.GetRequiredService<AppDbContext>();
            var sit = await TrialReadOnlyQuery.SituacaoPorUsuarioAsync(db, usuarioId);

            // Sem médico/assinatura, ou fora do trial read-only → libera a escrita.
            if (sit is null || !sit.TrialReadOnly) return await next(context);

            // Trial read-only: bloqueia mutação. 403 (não 402: está em dia, mas o verbo
            // não é permitido neste estado) + corpo p/ a UI abrir o upsell de plano.
            return Results.Json(new
            {
                error = "read_only_trial",
                checkoutUrl = "/dashboard/financeiro",
            }, statusCode: StatusCodes.Status403Forbidden);
        }
        catch
        {
            // Fail-open: nunca bloquear escrita por erro de infra/DB.
            return await next(context);
        }
    }
}

internal sealed record ReadOnlyTrialRow(
    string? Status, DateTime? PrazoPagamentoAte, DateTime? TrialAte, string? Plano);

/// <summary>
/// Consulta a situação de assinatura por usuário (JWT sub) já com o estado de trial
/// read-only derivado (ADR-065). Reusada pelo <see cref="ReadOnlyTrialFilter"/> e pelo
/// cap de pacientes no handler — uma única projeção, sem duplicar SQL.
/// </summary>
public static class TrialReadOnlyQuery
{
    public static async Task<AssinaturaSituacao?> SituacaoPorUsuarioAsync(
        AppDbContext db, Guid usuarioId)
    {
        var row = await db.Database.SqlQueryRaw<ReadOnlyTrialRow>(@"
            SELECT a.status AS status,
                   a.prazo_pagamento_ate AS prazo_pagamento_ate,
                   a.trial_ate AS trial_ate,
                   a.plano AS plano
            FROM medicos m
            LEFT JOIN assinaturas a ON a.medico_id = m.id
            WHERE m.usuario_id = {0}", usuarioId).FirstOrDefaultAsync();

        if (row is null) return null;
        return AssinaturaGate.Avaliar(
            row.Status, row.PrazoPagamentoAte, row.TrialAte, DateTime.UtcNow, row.Plano);
    }
}

/// <summary>Marcador de metadata (ADR-065): este grupo tem o gate de escrita do trial.
/// Introspectável via EndpointDataSource pelo teste de cobertura (R2).</summary>
public sealed class ReadOnlyTrialGated { }

public static class ReadOnlyTrialExtensions
{
    /// <summary>
    /// Aplica o gate de escrita do trial (ADR-065) a um grupo de endpoints de DASHBOARD.
    /// Em trial read-only, bloqueia POST/PUT/PATCH/DELETE (leitura passa). NÃO usar em
    /// pacientes (allowlist), crise, portal, checkout, me/config nem auth.
    /// </summary>
    public static RouteGroupBuilder RequireWriteAccess(this RouteGroupBuilder group)
    {
        group.AddEndpointFilter<ReadOnlyTrialFilter>();
        group.WithMetadata(new ReadOnlyTrialGated());
        return group;
    }
}
