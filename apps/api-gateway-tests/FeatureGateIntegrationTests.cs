using System.Net;
using Npgsql;
using Xunit;

namespace ApiGateway.Tests;

/// <summary>
/// Gate de FEATURE por plano (ADR-059) end-to-end, com Postgres real. Camada SEPARADA do
/// AssinaturaGate: assinatura ATIVA libera o dashboard; o PLANO decide quais features de IA
/// o médico tem. Fatiamento 1/+2/+1:
///   Essencial(starter)=briefing · Pro=+insights+RAG · Master=+escriba.
///
/// Prova também o CONTRASTE de fail-safe: AssinaturaGate fail-OPEN em dado ausente (nunca
/// cegar o dashboard / a crise), mas FeatureGate fail-CLOSED em plano nulo (nunca liberar
/// LLM pago de graça) — um médico sem linha de assinatura leva 402 na IA.
/// </summary>
[Collection("tenant")]
public sealed class FeatureGateIntegrationTests
{
    private readonly TenantIsolationFixture _fx;
    public FeatureGateIntegrationTests(TenantIsolationFixture fx) => _fx = fx;

    private async Task SeedMedicoAtivo(Guid usuarioId, Guid medicoId, string email, string plano)
    {
        await using var conn = await _fx.OpenDbAsync();
        async Task Exec(string sql, params object[] p)
        {
            await using var cmd = new NpgsqlCommand(sql, conn);
            for (var i = 0; i < p.Length; i++) cmd.Parameters.AddWithValue("p" + i, p[i]);
            await cmd.ExecuteNonQueryAsync();
        }
        await Exec(@"INSERT INTO usuarios (id, email, senha_hash, nome, role)
                     VALUES (@p0,@p1,'x','Médico Feature','medico')", usuarioId, email);
        await Exec(@"INSERT INTO medicos (id, usuario_id, nome, crm)
                     VALUES (@p0,@p1,'Médico Feature','CRM-FEAT')", medicoId, usuarioId);
        // Assinatura ATIVA → AssinaturaGate sempre libera; isola a variável "plano".
        await Exec(@"INSERT INTO assinaturas (medico_id, plano, valor_mensal, status, prazo_pagamento_ate)
                     VALUES (@p0,@p1,0,'ativa',NULL)", medicoId, plano);
    }

    private static bool EhFeatureRequerPro(string body) => body.Contains("feature_requer_pro");

    // ── Insights (ia_insights) = Pro+Master ────────────────────────────────────
    [Fact]
    public async Task Essencial_NaoTem_Insights_LevaUpsell()
    {
        var (u, m) = (Guid.NewGuid(), Guid.NewGuid());
        await SeedMedicoAtivo(u, m, $"feat.ess.ins.{u:N}@ex.com", "starter");
        var client = _fx.ClientForMedico(u);

        var resp = await client.GetAsync("/api/v1/insights/pendentes");
        Assert.Equal(HttpStatusCode.PaymentRequired, resp.StatusCode);
        Assert.True(EhFeatureRequerPro(await resp.Content.ReadAsStringAsync()));
    }

    [Fact]
    public async Task Pro_Tem_Insights_Acessa()
    {
        var (u, m) = (Guid.NewGuid(), Guid.NewGuid());
        await SeedMedicoAtivo(u, m, $"feat.pro.ins.{u:N}@ex.com", "pro");
        var client = _fx.ClientForMedico(u);

        var resp = await client.GetAsync("/api/v1/insights/pendentes");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode); // handler roda, lista vazia
    }

    // ── Escriba = só Master ─────────────────────────────────────────────────────
    [Fact]
    public async Task Pro_NaoTem_Escriba_LevaUpsell()
    {
        var (u, m) = (Guid.NewGuid(), Guid.NewGuid());
        await SeedMedicoAtivo(u, m, $"feat.pro.esc.{u:N}@ex.com", "pro");
        var client = _fx.ClientForMedico(u);

        var resp = await client.GetAsync($"/api/v1/consultas/{Guid.NewGuid()}/escriba/status");
        Assert.Equal(HttpStatusCode.PaymentRequired, resp.StatusCode);
        Assert.True(EhFeatureRequerPro(await resp.Content.ReadAsStringAsync()));
    }

    [Fact]
    public async Task Master_Tem_Escriba_GatePassa()
    {
        var (u, m) = (Guid.NewGuid(), Guid.NewGuid());
        await SeedMedicoAtivo(u, m, $"feat.master.esc.{u:N}@ex.com", "master");
        var client = _fx.ClientForMedico(u);

        // Consulta inexistente → handler responde algo (404/200), mas NUNCA upsell de feature.
        var resp = await client.GetAsync($"/api/v1/consultas/{Guid.NewGuid()}/escriba/status");
        Assert.False(EhFeatureRequerPro(await resp.Content.ReadAsStringAsync()));
    }

    // ── Briefing (briefing_ia) = todos os planos pagos; bloqueia plano nulo ──────
    [Fact]
    public async Task Essencial_Tem_Briefing_GatePassa()
    {
        var (u, m) = (Guid.NewGuid(), Guid.NewGuid());
        await SeedMedicoAtivo(u, m, $"feat.ess.brief.{u:N}@ex.com", "starter");
        var client = _fx.ClientForMedico(u);

        // Paciente desconhecido → handler dá Forbid; o que importa: NÃO é upsell de feature.
        var resp = await client.GetAsync($"/api/v1/pacientes/{Guid.NewGuid()}/resumo-pre-consulta");
        Assert.False(EhFeatureRequerPro(await resp.Content.ReadAsStringAsync()));
    }

    [Fact]
    public async Task SemAssinatura_FailOpenNoDashboard_MasFailClosedNaIA()
    {
        // Médico A do fixture: SEM linha de assinatura.
        var client = _fx.ClientForMedico(_fx.UsuarioA);

        // AssinaturaGate fail-OPEN: dashboard core abre (já provado em AssinaturaGate tests).
        // FeatureGate fail-CLOSED: plano nulo → IA paga bloqueada (não dar LLM de graça).
        var resp = await client.GetAsync($"/api/v1/pacientes/{Guid.NewGuid()}/resumo-pre-consulta");
        Assert.Equal(HttpStatusCode.PaymentRequired, resp.StatusCode);
        Assert.True(EhFeatureRequerPro(await resp.Content.ReadAsStringAsync()));
    }
}
