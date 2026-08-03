using System.Net;
using System.Text;
using Npgsql;
using Xunit;

namespace ApiGateway.Tests;

/// <summary>
/// Gate de escrita do trial de aquisição (ADR-065) end-to-end, com Postgres real.
///
/// PROVA: um médico em "trial read-only" (pendente, em prazo, plano não pago) LÊ o
/// dashboard (GET 200) mas NÃO ESCREVE fora de pacientes (POST consulta/conduta → 403
/// read_only_trial). A INVARIANTE CLÍNICA segue: crise NUNCA é gateada (200 no trial).
/// Cobre também: plano pago não é read-only; vencido cai no paywall (402) antes.
/// </summary>
[Collection("tenant")]
public sealed class ReadOnlyTrialFilterIntegrationTests
{
    private readonly TenantIsolationFixture _fx;
    public ReadOnlyTrialFilterIntegrationTests(TenantIsolationFixture fx) => _fx = fx;

    private static StringContent Json(string s) => new(s, Encoding.UTF8, "application/json");

    private async Task SeedMedico(
        Guid usuarioId, Guid medicoId, string email, string status, string plano, string prazoSql)
    {
        await using var conn = await _fx.OpenDbAsync();
        async Task Exec(string sql, params object[] p)
        {
            await using var cmd = new NpgsqlCommand(sql, conn);
            for (var i = 0; i < p.Length; i++) cmd.Parameters.AddWithValue("p" + i, p[i]);
            await cmd.ExecuteNonQueryAsync();
        }
        await Exec(@"INSERT INTO usuarios (id, email, senha_hash, nome, role)
                     VALUES (@p0,@p1,'x','Médico RO','medico')", usuarioId, email);
        await Exec(@"INSERT INTO medicos (id, usuario_id, nome, crm)
                     VALUES (@p0,@p1,'Médico RO','CRM-RO')", medicoId, usuarioId);
        await Exec($@"INSERT INTO assinaturas (medico_id, plano, valor_mensal, status, prazo_pagamento_ate)
                      VALUES (@p0,@p1,0,@p2,{prazoSql})", medicoId, plano, status);
    }

    // Trial = pendente, em prazo, plano não pago ('pendente').
    private async Task<HttpClient> SeedTrial()
    {
        var usuario = Guid.NewGuid();
        await SeedMedico(usuario, Guid.NewGuid(), $"ro.trial.{usuario:N}@ex.com",
            "pendente", "pendente", "NOW() + INTERVAL '5 days'");
        return _fx.ClientForMedico(usuario);
    }

    [Fact]
    public async Task Trial_GET_pacientes_Liberado()
    {
        var client = await SeedTrial();
        var r = await client.GetAsync("/api/v1/pacientes/");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode); // leitura sempre passa no trial
    }

    [Fact]
    public async Task Trial_GET_consultas_Liberado()
    {
        var client = await SeedTrial();
        var r = await client.GetAsync("/api/v1/consultas/");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
    }

    [Fact]
    public async Task Trial_POST_consulta_Bloqueado_ReadOnly()
    {
        var client = await SeedTrial();
        var r = await client.PostAsync("/api/v1/consultas/", Json("{}"));
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
        Assert.Contains("read_only_trial", await r.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Trial_POST_conduta_Bloqueado_ReadOnly()
    {
        // Condutas estava SEM gate (ADR-065 fechou o buraco): no trial → 403.
        var client = await SeedTrial();
        var r = await client.PostAsync($"/api/v1/pacientes/{Guid.NewGuid()}/condutas", Json("{}"));
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
        Assert.Contains("read_only_trial", await r.Content.ReadAsStringAsync());
    }

    [Theory]
    [InlineData("/api/v1/exames/{0}/resultado")]
    [InlineData("/api/v1/memed/receitas")]
    [InlineData("/api/v1/renovacoes/{0}/renovada")]
    [InlineData("/api/v1/consultas/{0}/video/entrar")]
    public async Task Trial_GruposOperacionais_Bloqueados(string rotaTemplate)
    {
        // ADR-065: grupos operacionais (exames/memed/renovações/teleconsulta-médico)
        // agora gateados → escrita bloqueada no trial.
        var client = await SeedTrial();
        var rota = string.Format(rotaTemplate, Guid.NewGuid());
        var r = await client.PostAsync(rota, Json("{}"));
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
        Assert.Contains("read_only_trial", await r.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Trial_Me_ExpoeReadOnlyTrue()
    {
        var client = await SeedTrial();
        var r = await client.GetAsync("/api/v1/auth/me");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Contains("\"readOnly\":true", await r.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task PlanoPago_Me_ReadOnlyFalse()
    {
        var usuario = Guid.NewGuid();
        await SeedMedico(usuario, Guid.NewGuid(), $"ro.me.pago.{usuario:N}@ex.com",
            "pendente", "pro", "NOW() + INTERVAL '5 days'");
        var client = _fx.ClientForMedico(usuario);
        var r = await client.GetAsync("/api/v1/auth/me");
        Assert.Contains("\"readOnly\":false", await r.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Trial_Crise_NUNCA_Bloqueada()
    {
        // INVARIANTE CLÍNICA (regra #2): crise não recebe nenhum gate → 200 no trial.
        var client = await SeedTrial();
        var r = await client.GetAsync("/api/v1/crise/ativas");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
    }

    [Fact]
    public async Task PlanoPago_POST_consulta_NaoEhReadOnly()
    {
        // Pendente em prazo MAS com plano pago ('pro') → não é trial read-only.
        var usuario = Guid.NewGuid();
        await SeedMedico(usuario, Guid.NewGuid(), $"ro.pago.{usuario:N}@ex.com",
            "pendente", "pro", "NOW() + INTERVAL '5 days'");
        var client = _fx.ClientForMedico(usuario);

        // O handler pode retornar 403 Forbid por conta própria (corpo {} → paciente inexistente),
        // mas o gate read-only NÃO deve disparar. Provamos pela ausência do erro específico.
        var r = await client.PostAsync("/api/v1/consultas/", Json("{}"));
        Assert.DoesNotContain("read_only_trial", await r.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Vencido_POST_consulta_PaywallAntesDoReadOnly()
    {
        // Vencido: AssinaturaGate bloqueia (402) antes do ReadOnly rodar.
        var usuario = Guid.NewGuid();
        await SeedMedico(usuario, Guid.NewGuid(), $"ro.venc.{usuario:N}@ex.com",
            "pendente", "pendente", "NOW() - INTERVAL '1 day'");
        var client = _fx.ClientForMedico(usuario);

        var r = await client.PostAsync("/api/v1/consultas/", Json("{}"));
        Assert.Equal(HttpStatusCode.PaymentRequired, r.StatusCode);
        Assert.Contains("assinatura_inativa", await r.Content.ReadAsStringAsync());
    }
}
