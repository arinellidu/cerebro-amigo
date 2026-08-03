using Npgsql;
using Xunit;

namespace ApiGateway.Tests;

/// <summary>
/// Valida a RLS (migration 0037) DIRETO no banco, conectando como o role restrito
/// do gateway (gw_test, NOBYPASSRLS). Prova que a rede fail-closed funciona
/// independentemente do WHERE da aplicação — se um WHERE for esquecido, isto barra.
/// </summary>
[Collection("tenant")]
public class RlsTests(TenantIsolationFixture fx)
{
    [Fact]
    public async Task SemGuc_FailClosed_NaoVeNada()
    {
        await using var conn = await fx.OpenGatewayDbAsync();
        // Nenhum app.current_medico setado → policy nega tudo.
        var n = (long)(await Scalar(conn, "SELECT count(*) FROM prescricoes"))!;
        Assert.Equal(0, n);
    }

    [Fact]
    public async Task ComMedicoB_VeSoPrescricaoDeB()
    {
        await using var conn = await fx.OpenGatewayDbAsync();
        await SetGuc(conn, "app.current_medico", fx.MedicoB.ToString());

        var meds = (string?)(await Scalar(conn,
            "SELECT COALESCE(string_agg(medicamento, ','), '') FROM prescricoes")) ?? "";
        Assert.Contains("Sertralina", meds);        // de B
        Assert.DoesNotContain("Escitalopram", meds); // de A — barrado pela RLS
    }

    [Fact]
    public async Task ComMedicoA_NaoVePrescricaoDeB()
    {
        await using var conn = await fx.OpenGatewayDbAsync();
        await SetGuc(conn, "app.current_medico", fx.MedicoA.ToString());

        var meds = (string?)(await Scalar(conn,
            "SELECT COALESCE(string_agg(medicamento, ','), '') FROM prescricoes")) ?? "";
        Assert.Contains("Escitalopram", meds);       // de A
        Assert.DoesNotContain("Sertralina", meds);   // de B — barrado
    }

    [Fact]
    public async Task Bypass_VeTodosOsTenants()
    {
        await using var conn = await fx.OpenGatewayDbAsync();
        await SetGuc(conn, "app.tenant_bypass", "on");

        var n = (long)(await Scalar(conn, "SELECT count(*) FROM prescricoes"))!;
        Assert.True(n >= 2, $"bypass deveria ver A e B, viu {n}");
    }

    [Fact]
    public async Task ComPacienteB_VeSoDeB_DimensaoPortal()
    {
        await using var conn = await fx.OpenGatewayDbAsync();
        await SetGuc(conn, "app.current_paciente", fx.PacienteB.ToString());

        var meds = (string?)(await Scalar(conn,
            "SELECT COALESCE(string_agg(medicamento, ','), '') FROM prescricoes")) ?? "";
        Assert.Contains("Sertralina", meds);
        Assert.DoesNotContain("Escitalopram", meds);
    }

    [Fact]
    public async Task NotificacoesMedico_RlsPorMedicoIdDireto()
    {
        await using var conn = await fx.OpenGatewayDbAsync();
        await SetGuc(conn, "app.current_medico", fx.MedicoA.ToString());
        // A notificação seedada é do médico B → médico A não a vê.
        var n = (long)(await Scalar(conn, "SELECT count(*) FROM notificacoes_medico"))!;
        Assert.Equal(0, n);
    }

    private static async Task SetGuc(NpgsqlConnection conn, string name, string value)
    {
        await using var cmd = new NpgsqlCommand("SELECT set_config(@n, @v, false)", conn);
        cmd.Parameters.AddWithValue("n", name);
        cmd.Parameters.AddWithValue("v", value);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task<object?> Scalar(NpgsqlConnection conn, string sql)
    {
        await using var cmd = new NpgsqlCommand(sql, conn);
        return await cmd.ExecuteScalarAsync();
    }
}
