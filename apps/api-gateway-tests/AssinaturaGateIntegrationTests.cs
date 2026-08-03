using System.Net;
using Npgsql;
using Xunit;

namespace ApiGateway.Tests;

/// <summary>
/// Gate de assinatura (ADR-055 Fase D) end-to-end, com Postgres real.
///
/// PROVA A INVARIANTE CLÍNICA: um médico com assinatura BLOQUEADA (pendente vencido)
/// leva 402 nos endpoints de DASHBOARD, mas continua com acesso TOTAL à crise
/// (GET /api/v1/crise/ativas → 200). Bloquear a UI de cobrança jamais pode cegar o
/// médico para uma crise de paciente. Também cobre fail-open (médico sem assinatura
/// → liberado) e o caminho feliz (assinatura ativa → liberado).
/// </summary>
[Collection("tenant")]
public sealed class AssinaturaGateIntegrationTests
{
    private readonly TenantIsolationFixture _fx;
    public AssinaturaGateIntegrationTests(TenantIsolationFixture fx) => _fx = fx;

    private async Task SeedMedicoComAssinatura(
        Guid usuarioId, Guid medicoId, string email, string? status, string? prazoSql)
    {
        await using var conn = await _fx.OpenDbAsync();
        async Task Exec(string sql, params object[] p)
        {
            await using var cmd = new NpgsqlCommand(sql, conn);
            for (var i = 0; i < p.Length; i++) cmd.Parameters.AddWithValue("p" + i, p[i]);
            await cmd.ExecuteNonQueryAsync();
        }
        await Exec(@"INSERT INTO usuarios (id, email, senha_hash, nome, role)
                     VALUES (@p0,@p1,'x','Médico Gate','medico')", usuarioId, email);
        await Exec(@"INSERT INTO medicos (id, usuario_id, nome, crm)
                     VALUES (@p0,@p1,'Médico Gate','CRM-GATE')", medicoId, usuarioId);
        if (status is not null)
            // prazo_pagamento_ate via SQL literal (NOW() ± intervalo) — controla o vencimento.
            await Exec($@"INSERT INTO assinaturas (medico_id, plano, valor_mensal, status, prazo_pagamento_ate)
                          VALUES (@p0,'pro',197.00,@p1,{prazoSql})", medicoId, status);
    }

    [Fact]
    public async Task MedicoBloqueado_LevaPaywall_NoDashboard_MasCriseSegueLiberada()
    {
        var usuario = Guid.NewGuid();
        var medico = Guid.NewGuid();
        // pendente com prazo VENCIDO (ontem) → bloqueado.
        await SeedMedicoComAssinatura(usuario, medico, $"gate.bloq.{usuario:N}@ex.com",
            "pendente", "NOW() - INTERVAL '1 day'");
        var client = _fx.ClientForMedico(usuario);

        // Dashboard gateado → 402.
        var pacientes = await client.GetAsync("/api/v1/pacientes/");
        Assert.Equal(HttpStatusCode.PaymentRequired, pacientes.StatusCode);
        Assert.Contains("assinatura_inativa", await pacientes.Content.ReadAsStringAsync());

        // INVARIANTE CLÍNICA: crise NUNCA gateada → 200 mesmo bloqueado.
        var crise = await client.GetAsync("/api/v1/crise/ativas");
        Assert.Equal(HttpStatusCode.OK, crise.StatusCode);
    }

    [Fact]
    public async Task MedicoAtivo_AcessaDashboard()
    {
        var usuario = Guid.NewGuid();
        var medico = Guid.NewGuid();
        await SeedMedicoComAssinatura(usuario, medico, $"gate.ativo.{usuario:N}@ex.com",
            "ativa", "NULL");
        var client = _fx.ClientForMedico(usuario);

        var pacientes = await client.GetAsync("/api/v1/pacientes/");
        Assert.Equal(HttpStatusCode.OK, pacientes.StatusCode);
    }

    [Fact]
    public async Task MedicoEmPrazo_AcessaDashboard()
    {
        var usuario = Guid.NewGuid();
        var medico = Guid.NewGuid();
        // pendente, prazo ainda no futuro → liberado (com banner de aviso).
        await SeedMedicoComAssinatura(usuario, medico, $"gate.prazo.{usuario:N}@ex.com",
            "pendente", "NOW() + INTERVAL '3 days'");
        var client = _fx.ClientForMedico(usuario);

        var pacientes = await client.GetAsync("/api/v1/pacientes/");
        Assert.Equal(HttpStatusCode.OK, pacientes.StatusCode);
    }

    [Fact]
    public async Task MedicoSemAssinatura_FailOpen_AcessaDashboard()
    {
        // Médico sem nenhuma linha em assinaturas → fail-open (nunca bloquear por
        // dado ausente). Médico A do fixture é exatamente esse caso.
        var client = _fx.ClientForMedico(_fx.UsuarioA);
        var pacientes = await client.GetAsync("/api/v1/pacientes/");
        Assert.Equal(HttpStatusCode.OK, pacientes.StatusCode);
    }
}
