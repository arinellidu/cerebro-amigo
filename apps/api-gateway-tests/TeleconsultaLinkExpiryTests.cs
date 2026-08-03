using System.Net;
using System.Text;
using Npgsql;
using Xunit;

namespace ApiGateway.Tests;

/// <summary>
/// Expiração do link de teleconsulta (migration 0058 / botão "Finalizar"), e2e com
/// Postgres real. Regras do produto:
///   • Cap implícito = 120 min após o FIM PREVISTO (inicia_em + duracao_min),
///     ancorado na AGENDA — entrar/sair sem querer NÃO inicia a contagem.
///   • Finalizar (manual) → video_link_expira_em = LEAST(cap, NOW()+15min).
///     "Sempre o menor": clicar só encurta, nunca estende além do cap.
///   • Expirado → /entrar recusa com 410 (Gone). Não derruba quem está na sala.
/// </summary>
[Collection("tenant")]
public sealed class TeleconsultaLinkExpiryTests
{
    private readonly TenantIsolationFixture _fx;
    public TeleconsultaLinkExpiryTests(TenantIsolationFixture fx) => _fx = fx;

    private static StringContent Json(string s) => new(s, Encoding.UTF8, "application/json");

    // Médico pago (passa paywall + write-access), 1 paciente, 1 teleconsulta com
    // inicia_em/duracao controláveis. Retorna (HttpClient autenticado, consultaId).
    private async Task<(HttpClient client, Guid consultaId)> SeedTeleconsulta(
        string iniciaEmSql, int duracaoMin = 30,
        string? videoLinkExpiraSql = null, bool simulaEntrouSaiu = false)
    {
        var usuario = Guid.NewGuid();
        var medico = Guid.NewGuid();
        var cliente = Guid.NewGuid();
        var consulta = Guid.NewGuid();

        await using var conn = await _fx.OpenDbAsync();
        async Task Exec(string sql, params object[] p)
        {
            await using var cmd = new NpgsqlCommand(sql, conn);
            for (var i = 0; i < p.Length; i++) cmd.Parameters.AddWithValue("p" + i, p[i]);
            await cmd.ExecuteNonQueryAsync();
        }

        await Exec(@"INSERT INTO usuarios (id, email, senha_hash, nome, role)
                     VALUES (@p0,@p1,'x','Médico TC','medico')", usuario, $"tc.{usuario:N}@ex.com");
        await Exec(@"INSERT INTO medicos (id, usuario_id, nome, crm)
                     VALUES (@p0,@p1,'Médico TC',@p2)", medico, usuario, $"CRM{usuario:N}"[..12]);
        // pro + em prazo: passa RequireAssinaturaAtiva (não vencido) e RequireWriteAccess (não é trial read-only).
        await Exec(@"INSERT INTO assinaturas (medico_id, plano, valor_mensal, status, prazo_pagamento_ate)
                     VALUES (@p0,'pro',597,'pendente',NOW() + INTERVAL '5 days')", medico);
        await Exec(@"INSERT INTO clientes (id, email, nome) VALUES (@p0,@p1,'Paciente TC')",
                   cliente, $"pac.{cliente:N}@ex.com");
        await Exec(@"INSERT INTO pacientes (cliente_id, medico_responsavel_id) VALUES (@p0,@p1)",
                   cliente, medico);

        var expiraCol = videoLinkExpiraSql ?? "NULL";
        await Exec($@"INSERT INTO consultas
                        (id, paciente_id, medico_id, inicia_em, duracao_min, modalidade, status, video_link_expira_em)
                      VALUES (@p0,@p1,@p2,{iniciaEmSql},@p3,'teleconsulta','agendada',{expiraCol})",
                   consulta, cliente, medico, duracaoMin);

        if (simulaEntrouSaiu)
            // médico entrou e saiu (sala aberta e fechada), mas NÃO clicou Finalizar.
            await Exec(@"UPDATE consultas
                         SET video_status='encerrada',
                             video_iniciada_em = NOW() - INTERVAL '2 minutes',
                             video_encerrada_em = NOW() - INTERVAL '1 minute'
                         WHERE id=@p0", consulta);

        return (_fx.ClientForMedico(usuario), consulta);
    }

    private async Task<DateTime?> LinkExpiraEm(Guid consultaId)
    {
        await using var conn = await _fx.OpenDbAsync();
        await using var cmd = new NpgsqlCommand(
            "SELECT video_link_expira_em FROM consultas WHERE id=@id", conn);
        cmd.Parameters.AddWithValue("id", consultaId);
        var v = await cmd.ExecuteScalarAsync();
        return v is DateTime d ? d : null;
    }

    [Fact]
    public async Task DentroDoCap_NaoFinalizada_Entrar_200()
    {
        // Começou há 10min, dur 30 → cap (= +120min após o fim) está no futuro.
        var (client, id) = await SeedTeleconsulta("NOW() - INTERVAL '10 minutes'");
        var r = await client.PostAsync($"/api/v1/consultas/{id}/video/entrar", Json("{}"));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
    }

    [Fact]
    public async Task CapEstourado_Entrar_410()
    {
        // Começou há 200min, dur 30 → fim previsto há 170min → cap (+120) há 50min → expirado.
        var (client, id) = await SeedTeleconsulta("NOW() - INTERVAL '200 minutes'");
        var r = await client.PostAsync($"/api/v1/consultas/{id}/video/entrar", Json("{}"));
        Assert.Equal(HttpStatusCode.Gone, r.StatusCode);
        Assert.Contains("link_expirado", await r.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task EntrarSairSemQuerer_NaoIniciaContagem_Entrar_200()
    {
        // Começou há 10min; médico entrou e saiu SEM finalizar. Cap ancorado na agenda
        // → atividade do vídeo é irrelevante → link segue válido.
        var (client, id) = await SeedTeleconsulta("NOW() - INTERVAL '10 minutes'", simulaEntrouSaiu: true);
        var r = await client.PostAsync($"/api/v1/consultas/{id}/video/entrar", Json("{}"));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
    }

    [Fact]
    public async Task Finalizar_GravaExpiracao_15minNoFuturo_204()
    {
        var (client, id) = await SeedTeleconsulta("NOW() - INTERVAL '10 minutes'");
        var r = await client.PostAsync($"/api/v1/consultas/{id}/video/finalizar", Json("{}"));
        Assert.Equal(HttpStatusCode.NoContent, r.StatusCode);

        var expira = await LinkExpiraEm(id);
        Assert.NotNull(expira);
        // cap é +140min, logo LEAST = NOW()+15min. Janela folgada p/ tolerar o relógio do teste.
        var delta = expira!.Value.ToUniversalTime() - DateTime.UtcNow;
        Assert.InRange(delta.TotalMinutes, 13, 16);
    }

    [Fact]
    public async Task Finalizar_NaoEstendeAlemDoCap_SempreOMenor()
    {
        // Consulta velha: cap já passou. Finalizar agora = LEAST(cap_passado, NOW()+15)
        // = cap_passado → não revive o link. E segue bloqueando reentrada.
        var (client, id) = await SeedTeleconsulta("NOW() - INTERVAL '200 minutes'");
        var r = await client.PostAsync($"/api/v1/consultas/{id}/video/finalizar", Json("{}"));
        Assert.Equal(HttpStatusCode.NoContent, r.StatusCode);

        var expira = await LinkExpiraEm(id);
        Assert.NotNull(expira);
        Assert.True(expira!.Value.ToUniversalTime() < DateTime.UtcNow, "clicar não pode estender além do cap");

        var entrar = await client.PostAsync($"/api/v1/consultas/{id}/video/entrar", Json("{}"));
        Assert.Equal(HttpStatusCode.Gone, entrar.StatusCode);
    }

    [Fact]
    public async Task Finalizar_ConsultaFutura_404()
    {
        // Antes do início previsto: com "sempre o menor", finalizar pré-expiraria o link
        // (NOW()+15 < cap) → barrado no gateway (inicia_em <= NOW).
        var (client, id) = await SeedTeleconsulta("NOW() + INTERVAL '1 hour'");
        var r = await client.PostAsync($"/api/v1/consultas/{id}/video/finalizar", Json("{}"));
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
        Assert.Null(await LinkExpiraEm(id));
    }

    [Fact]
    public async Task LinkManualmenteExpirado_Entrar_410()
    {
        // video_link_expira_em no passado (simula os 15min de graça já decorridos).
        var (client, id) = await SeedTeleconsulta(
            "NOW() - INTERVAL '10 minutes'", videoLinkExpiraSql: "NOW() - INTERVAL '1 minute'");
        var r = await client.PostAsync($"/api/v1/consultas/{id}/video/entrar", Json("{}"));
        Assert.Equal(HttpStatusCode.Gone, r.StatusCode);
    }
}
