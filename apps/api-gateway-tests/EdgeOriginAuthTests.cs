using System.Net;
using System.Text;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Xunit;

namespace ApiGateway.Tests;

/// <summary>
/// Middleware de edge origin auth (ADR-074): quando EDGE_AUTH_SECRET está setado, todo
/// request exige o header `X-Edge-Auth` (prova de origem do BFF na Vercel), EXCETO os
/// callers públicos legítimos (health/ready, webhook do Asaas, OpenAPI, preflight) e as
/// chamadas internas com Bearer ${INTERNAL_API_TOKEN}.
///
/// Factory PRÓPRIA (NÃO usa o TenantIsolationFixture) porque o segredo muda o comportamento
/// global — não pode vazar pros outros testes, que rodam sem o header. Não precisa de
/// Postgres/Testcontainers: removemos os IHostedService (AsaasReconcile tocaria o DB no boot)
/// e os casos cobertos curto-circuitam no middleware, antes da authn/DbContext. DSN é dummy
/// (só precisa parsear no boot, nunca conecta).
/// </summary>
public sealed class EdgeOriginAuthTests : IDisposable
{
    private const string Secret = "edge-secret-de-teste-3f8a";
    private const string PreviousSecret = "edge-secret-anterior-7d2e";
    private const string InternalToken = "internal-token-de-teste-9c1b";

    private readonly WebApplicationFactory<Program> _factory = new WebApplicationFactory<Program>()
        .WithWebHostBuilder(b =>
        {
            b.UseEnvironment("Testing");
            b.UseSetting("POSTGRES_DSN", "Host=localhost;Port=5432;Database=t;Username=t;Password=t");
            b.UseSetting("JWT_SECRET", "teste-jwt-secret-com-mais-de-32-caracteres-aqui-ok");
            b.UseSetting("INTERNAL_API_TOKEN", InternalToken);
            b.UseSetting("EDGE_AUTH_SECRET", Secret);
            b.UseSetting("EDGE_AUTH_SECRET_PREVIOUS", PreviousSecret);
            // Remove background services (AsaasReconcile tocaria o DB inexistente no boot).
            b.ConfigureServices(s => s.RemoveAll<IHostedService>());
        });

    [Fact]
    public async Task RotaProtegida_SemHeader_403()
    {
        var res = await _factory.CreateClient().GetAsync("/api/v1/pacientes");
        Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
    }

    [Fact]
    public async Task RotaProtegida_HeaderErrado_403()
    {
        var c = _factory.CreateClient();
        c.DefaultRequestHeaders.Add("X-Edge-Auth", "errado");
        Assert.Equal(HttpStatusCode.Forbidden, (await c.GetAsync("/api/v1/pacientes")).StatusCode);
    }

    [Fact]
    public async Task RotaProtegida_HeaderCorreto_PassaDoEdge()
    {
        // Passou da camada de origem → cai na authn (sem JWT = 401), nunca 403 do edge.
        var c = _factory.CreateClient();
        c.DefaultRequestHeaders.Add("X-Edge-Auth", Secret);
        Assert.NotEqual(HttpStatusCode.Forbidden, (await c.GetAsync("/api/v1/pacientes")).StatusCode);
    }

    [Fact]
    public async Task SegredoAnterior_TambemPassa()
    {
        // Rotação zero-downtime: o valor anterior é aceito durante a janela.
        var c = _factory.CreateClient();
        c.DefaultRequestHeaders.Add("X-Edge-Auth", PreviousSecret);
        Assert.NotEqual(HttpStatusCode.Forbidden, (await c.GetAsync("/api/v1/pacientes")).StatusCode);
    }

    [Fact]
    public async Task InternalToken_BypassaOEdge()
    {
        // Worker interno (Bearer ${INTERNAL_API_TOKEN}) não precisa do header de origem.
        var c = _factory.CreateClient();
        c.DefaultRequestHeaders.Add("Authorization", $"Bearer {InternalToken}");
        Assert.NotEqual(HttpStatusCode.Forbidden, (await c.GetAsync("/api/v1/pacientes")).StatusCode);
    }

    [Fact]
    public async Task Health_Exempt_SemHeader_Ok()
    {
        Assert.Equal(HttpStatusCode.OK, (await _factory.CreateClient().GetAsync("/health")).StatusCode);
    }

    [Fact]
    public async Task AsaasWebhook_Exempt_SemHeader_NaoEh403()
    {
        // Webhook tem auth própria (asaas-access-token) → exempt do edge; nunca 403 aqui.
        var res = await _factory.CreateClient()
            .PostAsync("/api/v1/asaas/webhook", new StringContent("{}", Encoding.UTF8, "application/json"));
        Assert.NotEqual(HttpStatusCode.Forbidden, res.StatusCode);
    }

    public void Dispose() => _factory.Dispose();
}
