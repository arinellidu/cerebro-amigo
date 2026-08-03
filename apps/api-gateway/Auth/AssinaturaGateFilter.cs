using System.Security.Claims;
using ApiGateway.Data;
using ApiGateway.Services;
using Microsoft.EntityFrameworkCore;

namespace ApiGateway.Auth;

/// <summary>
/// Gate de assinatura (ADR-055, Fase D). Bloqueia endpoints de DASHBOARD do médico
/// quando a assinatura não está liberada (pendente vencido / suspensa / cancelada) → 402.
///
/// OPT-IN: só roda nos grupos decorados com <c>.RequireAssinaturaAtiva()</c>. Endpoints
/// de crise (/api/v1/crise), alerta ao médico (/api/v1/notificacoes), portal do paciente
/// (/api/v1/portal/paciente/*), internos e auth NÃO recebem o filtro → nunca são gateados.
///
/// FAIL-OPEN clínico (clinical-safety regra #2/#3): erro de DB, médico/assinatura ausente,
/// sub inválido ou requisição não-médica → libera (await next). Bloquear por engano (cegar
/// o médico para uma crise de paciente criado no prazo) é pior que liberar uma tela a mais.
/// </summary>
public sealed class AssinaturaGateFilter : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(
        EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var http = context.HttpContext;
        var user = http.User;

        // Só gateia médico autenticado. Paciente / anônimo / owner / admin passam direto.
        if (user?.Identity?.IsAuthenticated != true || !user.IsInRole("medico"))
            return await next(context);

        try
        {
            var sub = user.FindFirst("sub")?.Value;
            if (!Guid.TryParse(sub, out var usuarioId))
                return await next(context); // sem sub válido → fail-open

            var db = http.RequestServices.GetRequiredService<AppDbContext>();
            var row = await db.Database.SqlQueryRaw<AssinaturaGateRow>(@"
                SELECT a.status AS status,
                       a.prazo_pagamento_ate AS prazo_pagamento_ate,
                       a.trial_ate AS trial_ate
                FROM medicos m
                LEFT JOIN assinaturas a ON a.medico_id = m.id
                WHERE m.usuario_id = {0}", usuarioId).FirstOrDefaultAsync();

            // Sem médico ou sem assinatura → fail-open (não bloqueia).
            if (row is null) return await next(context);

            var sit = AssinaturaGate.Avaliar(
                row.Status, row.PrazoPagamentoAte, row.TrialAte, DateTime.UtcNow);
            if (sit.Liberado) return await next(context);

            // Bloqueado: 402 + corpo estruturado p/ a UI mostrar o paywall / checkout.
            return Results.Json(new
            {
                error = "assinatura_inativa",
                motivo = sit.Motivo,
                prazoPagamentoAte = row.PrazoPagamentoAte,
                checkoutUrl = "/dashboard/minha-assinatura",
            }, statusCode: StatusCodes.Status402PaymentRequired);
        }
        catch
        {
            // Fail-open clínico: nunca bloquear por erro de infra/DB.
            return await next(context);
        }
    }
}

internal sealed record AssinaturaGateRow(string? Status, DateTime? PrazoPagamentoAte, DateTime? TrialAte);

/// <summary>Marcador de metadata (ADR-055): este grupo tem o gate de assinatura.
/// Introspectável via EndpointDataSource pelo teste de cobertura de write-access (R2).</summary>
public sealed class AssinaturaGated { }

public static class AssinaturaGateExtensions
{
    /// <summary>
    /// Aplica o gate de assinatura (ADR-055) a um grupo de endpoints de DASHBOARD do médico.
    /// NÃO usar em grupos de crise, portal do paciente, notificações de alerta ou auth.
    /// </summary>
    public static RouteGroupBuilder RequireAssinaturaAtiva(this RouteGroupBuilder group)
    {
        group.AddEndpointFilter<AssinaturaGateFilter>();
        group.WithMetadata(new AssinaturaGated());
        return group;
    }
}
