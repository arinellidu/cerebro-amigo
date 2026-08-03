using ApiGateway.Auth;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace ApiGateway.Tests;

/// <summary>
/// Cobertura do gate de escrita do trial (ADR-065, mitigação R2). Dois invariantes:
///  (1) todo grupo de mutação JÁ gateado por assinatura tem RequireWriteAccess (ou
///      RequireFeature, que já bloqueia o trial pelo plano nulo), exceto a allowlist
///      de pacientes (lock-in).
///  (2) NENHUM endpoint de mutação /api/v1 fica sem gate de assinatura, exceto as
///      superfícies legitimamente isentas (crise/escalação/portal/auth/identidade/
///      anônimas/admin). Pega o buraco que (1) não pegaria: um grupo de escrita novo
///      a que se esqueça de aplicar RequireAssinaturaAtiva por completo.
/// Introspecciona o EndpointDataSource pela metadata marcadora.
/// </summary>
[Collection("tenant")]
public sealed class WriteAccessCoverageTests
{
    private readonly TenantIsolationFixture _fx;
    public WriteAccessCoverageTests(TenantIsolationFixture fx) => _fx = fx;

    private static readonly string[] VerbosMutacao = { "POST", "PUT", "PATCH", "DELETE" };

    // Allowlist de escrita no trial: só pacientes CRUD (o cap é tratado no handler).
    private static readonly HashSet<string> PacientesAllowlist = new()
    {
        "api/v1/pacientes", "api/v1/pacientes/", "api/v1/pacientes/importar",
    };

    // Superfícies de mutação /api/v1 que legitimamente NÃO têm gate de assinatura:
    // segurança clínica (crise/escalação) + portal do paciente + identidade/auth +
    // config do próprio médico + rotas anônimas (webhook/newsletter) + admin (gate
    // próprio por role) + push de check-in do paciente.
    private static readonly string[] IsentosPorPrefixo =
    {
        // Segurança clínica + portal + identidade/auth + anônimas:
        "api/v1/auth", "api/v1/crise", "api/v1/escalacoes", "api/v1/portal",
        "api/v1/newsletter",
        // Conta do próprio médico (ADR-066): config, senha, foto, exclusão (me/*) e
        // cofre de documentos (conta/*). São ações de conta/segurança/LGPD — não-clínicas
        // e não-paywall por design (o médico pode trocar senha / pedir exclusão bloqueado).
        "api/v1/me", "api/v1/conta",
        "api/v1/notificacoes", "api/v1/asaas", "api/v1/checkins", "api/v1/seed",
        "api/v1/paciente", "api/v1/admin",
        // Checkout/billing (o médico PRECISA pagar mesmo bloqueado):
        "api/v1/minha-assinatura", "api/v1/cobrancas",
        // Leitura/consumo de baixo risco e IA-adjacentes (config moot sem IA):
        "api/v1/prontuario",                      // marcar áudio do paciente como ouvido
        "api/v1/prompts", "api/v1/agentes",       // customização/monitor de IA (inócuo sem plano)
        "api/v1/prescricoes/checar-interacoes",   // checagem (POST-shaped read) de interações
    };

    private static IEnumerable<(string rota, IReadOnlyList<string> verbos, RouteEndpoint ep)> MutacoesApiV1(
        EndpointDataSource eds)
    {
        foreach (var ep in eds.Endpoints.OfType<RouteEndpoint>())
        {
            var verbos = ep.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods
                ?? (IReadOnlyList<string>)Array.Empty<string>();
            if (!verbos.Any(v => VerbosMutacao.Contains(v))) continue;
            var rota = (ep.RoutePattern.RawText ?? "").TrimStart('/');
            if (!rota.StartsWith("api/v1/")) continue;
            yield return (rota, verbos, ep);
        }
    }

    [Fact]
    public void GruposGateadosPorAssinatura_TemReadOnlyOuFeature()
    {
        var eds = _fx.Services.GetRequiredService<EndpointDataSource>();
        var faltando = new List<string>();

        foreach (var (rota, verbos, ep) in MutacoesApiV1(eds))
        {
            if (ep.Metadata.GetMetadata<AssinaturaGated>() is null) continue; // (2) cuida disso
            if (PacientesAllowlist.Contains(rota)) continue;

            var temReadOnly = ep.Metadata.GetMetadata<ReadOnlyTrialGated>() is not null;
            var temFeature = ep.Metadata.GetMetadata<FeatureGated>() is not null;
            if (!temReadOnly && !temFeature)
                faltando.Add($"{string.Join(",", verbos)} {rota}");
        }

        Assert.True(faltando.Count == 0,
            "Endpoints de mutação gateados por assinatura SEM RequireWriteAccess/RequireFeature " +
            "(vazam escrita no trial — ADR-065 R2):\n" + string.Join("\n", faltando));
    }

    [Fact]
    public void NenhumMutadorMedico_FicaSemGateDeAssinatura()
    {
        var eds = _fx.Services.GetRequiredService<EndpointDataSource>();
        var semGate = new List<string>();

        foreach (var (rota, verbos, ep) in MutacoesApiV1(eds))
        {
            if (ep.Metadata.GetMetadata<AssinaturaGated>() is not null) continue;  // gateado por assinatura, ok
            if (ep.Metadata.GetMetadata<FeatureGated>() is not null) continue;     // IA-gated: o trial (plano nulo) já não acessa
            // Match por BOUNDARY de segmento (não StartsWith solto) p/ não mascarar
            // um endpoint novo cujo nome colida no prefixo (ex.: agentes vs agentes-x).
            if (IsentosPorPrefixo.Any(p => rota == p || rota.StartsWith(p + "/"))) continue;
            semGate.Add($"{string.Join(",", verbos)} {rota}");
        }

        Assert.True(semGate.Count == 0,
            "Endpoints de mutação /api/v1 SEM gate de assinatura e fora da allowlist de isentos " +
            "(possível buraco de paywall/trial — ADR-065 R2). Gatear ou adicionar à allowlist:\n" +
            string.Join("\n", semGate));
    }
}
