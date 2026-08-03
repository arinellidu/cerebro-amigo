using System.Net;
using System.Net.Http.Json;
using Npgsql;
using Xunit;

namespace ApiGateway.Tests;

/// <summary>
/// Isolamento de tenant do COFRE DE DOCUMENTOS (ADR-066/migration 0052). O cofre é
/// uma superfície nova de IDOR: documento é tenant-direto por medico_id. Dois níveis:
///   - RLS no banco (role gw_test, NOBYPASSRLS): médico A nunca lê/escreve doc de B.
///   - IDOR via HTTP (gateway real): listar/baixar/deletar/registrar cross-tenant nega.
/// Controles positivos garantem que não é um "nega tudo" — o dono acessa o próprio doc.
///
/// Os caminhos felizes que dependem de SAS do Blob (download do dono) ficam de fora:
/// assinar SAS exige AZURE_STORAGE_CONNECTION_STRING, ausente no CI (ADR-082; o
/// presigner é lazy). O foco aqui é o isolamento, e todo caminho cross-tenant nega
/// ANTES de tocar o storage.
/// </summary>
[Collection("tenant")]
public class MedicoDocumentosIsolationTests(TenantIsolationFixture fx)
{
    // ── RLS no banco (tenant direto por medico_id) ──

    [Fact]
    public async Task Cofre_SemGuc_FailClosed()
    {
        await using var conn = await fx.OpenGatewayDbAsync();
        Assert.Equal(0L, await Count(conn, "medico_documentos"));
    }

    [Fact]
    public async Task Cofre_MedicoA_NaoVeDocDeB()
    {
        await using var conn = await fx.OpenGatewayDbAsync();
        await SetGuc(conn, "app.current_medico", fx.MedicoA.ToString());
        Assert.False(await Exists(conn, "medico_documentos", fx.DocB), "vazou doc de B p/ médico A");
        Assert.True(await Exists(conn, "medico_documentos", fx.DocA), "médico A deveria ver o próprio doc");
    }

    [Fact]
    public async Task Cofre_MedicoB_VeDocDeB()
    {
        await using var conn = await fx.OpenGatewayDbAsync();
        await SetGuc(conn, "app.current_medico", fx.MedicoB.ToString());
        Assert.True(await Exists(conn, "medico_documentos", fx.DocB));
        Assert.False(await Exists(conn, "medico_documentos", fx.DocA));
    }

    [Fact]
    public async Task Cofre_Bypass_VeTodos()
    {
        await using var conn = await fx.OpenGatewayDbAsync();
        await SetGuc(conn, "app.tenant_bypass", "on");
        Assert.True(await Count(conn, "medico_documentos") >= 2);
    }

    // WITH CHECK: médico A não consegue INSERIR doc no tenant de B (policy barra a escrita).
    [Fact]
    public async Task Cofre_MedicoA_NaoInsereParaB_WithCheck()
    {
        await using var conn = await fx.OpenGatewayDbAsync();
        await SetGuc(conn, "app.current_medico", fx.MedicoA.ToString());
        await using var cmd = new NpgsqlCommand(@"
            INSERT INTO medico_documentos (medico_id, direcao, tipo, titulo, s3_key)
            VALUES (@b,'enviado','contrato','injetado','medico/b/enviado/x.pdf')", conn);
        cmd.Parameters.AddWithValue("b", fx.MedicoB);
        await Assert.ThrowsAsync<PostgresException>(() => cmd.ExecuteNonQueryAsync());
    }

    // ── IDOR via HTTP (gateway real; middleware seta app.current_medico) ──

    [Fact]
    public async Task GetLista_MedicoA_NaoVeDocDeB_VeOProprio()
    {
        var client = fx.ClientForMedico(fx.UsuarioA);
        var resp = await client.GetAsync("/api/v1/conta/documentos");

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadAsStringAsync();
        Assert.Contains("Doc de A", body);
        Assert.DoesNotContain("Doc secreto de B", body);
    }

    [Fact]
    public async Task GetLista_MedicoB_VeOProprio()
    {
        var client = fx.ClientForMedico(fx.UsuarioB);
        var resp = await client.GetAsync("/api/v1/conta/documentos");

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadAsStringAsync();
        Assert.Contains("Doc secreto de B", body);
        Assert.DoesNotContain("Doc de A", body);
    }

    [Fact]
    public async Task DownloadUrl_CrossTenant_404()
    {
        var client = fx.ClientForMedico(fx.UsuarioA);
        var resp = await client.GetAsync($"/api/v1/conta/documentos/{fx.DocB}/download-url");
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task Delete_CrossTenant_NaoApaga()
    {
        var client = fx.ClientForMedico(fx.UsuarioA);
        var resp = await client.DeleteAsync($"/api/v1/conta/documentos/{fx.DocB}");
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);

        // O doc de B continua intacto (checado como superuser — RLS não atrapalha o assert).
        await using var conn = await fx.OpenDbAsync();
        Assert.True(await Exists(conn, "medico_documentos", fx.DocB), "doc de B foi apagado cross-tenant");
    }

    [Fact]
    public async Task Registrar_ComKeyDeOutroMedico_Forbid()
    {
        var client = fx.ClientForMedico(fx.UsuarioA);
        var resp = await client.PostAsJsonAsync("/api/v1/conta/documentos", new
        {
            s3Key = $"medico/{fx.MedicoB}/enviado/x.pdf",   // prefixo de B
            tipo = "contrato",
            titulo = "tentativa",
            contentType = "application/pdf",
            tamanhoBytes = 1,
        });
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    // ── helpers ──

    private static async Task SetGuc(NpgsqlConnection conn, string name, string value)
    {
        await using var cmd = new NpgsqlCommand("SELECT set_config(@n, @v, false)", conn);
        cmd.Parameters.AddWithValue("n", name);
        cmd.Parameters.AddWithValue("v", value);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task<long> Count(NpgsqlConnection conn, string table)
    {
        await using var cmd = new NpgsqlCommand($"SELECT count(*) FROM {table}", conn);
        return (long)(await cmd.ExecuteScalarAsync())!;
    }

    private static async Task<bool> Exists(NpgsqlConnection conn, string table, Guid id)
    {
        await using var cmd = new NpgsqlCommand($"SELECT count(*) FROM {table} WHERE id = @id", conn);
        cmd.Parameters.AddWithValue("id", id);
        return (long)(await cmd.ExecuteScalarAsync())! > 0;
    }
}
