using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using ApiGateway.Services;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Xunit;

namespace ApiGateway.Tests;

/// <summary>
/// Smoke E2E (Postgres real + migrations) dos DOIS fluxos de recuperação de senha
/// do paciente, com o handler HTTP do ResendClient STUBADO (nenhum e-mail real sai):
///
///  Fluxo 1 — Médico reenvia (POST /auth/paciente/magic-link, autenticado):
///    a) e-mail OK  → resposta { enviado:true, url:null } (médico NÃO vê a URL)
///    b) e-mail FALHA → fallback { enviado:false, url:... } → paciente define senha
///       em /magic-validar → /login com a senha nova funciona
///    c) cross-tenant (médico A pede link do paciente do médico B) → 404
///
///  Fluxo 2 — "Esqueci minha senha" (POST /auth/paciente/esqueci-senha, anônimo):
///    gera magic_link 'recuperacao' p/ o paciente E, p/ e-mail inexistente, responde
///    o MESMO 202 sem criar nada (anti-enumeração).
/// </summary>
[Collection("tenant")]
public sealed class MagicLinkRecuperacaoTests : IDisposable
{
    // Semeado pela TenantIsolationFixture (clientes.email do paciente do médico A).
    private const string PacienteAEmail = "paciente.a@example.com";

    private readonly TenantIsolationFixture _fx;
    private readonly WebApplicationFactory<Program> _factory;

    public MagicLinkRecuperacaoTests(TenantIsolationFixture fx)
    {
        _fx = fx;
        // Factory derivado: troca o primary handler do ResendClient por um stub →
        // SendAsync nunca toca a rede. StubResendHandler.Succeeds controla 2xx vs erro.
        _factory = fx.Factory.WithWebHostBuilder(b =>
            b.ConfigureTestServices(s =>
                s.AddHttpClient<ResendClient>()
                 .ConfigurePrimaryHttpMessageHandler(() => new StubResendHandler())));
    }

    public void Dispose() => _factory.Dispose();

    private static StringContent Json(string s) => new(s, Encoding.UTF8, "application/json");

    private HttpClient MedicoA()
    {
        var c = _factory.CreateClient();
        c.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", _fx.TokenForMedico(_fx.UsuarioA));
        return c;
    }

    private HttpClient Anon() => _factory.CreateClient();

    private static string ExtrairToken(string url)
    {
        var i = url.IndexOf("token=", StringComparison.Ordinal);
        Assert.True(i >= 0, $"URL sem token: {url}");
        return url[(i + "token=".Length)..];
    }

    private async Task<int> ContarRecuperacaoAtiva(Guid pacienteId)
    {
        await using var conn = await _fx.OpenDbAsync();
        await using var cmd = new NpgsqlCommand(
            "SELECT COUNT(*) FROM magic_links WHERE paciente_id=@p AND proposito='recuperacao' AND usado_em IS NULL",
            conn);
        cmd.Parameters.AddWithValue("p", pacienteId);
        return Convert.ToInt32(await cmd.ExecuteScalarAsync());
    }

    private async Task<long> ContarMagicLinksTotal()
    {
        await using var conn = await _fx.OpenDbAsync();
        await using var cmd = new NpgsqlCommand("SELECT COUNT(*) FROM magic_links", conn);
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    // ── FLUXO 1a: e-mail enviado → resposta NÃO vaza a URL ──────────────────
    [Fact]
    public async Task MagicLink_EmailEnviado_NaoVazaUrl()
    {
        StubResendHandler.Succeeds = true;

        var resp = await MedicoA().PostAsync("/api/v1/auth/paciente/magic-link",
            Json($"{{\"email\":\"{PacienteAEmail}\",\"proposito\":\"recuperacao\"}}"));

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        var root = doc.RootElement;
        Assert.True(root.GetProperty("enviado").GetBoolean());
        Assert.Equal(PacienteAEmail, root.GetProperty("email").GetString());
        Assert.Equal(JsonValueKind.Null, root.GetProperty("url").ValueKind);
    }

    // ── FLUXO 1b: e-mail falha → fallback URL → define senha → login ─────────
    [Fact]
    public async Task MagicLink_FallbackUrl_DefineSenha_E_Loga()
    {
        StubResendHandler.Succeeds = false; // força fallback (URL no corpo)

        var resp = await MedicoA().PostAsync("/api/v1/auth/paciente/magic-link",
            Json($"{{\"email\":\"{PacienteAEmail}\",\"proposito\":\"recuperacao\"}}"));
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        Assert.False(doc.RootElement.GetProperty("enviado").GetBoolean());
        var url = doc.RootElement.GetProperty("url").GetString();
        Assert.False(string.IsNullOrEmpty(url));
        var token = ExtrairToken(url!);

        // paciente abre o link e define a PRÓPRIA senha
        var validar = await Anon().PostAsync("/api/v1/auth/paciente/magic-validar",
            Json($"{{\"token\":\"{token}\",\"novaSenha\":\"senhaForte123\"}}"));
        Assert.Equal(HttpStatusCode.OK, validar.StatusCode);
        using var vdoc = JsonDocument.Parse(await validar.Content.ReadAsStringAsync());
        Assert.False(string.IsNullOrEmpty(vdoc.RootElement.GetProperty("token").GetString()));

        // login com a senha recém-definida
        var login = await Anon().PostAsync("/api/v1/auth/paciente/login",
            Json($"{{\"email\":\"{PacienteAEmail}\",\"senha\":\"senhaForte123\"}}"));
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        using var ldoc = JsonDocument.Parse(await login.Content.ReadAsStringAsync());
        Assert.False(string.IsNullOrEmpty(ldoc.RootElement.GetProperty("token").GetString()));
    }

    // ── FLUXO 1c: cross-tenant → 404 ────────────────────────────────────────
    [Fact]
    public async Task MagicLink_CrossTenant_404()
    {
        var resp = await MedicoA().PostAsync("/api/v1/auth/paciente/magic-link",
            Json($"{{\"email\":\"{_fx.PacienteBEmail}\",\"proposito\":\"recuperacao\"}}"));
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    // ── FLUXO 2: esqueci-senha gera link + anti-enumeração ──────────────────
    [Fact]
    public async Task EsqueciSenha_GeraLink_E_AntiEnumeracao()
    {
        StubResendHandler.Succeeds = true;

        // paciente real → +1 link de recuperação ativo
        var antes = await ContarRecuperacaoAtiva(_fx.PacienteA);
        var ok = await Anon().PostAsync("/api/v1/auth/paciente/esqueci-senha",
            Json($"{{\"email\":\"{PacienteAEmail}\"}}"));
        Assert.Equal(HttpStatusCode.Accepted, ok.StatusCode);
        Assert.Equal(antes + 1, await ContarRecuperacaoAtiva(_fx.PacienteA));

        // e-mail inexistente → MESMO 202, NENHUMA linha criada (anti-enum)
        var totalAntes = await ContarMagicLinksTotal();
        var resp = await Anon().PostAsync("/api/v1/auth/paciente/esqueci-senha",
            Json("{\"email\":\"naoexiste-zzz@example.com\"}"));
        Assert.Equal(HttpStatusCode.Accepted, resp.StatusCode);
        Assert.Equal(totalAntes, await ContarMagicLinksTotal());
    }

    /// <summary>
    /// Stub do transporte HTTP do ResendClient. Não faz I/O de rede: devolve 200
    /// (envio "ok") ou 403 (falha) conforme <see cref="Succeeds"/>. Os testes da
    /// coleção rodam em série, então o campo estático é seguro aqui.
    /// </summary>
    private sealed class StubResendHandler : HttpMessageHandler
    {
        public static bool Succeeds = true;

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var resp = Succeeds
                ? new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent("{\"id\":\"stub-email-id\"}", Encoding.UTF8, "application/json"),
                }
                : new HttpResponseMessage(HttpStatusCode.Forbidden)
                {
                    Content = new StringContent("{\"message\":\"stub: envio recusado\"}", Encoding.UTF8, "application/json"),
                };
            return Task.FromResult(resp);
        }
    }
}
