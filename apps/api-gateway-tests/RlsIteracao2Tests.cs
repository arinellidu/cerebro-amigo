using Npgsql;
using Xunit;

namespace ApiGateway.Tests;

/// <summary>
/// Valida a RLS da iteração 2 (migration 0038) DIRETO no banco, como o role
/// restrito do gateway (gw_test, NOBYPASSRLS). Cobre os padrões NOVOS que a 0037
/// não tinha: conversas (2-hop por cliente_id), mensagens (3-hop via conversa_id)
/// e as trilhas que faltavam (crise_alerta_eventos, condutas_eventos,
/// receitas_memed, acessos_prontuario).
/// </summary>
[Collection("tenant")]
public class RlsIteracao2Tests(TenantIsolationFixture fx)
{
    // ── conversas: 2-hop por cliente_id ──

    [Fact]
    public async Task Conversas_SemGuc_FailClosed()
    {
        await using var conn = await fx.OpenGatewayDbAsync();
        Assert.Equal(0L, await Count(conn, "conversas"));
    }

    [Fact]
    public async Task Conversas_MedicoA_NaoVeDeB()
    {
        await using var conn = await fx.OpenGatewayDbAsync();
        await SetGuc(conn, "app.current_medico", fx.MedicoA.ToString());
        // Médico A só enxerga a conversa do paciente dele (A), nunca a de B.
        Assert.False(await Exists(conn, "conversas", fx.ConversaB), "vazou conversa de B p/ médico A");
        Assert.True(await Exists(conn, "conversas", fx.ConversaA), "médico A deveria ver a própria conversa");
    }

    [Fact]
    public async Task Conversas_MedicoB_VeDeB()
    {
        await using var conn = await fx.OpenGatewayDbAsync();
        await SetGuc(conn, "app.current_medico", fx.MedicoB.ToString());
        Assert.True(await Exists(conn, "conversas", fx.ConversaB));
        Assert.False(await Exists(conn, "conversas", fx.ConversaA));
    }

    [Fact]
    public async Task Conversas_PacienteB_VeSoDeB_DimensaoPortal()
    {
        await using var conn = await fx.OpenGatewayDbAsync();
        await SetGuc(conn, "app.current_paciente", fx.PacienteB.ToString());
        Assert.True(await Exists(conn, "conversas", fx.ConversaB));
        Assert.False(await Exists(conn, "conversas", fx.ConversaA));
    }

    [Fact]
    public async Task Conversas_Bypass_VeTodas()
    {
        await using var conn = await fx.OpenGatewayDbAsync();
        await SetGuc(conn, "app.tenant_bypass", "on");
        Assert.True(await Count(conn, "conversas") >= 2);
    }

    // ── mensagens: 3-hop via conversa_id -> conversas ──

    [Fact]
    public async Task Mensagens_SemGuc_FailClosed()
    {
        await using var conn = await fx.OpenGatewayDbAsync();
        Assert.Equal(0L, await Count(conn, "mensagens"));
    }

    [Fact]
    public async Task Mensagens_MedicoA_NaoVeConteudoDeB()
    {
        await using var conn = await fx.OpenGatewayDbAsync();
        await SetGuc(conn, "app.current_medico", fx.MedicoA.ToString());
        var conteudo = await Agg(conn, "SELECT COALESCE(string_agg(conteudo, ','), '') FROM mensagens");
        Assert.Contains("Mensagem de A", conteudo);
        Assert.DoesNotContain("secreta de B", conteudo);   // 3-hop barrou
    }

    [Fact]
    public async Task Mensagens_MedicoB_VeConteudoDeB()
    {
        await using var conn = await fx.OpenGatewayDbAsync();
        await SetGuc(conn, "app.current_medico", fx.MedicoB.ToString());
        var conteudo = await Agg(conn, "SELECT COALESCE(string_agg(conteudo, ','), '') FROM mensagens");
        Assert.Contains("secreta de B", conteudo);
        Assert.DoesNotContain("Mensagem de A", conteudo);
    }

    [Fact]
    public async Task Mensagens_PacienteB_VeSoDeB()
    {
        await using var conn = await fx.OpenGatewayDbAsync();
        await SetGuc(conn, "app.current_paciente", fx.PacienteB.ToString());
        var conteudo = await Agg(conn, "SELECT COALESCE(string_agg(conteudo, ','), '') FROM mensagens");
        Assert.Contains("secreta de B", conteudo);
        Assert.DoesNotContain("Mensagem de A", conteudo);
    }

    // ── crise_alerta_eventos: tenant direto por medico_id (leak clínico de crise) ──

    [Fact]
    public async Task CriseAlertaEventos_MedicoA_NaoVeDeB()
    {
        await using var conn = await fx.OpenGatewayDbAsync();
        await SetGuc(conn, "app.current_medico", fx.MedicoA.ToString());
        Assert.Equal(0L, await Count(conn, "crise_alerta_eventos"));
    }

    [Fact]
    public async Task CriseAlertaEventos_MedicoB_VeDeB()
    {
        await using var conn = await fx.OpenGatewayDbAsync();
        await SetGuc(conn, "app.current_medico", fx.MedicoB.ToString());
        Assert.True(await Count(conn, "crise_alerta_eventos") >= 1);
    }

    // ── 1-hop por paciente_id (mesma forma já provada em prescricoes) ──

    [Fact]
    public async Task CondutasEventos_MedicoA_NaoVeDeB()
    {
        await using var conn = await fx.OpenGatewayDbAsync();
        await SetGuc(conn, "app.current_medico", fx.MedicoA.ToString());
        Assert.Equal(0L, await Count(conn, "condutas_eventos"));
    }

    [Fact]
    public async Task ReceitasMemed_MedicoA_NaoVeDeB()
    {
        await using var conn = await fx.OpenGatewayDbAsync();
        await SetGuc(conn, "app.current_medico", fx.MedicoA.ToString());
        Assert.Equal(0L, await Count(conn, "receitas_memed"));
    }

    // ── acessos_prontuario: tenant direto por medico_id ──

    [Fact]
    public async Task AcessosProntuario_MedicoA_NaoVeDeB()
    {
        await using var conn = await fx.OpenGatewayDbAsync();
        await SetGuc(conn, "app.current_medico", fx.MedicoA.ToString());
        Assert.Equal(0L, await Count(conn, "acessos_prontuario"));
    }

    [Fact]
    public async Task AcessosProntuario_MedicoB_VeDeB()
    {
        await using var conn = await fx.OpenGatewayDbAsync();
        await SetGuc(conn, "app.current_medico", fx.MedicoB.ToString());
        Assert.True(await Count(conn, "acessos_prontuario") >= 1);
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

    private static async Task<string> Agg(NpgsqlConnection conn, string sql)
    {
        await using var cmd = new NpgsqlCommand(sql, conn);
        return (string?)(await cmd.ExecuteScalarAsync()) ?? "";
    }
}
