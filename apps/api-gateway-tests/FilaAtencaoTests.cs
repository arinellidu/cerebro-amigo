using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Npgsql;
using Xunit;

namespace ApiGateway.Tests;

/// <summary>
/// Fila de atenção com deltas — agregação factual de mudanças recentes (escala,
/// humor, adesão) + isolamento de tenant. Sem interpretação clínica.
/// </summary>
[Collection("tenant")]
public class FilaAtencaoTests(TenantIsolationFixture fx)
{
    [Fact]
    public async Task GetFilaAtencao_RetornaFormatoComItensEDeltas()
    {
        var client = fx.ClientForMedico(fx.UsuarioA);
        var resp = await client.GetAsync("/api/v1/fila-atencao");

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var json = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(JsonValueKind.Object, json.ValueKind);
        Assert.True(json.TryGetProperty("itens", out var itens));
        Assert.True(json.TryGetProperty("deltas", out var deltas));
        Assert.Equal(JsonValueKind.Array, itens.ValueKind);
        Assert.Equal(JsonValueKind.Array, deltas.ValueKind);
    }

    [Fact]
    public async Task GetFilaAtencao_Phq9PioraApareceEmDeltas()
    {
        await SeedPhq9PioraAsync(fx, fx.PacienteA, baseline: 8, atual: 14);

        var client = fx.ClientForMedico(fx.UsuarioA);
        var json = await client.GetFromJsonAsync<JsonElement>("/api/v1/fila-atencao");

        var deltas = json.GetProperty("deltas");
        var paciente = deltas.EnumerateArray()
            .FirstOrDefault(d => d.GetProperty("pacienteId").GetString() == fx.PacienteA.ToString());
        Assert.NotEqual(default, paciente);

        var titulos = paciente.GetProperty("sinais").EnumerateArray()
            .Select(s => s.GetProperty("titulo").GetString())
            .ToList();
        Assert.Contains(titulos, t => t != null && t.Contains("PHQ-9: 8 → 14"));
        Assert.True(paciente.GetProperty("scorePiora").GetInt32() > 0);
    }

    [Fact]
    public async Task GetFilaAtencao_DeltaHumorNegativoApareceEmDeltas()
    {
        await SeedHumorPioraAsync(fx, fx.PacienteA);

        var client = fx.ClientForMedico(fx.UsuarioA);
        var json = await client.GetFromJsonAsync<JsonElement>("/api/v1/fila-atencao");

        var paciente = json.GetProperty("deltas").EnumerateArray()
            .FirstOrDefault(d => d.GetProperty("pacienteId").GetString() == fx.PacienteA.ToString());
        Assert.NotEqual(default, paciente);

        var tipos = paciente.GetProperty("sinais").EnumerateArray()
            .Select(s => s.GetProperty("tipo").GetString())
            .ToList();
        Assert.Contains("humor", tipos);
    }

    [Fact]
    public async Task GetFilaAtencao_CrossTenant_NaoVazaDeltaDeOutroMedico()
    {
        await SeedPhq9PioraAsync(fx, fx.PacienteB, baseline: 5, atual: 12);

        var client = fx.ClientForMedico(fx.UsuarioA);
        var json = await client.GetFromJsonAsync<JsonElement>("/api/v1/fila-atencao");

        var ids = json.GetProperty("deltas").EnumerateArray()
            .Select(d => d.GetProperty("pacienteId").GetString())
            .ToList();
        Assert.DoesNotContain(fx.PacienteB.ToString(), ids);
    }

    [Fact]
    public async Task GetFilaAtencao_PacienteEmCrise_NaoApareceEmDeltas()
    {
        await SeedPhq9PioraAsync(fx, fx.PacienteA, baseline: 7, atual: 15);
        await using (var conn = await fx.OpenDbAsync())
        {
            await using var cmd = new NpgsqlCommand(
                "UPDATE pacientes SET automacao_pausada = TRUE WHERE cliente_id = @id", conn);
            cmd.Parameters.AddWithValue("id", fx.PacienteA);
            await cmd.ExecuteNonQueryAsync();
        }

        var client = fx.ClientForMedico(fx.UsuarioA);
        var json = await client.GetFromJsonAsync<JsonElement>("/api/v1/fila-atencao");

        var emCrise = json.GetProperty("itens").EnumerateArray()
            .Any(i => i.GetProperty("tipo").GetString() == "crise"
                   && i.GetProperty("pacienteId").GetString() == fx.PacienteA.ToString());
        Assert.True(emCrise);

        var emDelta = json.GetProperty("deltas").EnumerateArray()
            .Any(d => d.GetProperty("pacienteId").GetString() == fx.PacienteA.ToString());
        Assert.False(emDelta);
    }

    private static async Task<Guid> Phq9IdAsync(NpgsqlConnection conn)
    {
        await using var cmd = new NpgsqlCommand(
            "SELECT id FROM questionarios WHERE codigo = 'phq9' LIMIT 1", conn);
        return (Guid)(await cmd.ExecuteScalarAsync())!;
    }

    private static async Task SeedPhq9PioraAsync(
        TenantIsolationFixture fx, Guid pacienteId, int baseline, int atual)
    {
        await using var conn = await fx.OpenDbAsync();
        var qId = await Phq9IdAsync(conn);
        var agora = DateTime.UtcNow;

        async Task Insert(int score, DateTime quando)
        {
            await using var cmd = new NpgsqlCommand(@"
                INSERT INTO questionarios_respostas (paciente_id, questionario_id, respostas, score_total, respondido_em)
                VALUES (@pid, @qid, '{}'::jsonb, @score, @quando)", conn);
            cmd.Parameters.AddWithValue("pid", pacienteId);
            cmd.Parameters.AddWithValue("qid", qId);
            cmd.Parameters.AddWithValue("score", score);
            cmd.Parameters.AddWithValue("quando", quando);
            await cmd.ExecuteNonQueryAsync();
        }

        await Insert(baseline, agora.AddDays(-10));
        await Insert(atual, agora.AddDays(-1));
    }

    private static async Task SeedHumorPioraAsync(TenantIsolationFixture fx, Guid pacienteId)
    {
        await using var conn = await fx.OpenDbAsync();
        var agora = DateTime.UtcNow;

        async Task InsertHumor(int humor, DateTime quando)
        {
            await using var cmd = new NpgsqlCommand(@"
                INSERT INTO sintomas (paciente_id, humor, registrado_em)
                VALUES (@pid, @humor, @quando)", conn);
            cmd.Parameters.AddWithValue("pid", pacienteId);
            cmd.Parameters.AddWithValue("humor", humor);
            cmd.Parameters.AddWithValue("quando", quando);
            await cmd.ExecuteNonQueryAsync();
        }

        // Quinzena anterior: humor alto (média ~8)
        for (var i = 0; i < 3; i++)
            await InsertHumor(8, agora.AddDays(-20 + i));
        // Quinzena recente: humor baixo (média ~4) → delta ≈ −4
        for (var i = 0; i < 3; i++)
            await InsertHumor(4, agora.AddDays(-5 + i));
    }
}
