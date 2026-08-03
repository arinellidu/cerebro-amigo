using System.Net;
using System.Text;
using Npgsql;
using Xunit;

namespace ApiGateway.Tests;

/// <summary>
/// Newsletter do médico (ADR-065). Prova que o unsubscribe ANÔNIMO por token funciona
/// SEM JWT (a tabela não tem RLS → o UPDATE por token não é bloqueado por falta de GUC
/// de tenant) e que o toggle autenticado do médico alterna a inscrição.
/// </summary>
[Collection("tenant")]
public sealed class NewsletterIntegrationTests
{
    private readonly TenantIsolationFixture _fx;
    public NewsletterIntegrationTests(TenantIsolationFixture fx) => _fx = fx;

    private static StringContent Json(string s) => new(s, Encoding.UTF8, "application/json");

    private async Task<string?> StatusDoToken(string token)
    {
        await using var conn = await _fx.OpenDbAsync();
        await using var cmd = new NpgsqlCommand(
            "SELECT status FROM newsletter_inscricoes WHERE unsub_token = @p0", conn);
        cmd.Parameters.AddWithValue("p0", token);
        return (string?)await cmd.ExecuteScalarAsync();
    }

    [Fact]
    public async Task Unsubscribe_Anonimo_PorToken_Funciona()
    {
        var token = "tok_" + Guid.NewGuid().ToString("N");
        await using (var conn = await _fx.OpenDbAsync())
        {
            await using var cmd = new NpgsqlCommand(@"
                INSERT INTO newsletter_inscricoes (email, unsub_token, status)
                VALUES (@p0, @p1, 'subscribed')", conn);
            cmd.Parameters.AddWithValue("p0", $"nl.{token}@ex.com");
            cmd.Parameters.AddWithValue("p1", token);
            await cmd.ExecuteNonQueryAsync();
        }

        var anon = _fx.AnonClient(); // SEM Authorization → prova que não depende de RLS/JWT
        var r = await anon.PostAsync("/api/v1/newsletter/unsubscribe", Json($"{{\"token\":\"{token}\"}}"));

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("unsubscribed", await StatusDoToken(token));
    }

    [Fact]
    public async Task Unsubscribe_TokenInexistente_NaoVaza_200()
    {
        var anon = _fx.AnonClient();
        var r = await anon.PostAsync("/api/v1/newsletter/unsubscribe",
            Json("{\"token\":\"nao-existe\"}"));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode); // idempotente, não revela existência
    }

    [Fact]
    public async Task Toggle_Autenticado_Alterna()
    {
        var usuario = Guid.NewGuid();
        var medico = Guid.NewGuid();
        await using (var conn = await _fx.OpenDbAsync())
        {
            async Task Exec(string sql, params object[] p)
            {
                await using var cmd = new NpgsqlCommand(sql, conn);
                for (var i = 0; i < p.Length; i++) cmd.Parameters.AddWithValue("p" + i, p[i]);
                await cmd.ExecuteNonQueryAsync();
            }
            await Exec(@"INSERT INTO usuarios (id, email, senha_hash, nome, role)
                         VALUES (@p0,@p1,'x','Médico NL','medico')", usuario, $"nl.med.{usuario:N}@ex.com");
            await Exec(@"INSERT INTO medicos (id, usuario_id, nome, crm)
                         VALUES (@p0,@p1,'Médico NL','CRM-NL')", medico, usuario);
            await Exec(@"INSERT INTO newsletter_inscricoes (medico_id, email, unsub_token, status)
                         VALUES (@p0,@p1,@p2,'subscribed')",
                medico, $"nl.med.{usuario:N}@ex.com", "tok_" + usuario.ToString("N"));
        }

        var client = _fx.ClientForMedico(usuario);

        var get1 = await client.GetAsync("/api/v1/me/newsletter");
        Assert.Equal(HttpStatusCode.OK, get1.StatusCode);
        Assert.Contains("\"inscrito\":true", await get1.Content.ReadAsStringAsync());

        var patch = await client.PatchAsync("/api/v1/me/newsletter", Json("{\"inscrito\":false}"));
        Assert.Equal(HttpStatusCode.NoContent, patch.StatusCode);

        var get2 = await client.GetAsync("/api/v1/me/newsletter");
        Assert.Contains("\"inscrito\":false", await get2.Content.ReadAsStringAsync());
    }
}
