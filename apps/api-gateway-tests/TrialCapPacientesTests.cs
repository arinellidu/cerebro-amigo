using System.Net;
using System.Text;
using Npgsql;
using Xunit;

namespace ApiGateway.Tests;

/// <summary>
/// Cap de pacientes no trial de aquisição (ADR-065). No trial read-only o médico pode
/// cadastrar pacientes (lock-in por base) até TRIAL_MAX_PACIENTES (default 5). Batido o
/// teto → 403 trial_limite_pacientes. Importação em lote é bloqueada no trial. Fora do
/// trial (plano pago) não há cap.
/// </summary>
[Collection("tenant")]
public sealed class TrialCapPacientesTests
{
    private readonly TenantIsolationFixture _fx;
    public TrialCapPacientesTests(TenantIsolationFixture fx) => _fx = fx;

    private static StringContent Json(string s) => new(s, Encoding.UTF8, "application/json");

    private async Task<Guid> SeedMedico(string status, string plano, int comPacientes)
    {
        var usuario = Guid.NewGuid();
        var medico = Guid.NewGuid();
        await using var conn = await _fx.OpenDbAsync();
        async Task Exec(string sql, params object[] p)
        {
            await using var cmd = new NpgsqlCommand(sql, conn);
            for (var i = 0; i < p.Length; i++) cmd.Parameters.AddWithValue("p" + i, p[i]);
            await cmd.ExecuteNonQueryAsync();
        }
        await Exec(@"INSERT INTO usuarios (id, email, senha_hash, nome, role)
                     VALUES (@p0,@p1,'x','Médico Cap','medico')", usuario, $"cap.{usuario:N}@ex.com");
        await Exec(@"INSERT INTO medicos (id, usuario_id, nome, crm)
                     VALUES (@p0,@p1,'Médico Cap','CRM-CAP')", medico, usuario);
        await Exec(@"INSERT INTO assinaturas (medico_id, plano, valor_mensal, status, prazo_pagamento_ate)
                     VALUES (@p0,@p1,0,@p2, NOW() + INTERVAL '5 days')", medico, plano, status);

        for (var i = 0; i < comPacientes; i++)
        {
            var cliente = Guid.NewGuid();
            await Exec(@"INSERT INTO clientes (id, email, nome) VALUES (@p0,@p1,'Pac')",
                cliente, $"pac.{cliente:N}@ex.com");
            await Exec(@"INSERT INTO pacientes (cliente_id, medico_responsavel_id) VALUES (@p0,@p1)",
                cliente, medico);
        }
        return usuario;
    }

    [Fact]
    public async Task Trial_NoTeto_BloqueiaCadastro()
    {
        // 5 pacientes (= default do cap) → o 6º é barrado ANTES da validação do corpo.
        var usuario = await SeedMedico("pendente", "pendente", comPacientes: 5);
        var client = _fx.ClientForMedico(usuario);

        var r = await client.PostAsync("/api/v1/pacientes/", Json("{}"));
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
        Assert.Contains("trial_limite_pacientes", await r.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Trial_AbaixoDoTeto_NaoBloqueiaPeloCap()
    {
        // 0 pacientes → o cap deixa passar; o corpo vazio cai na validação (400), não no cap (403).
        var usuario = await SeedMedico("pendente", "pendente", comPacientes: 0);
        var client = _fx.ClientForMedico(usuario);

        var r = await client.PostAsync("/api/v1/pacientes/", Json("{}"));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Trial_Importar_Bloqueado()
    {
        var usuario = await SeedMedico("pendente", "pendente", comPacientes: 0);
        var client = _fx.ClientForMedico(usuario);

        var r = await client.PostAsync("/api/v1/pacientes/importar", Json("{}"));
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
        Assert.Contains("trial_limite_pacientes", await r.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task PlanoPago_SemCap()
    {
        // Plano pago, mesmo com 5 pacientes, não tem cap → passa do cap p/ a validação (400).
        var usuario = await SeedMedico("pendente", "pro", comPacientes: 5);
        var client = _fx.ClientForMedico(usuario);

        var r = await client.PostAsync("/api/v1/pacientes/", Json("{}"));
        Assert.NotEqual(HttpStatusCode.Forbidden, r.StatusCode);
    }
}
