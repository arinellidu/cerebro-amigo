using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Npgsql;
using Xunit;

namespace ApiGateway.Tests;

/// <summary>
/// Regressão de isolamento de tenant (médico A NUNCA acessa dado do paciente do
/// médico B). Cobre os 7 IDOR cross-tenant achados em 2026-06-08 + controles
/// positivos (o mesmo endpoint funciona DENTRO do próprio tenant) — senão um
/// "nega tudo" passaria por engano.
/// </summary>
[Collection("tenant")]
public class TenantIsolationTests(TenantIsolationFixture fx)
{
    // ── prescrições: leitura ──

    [Fact]
    public async Task GetPrescricoes_CrossTenant_NaoVazaDadoDoPacienteAlheio()
    {
        var client = fx.ClientForMedico(fx.UsuarioA);
        var resp = await client.GetAsync($"/api/v1/prescricoes/paciente/{fx.PacienteB}");

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadAsStringAsync();
        Assert.DoesNotContain("Sertralina", body);          // medicamento do paciente B
        Assert.Equal(0, JsonArrayLength(body));
    }

    [Fact]
    public async Task GetPrescricoes_ProprioPaciente_RetornaDado()
    {
        var client = fx.ClientForMedico(fx.UsuarioA);
        var resp = await client.GetAsync($"/api/v1/prescricoes/paciente/{fx.PacienteA}");

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadAsStringAsync();
        Assert.Contains("Escitalopram", body);              // medicamento do paciente A
    }

    [Fact]
    public async Task GetHistorico_CrossTenant_NaoVazaTimelineAlheia()
    {
        var client = fx.ClientForMedico(fx.UsuarioA);
        var resp = await client.GetAsync($"/api/v1/prescricoes/paciente/{fx.PacienteB}/historico");

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadAsStringAsync();
        Assert.DoesNotContain("Sertralina", body);
        Assert.Equal(0, JsonArrayLength(body));
    }

    // ── prescrições: escrita ──

    [Fact]
    public async Task PutPrescricao_CrossTenant_NaoAlteraDoseAlheia()
    {
        var client = fx.ClientForMedico(fx.UsuarioA);
        var resp = await client.PutAsJsonAsync($"/api/v1/prescricoes/{fx.PrescricaoB}", new
        {
            medicamento = "HACKEADO",
            doseDescricao = "9x ao dia",
            horarios = new[] { "08:00" },
        });

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
        Assert.Equal("Sertralina 50mg", await ScalarAsync(
            "SELECT medicamento FROM prescricoes WHERE id = @id", fx.PrescricaoB));
    }

    [Fact]
    public async Task PatchDesativar_CrossTenant_NaoEncerraMedicacaoAlheia()
    {
        var client = fx.ClientForMedico(fx.UsuarioA);
        var resp = await client.PatchAsync(
            $"/api/v1/prescricoes/{fx.PrescricaoB}/desativar", content: null);

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
        Assert.Equal(true, await ScalarAsync(
            "SELECT ativa FROM prescricoes WHERE id = @id", fx.PrescricaoB));
    }

    [Fact]
    public async Task PostPrescricao_ParaPacienteDeOutroMedico_Forbidden()
    {
        var client = fx.ClientForMedico(fx.UsuarioA);
        var resp = await client.PostAsJsonAsync("/api/v1/prescricoes/", new
        {
            pacienteId = fx.PacienteB,
            medicamento = "INJETADO",
            doseDescricao = "1x",
            horarios = new[] { "08:00" },
        });

        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
        Assert.Equal(1L, await ScalarAsync(
            "SELECT count(*) FROM prescricoes WHERE paciente_id = @id", fx.PacienteB));
    }

    // ── notificações ──

    [Fact]
    public async Task MarcarLida_CrossTenant_NaoMexeNaNotificacaoAlheia()
    {
        var client = fx.ClientForMedico(fx.UsuarioA);
        await client.PostAsync($"/api/v1/notificacoes/{fx.NotificacaoB}/marcar-lida", content: null);

        // A propriedade de segurança é o estado no banco: continua não-lida.
        Assert.Equal(false, await ScalarAsync(
            "SELECT lida FROM notificacoes_medico WHERE id = @id", fx.NotificacaoB));
    }

    // ── magic-link (account takeover) ──

    [Fact]
    public async Task MagicLink_CrossTenant_NaoGeraLinkDePacienteAlheio()
    {
        var client = fx.ClientForMedico(fx.UsuarioA);
        var resp = await client.PostAsJsonAsync("/api/v1/auth/paciente/magic-link", new
        {
            email = fx.PacienteBEmail,
            proposito = "primeiro_acesso",
        });

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task MagicLink_ProprioPaciente_GeraLink()
    {
        var client = fx.ClientForMedico(fx.UsuarioB);
        var resp = await client.PostAsJsonAsync("/api/v1/auth/paciente/magic-link", new
        {
            email = fx.PacienteBEmail,
            proposito = "primeiro_acesso",
        });

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    }

    // ── helpers ──

    private static int JsonArrayLength(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.ValueKind == JsonValueKind.Array
            ? doc.RootElement.GetArrayLength()
            : -1;
    }

    private async Task<object?> ScalarAsync(string sql, Guid id)
    {
        await using var conn = await fx.OpenDbAsync();
        await using var cmd = new NpgsqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("id", id);
        return await cmd.ExecuteScalarAsync();
    }
}
