using ApiGateway.Services;
using Xunit;

namespace ApiGateway.Tests;

/// <summary>
/// Gate de assinatura (ADR-055). Garante a lógica de liberação E a invariante de
/// segurança: status desconhecido/ausente NUNCA bloqueia (fail-open clínico).
/// </summary>
public sealed class AssinaturaGateTests
{
    private static readonly DateTime Now = new(2026, 6, 15, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void Ativa_Libera_SemBanner()
    {
        var s = AssinaturaGate.Avaliar("ativa", null, null, Now);
        Assert.True(s.Liberado);
        Assert.False(s.EmPrazo);
        Assert.Equal("ativa", s.Motivo);
    }

    [Fact]
    public void PendenteEmPrazo_Libera_ComBanner_EConta_Dias()
    {
        var s = AssinaturaGate.Avaliar("pendente", Now.AddDays(5), null, Now);
        Assert.True(s.Liberado);
        Assert.True(s.EmPrazo);
        Assert.Equal(5, s.DiasRestantes);
        Assert.Equal("pendente_em_prazo", s.Motivo);
    }

    [Fact]
    public void PendenteVencido_Bloqueia()
    {
        var s = AssinaturaGate.Avaliar("pendente", Now.AddDays(-1), null, Now);
        Assert.False(s.Liberado);
        Assert.Equal("pendente_vencido", s.Motivo);
    }

    [Fact]
    public void PendenteNaBorda_AindaLibera()
    {
        // Exatamente no prazo (>=) ainda libera — borda não bloqueia.
        var s = AssinaturaGate.Avaliar("pendente", Now, null, Now);
        Assert.True(s.Liberado);
    }

    [Fact]
    public void PendenteSemPrazo_NaoBloqueia()
    {
        // Dado ausente (prazo null) não pode bloquear — defensivo.
        var s = AssinaturaGate.Avaliar("pendente", null, null, Now);
        Assert.True(s.Liberado);
        Assert.Equal("pendente_sem_prazo", s.Motivo);
    }

    [Fact]
    public void Suspensa_Bloqueia()
    {
        var s = AssinaturaGate.Avaliar("suspensa", null, null, Now);
        Assert.False(s.Liberado);
        Assert.Equal("suspensa", s.Motivo);
    }

    [Fact]
    public void Cancelada_Bloqueia()
    {
        var s = AssinaturaGate.Avaliar("cancelada", null, null, Now);
        Assert.False(s.Liberado);
    }

    [Theory]
    [InlineData("trial", 3, true)]    // trial legado dentro da janela
    [InlineData("trial", -3, false)]  // trial legado vencido
    public void TrialLegado_RespeitaJanela(string status, int diasTrial, bool esperaLiberado)
    {
        var s = AssinaturaGate.Avaliar(status, null, Now.AddDays(diasTrial), Now);
        Assert.Equal(esperaLiberado, s.Liberado);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("estado_que_nao_existe")]
    public void StatusDesconhecidoOuAusente_FailOpen(string? status)
    {
        // INVARIANTE CLÍNICA: nunca bloquear por status estranho/ausente.
        var s = AssinaturaGate.Avaliar(status, null, null, Now);
        Assert.True(s.Liberado);
        Assert.Equal("desconhecido", s.Motivo);
    }

    [Fact]
    public void Status_CaseInsensitive_ComEspacos()
    {
        var s = AssinaturaGate.Avaliar("  ATIVA ", null, null, Now);
        Assert.True(s.Liberado);
        Assert.Equal("ativa", s.Motivo);
    }

    // ── ADR-065: trial read-only (sobrecarga com plano) ──────────────────────────

    [Fact]
    public void TrialReadOnly_PendenteEmPrazo_SemPlano()
    {
        // Médico recém-cadastrado: pendente, em prazo, plano ainda 'pendente'.
        var s = AssinaturaGate.Avaliar("pendente", Now.AddDays(5), null, Now, "pendente");
        Assert.True(s.Liberado);   // leitura liberada
        Assert.True(s.TrialReadOnly);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("pendente")]
    public void TrialReadOnly_PlanoNaoPago_EhReadOnly(string? plano)
    {
        var s = AssinaturaGate.Avaliar("pendente", Now.AddDays(5), null, Now, plano);
        Assert.True(s.TrialReadOnly);
    }

    [Theory]
    [InlineData("starter")]
    [InlineData("pro")]
    [InlineData("master")]
    [InlineData("enterprise")] // alias legado também conta como pago
    public void TrialReadOnly_PlanoPago_NaoEhReadOnly(string plano)
    {
        // Pagou um plano (mesmo na janela pendente do Asaas) → escrita liberada.
        var s = AssinaturaGate.Avaliar("pendente", Now.AddDays(5), null, Now, plano);
        Assert.False(s.TrialReadOnly);
    }

    [Fact]
    public void TrialReadOnly_Ativa_NaoEhReadOnly()
    {
        var s = AssinaturaGate.Avaliar("ativa", null, null, Now, "pro");
        Assert.False(s.TrialReadOnly);
    }

    [Fact]
    public void TrialReadOnly_PendenteVencido_NaoEhReadOnly()
    {
        // Vencido: o AssinaturaGate bloqueia tudo (não-liberado) → não é trial read-only.
        var s = AssinaturaGate.Avaliar("pendente", Now.AddDays(-1), null, Now, "pendente");
        Assert.False(s.Liberado);
        Assert.False(s.TrialReadOnly);
    }

    [Fact]
    public void TrialReadOnly_PendenteSemPrazo_SemPlano_EhReadOnly()
    {
        var s = AssinaturaGate.Avaliar("pendente", null, null, Now, "pendente");
        Assert.True(s.Liberado);
        Assert.True(s.TrialReadOnly);
    }

    [Fact]
    public void Avaliar_SemPlano_NaoMarcaReadOnly_PorDefault()
    {
        // A sobrecarga antiga (sem plano) nunca marca TrialReadOnly (compat).
        var s = AssinaturaGate.Avaliar("pendente", Now.AddDays(5), null, Now);
        Assert.False(s.TrialReadOnly);
    }
}
