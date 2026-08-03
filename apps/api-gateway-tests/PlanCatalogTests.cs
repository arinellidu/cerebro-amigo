using ApiGateway.Services;
using Xunit;

namespace ApiGateway.Tests;

/// <summary>
/// Catálogo de planos (ADR-059) — fonte da verdade server-side. Trava preços, tiers de
/// self-checkout e o fatiamento da camada de IA por plano (1/+2/+1):
///   Essencial(starter)=briefing · Pro=+insights+RAG · Master=+escriba.
/// Plano nulo/legado/desconhecido = SEM IA (fail-safe de custo).
/// </summary>
public sealed class PlanCatalogTests
{
    [Theory]
    [InlineData("starter", "Essencial", 397.00)]
    [InlineData("pro", "Pro", 597.00)]
    [InlineData("master", "Master", 997.00)]
    public void Precos_E_Labels_Batem_Com_ADR059(string codigo, string label, double valor)
    {
        var p = PlanCatalog.TryGet(codigo);
        Assert.NotNull(p);
        Assert.Equal(label, p!.Label);
        Assert.Equal((decimal)valor, p.ValorCiclo);
        // Todos mensais → ciclo == mensalidade-equivalente (MRR coerente).
        Assert.Equal((decimal)valor, p.ValorMensalEquivalente);
        Assert.Equal("MONTHLY", p.Cycle);
    }

    [Fact]
    public void SelfCheckout_Sao_Os_3_Planos_Pagos_Sem_Enterprise()
    {
        var codigos = PlanCatalog.CodigosSelfCheckout;
        Assert.Equal(3, codigos.Count);
        Assert.Contains("starter", codigos);
        Assert.Contains("pro", codigos);
        Assert.Contains("master", codigos);
        Assert.DoesNotContain("enterprise", codigos); // legado: não ofertado
    }

    [Fact]
    public void Essencial_So_Tem_Briefing()
    {
        Assert.True(PlanCatalog.TemFeature("starter", FeatureKeys.BriefingIa));
        Assert.False(PlanCatalog.TemFeature("starter", FeatureKeys.IaInsights));
        Assert.False(PlanCatalog.TemFeature("starter", FeatureKeys.Rag));
        Assert.False(PlanCatalog.TemFeature("starter", FeatureKeys.Escriba));
    }

    [Fact]
    public void Pro_Tem_Briefing_Insights_Rag_Mas_Nao_Escriba()
    {
        Assert.True(PlanCatalog.TemFeature("pro", FeatureKeys.BriefingIa));
        Assert.True(PlanCatalog.TemFeature("pro", FeatureKeys.IaInsights));
        Assert.True(PlanCatalog.TemFeature("pro", FeatureKeys.Rag));
        Assert.False(PlanCatalog.TemFeature("pro", FeatureKeys.Escriba));
    }

    [Fact]
    public void Master_Tem_Toda_A_Camada_De_IA()
    {
        foreach (var f in FeatureKeys.CamadaIa)
            Assert.True(PlanCatalog.TemFeature("master", f), $"master deveria incluir {f}");
    }

    [Fact]
    public void Enterprise_Legado_Herda_Toda_A_IA_Para_Nao_Cegar_Linhas_Antigas()
    {
        foreach (var f in FeatureKeys.CamadaIa)
            Assert.True(PlanCatalog.TemFeature("enterprise", f), $"enterprise (legado) deveria incluir {f}");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("pendente")]
    [InlineData("trial")]
    [InlineData("plano_que_nao_existe")]
    public void Plano_Nulo_Ou_Desconhecido_Nao_Libera_Nenhuma_IA(string? codigo)
    {
        Assert.Empty(PlanCatalog.FeaturesDe(codigo));
        foreach (var f in FeatureKeys.CamadaIa)
            Assert.False(PlanCatalog.TemFeature(codigo, f), $"{codigo ?? "null"} não deveria liberar {f}");
    }

    [Fact]
    public void Codigo_E_Case_Insensitive()
    {
        Assert.Equal("Pro", PlanCatalog.TryGet("PRO")?.Label);
        Assert.True(PlanCatalog.TemFeature("MASTER", FeatureKeys.Escriba));
    }
}
