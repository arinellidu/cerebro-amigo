using ApiGateway.Data;
using ApiGateway.Services;
using Microsoft.EntityFrameworkCore;

namespace ApiGateway.Auth;

/// <summary>
/// Gate de FEATURE por plano (ADR-059). Camada SEPARADA do AssinaturaGate: o
/// AssinaturaGate decide se o dashboard está liberado (pagamento); este decide se o
/// PLANO do médico inclui uma feature premium (camada de IA = Pro). Acesso liberado
/// ≠ feature inclusa.
///
/// OPT-IN: só roda onde decorado com <c>.RequireFeature("key")</c> — os grupos da
/// camada de IA (insights dos agentes, RAG, escriba, briefing IA). Core, crise,
/// portal e auth NUNCA recebem o filtro.
///
/// Plano sem a feature → 402 + `{error:"feature_requer_pro"}` para a UI abrir o
/// upsell. Plano nulo/legado/desconhecido = Essencial (sem IA) → bloqueia a IA.
/// FAIL-OPEN só em erro de infra/DB (não bloquear feature por falha técnica).
/// </summary>
public sealed class FeatureGateFilter(string featureKey) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(
        EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var http = context.HttpContext;
        var user = http.User;

        // Só gateia médico autenticado. Paciente / anônimo / owner / admin passam direto.
        if (user?.Identity?.IsAuthenticated != true || !user.IsInRole("medico"))
            return await next(context);

        string? plano;
        try
        {
            var sub = user.FindFirst("sub")?.Value;
            if (!Guid.TryParse(sub, out var usuarioId))
                return await next(context); // sem sub válido → fail-open

            var db = http.RequestServices.GetRequiredService<AppDbContext>();
            plano = await db.Database.SqlQueryRaw<string?>(@"
                SELECT a.plano AS ""Value""
                FROM medicos m
                LEFT JOIN assinaturas a ON a.medico_id = m.id
                WHERE m.usuario_id = {0}", usuarioId).FirstOrDefaultAsync();
        }
        catch
        {
            // Fail-open só em erro de infra/DB — não bloquear feature por falha técnica.
            return await next(context);
        }

        if (PlanCatalog.TemFeature(plano, featureKey))
            return await next(context);

        // Plano não inclui a feature (camada de IA = Pro). 402 + upsell.
        return Results.Json(new
        {
            error = "feature_requer_pro",
            feature = featureKey,
            checkoutUrl = "/dashboard/financeiro",
        }, statusCode: StatusCodes.Status402PaymentRequired);
    }
}

/// <summary>Marcador de metadata (ADR-059): este endpoint/grupo é gateado por feature de IA.
/// Em trial (plano nulo) o FeatureGate já bloqueia tudo → conta como protegido na cobertura (R2).</summary>
public sealed class FeatureGated { }

public static class FeatureGateExtensions
{
    /// <summary>Exige que o plano do médico inclua a feature (ADR-059). Grupo de endpoints.</summary>
    public static RouteGroupBuilder RequireFeature(this RouteGroupBuilder group, string featureKey)
    {
        group.AddEndpointFilter(new FeatureGateFilter(featureKey));
        group.WithMetadata(new FeatureGated());
        return group;
    }

    /// <summary>Exige a feature num endpoint específico (ex.: /briefing).</summary>
    public static RouteHandlerBuilder RequireFeature(this RouteHandlerBuilder builder, string featureKey)
    {
        builder.AddEndpointFilter(new FeatureGateFilter(featureKey));
        builder.WithMetadata(new FeatureGated());
        return builder;
    }
}
