namespace ApiGateway.Services;

/// <summary>
/// Catálogo de planos — fonte da verdade server-side (ADR-059). 3 planos self-serve
/// (Essencial + Pro + Master); constante, sem tabela `plano_catalogo`, sem migration.
///
/// Modelo: todos os planos entregam a operação clínica completa (registros, escalas/MBC,
/// exames, agenda, teleconsulta, evolução) + segurança (crise/auditoria/LGPD — NUNCA
/// gateadas). O que escala por preço é a CAMADA DE IA doctor-facing, fatiada por tier:
///   • Essencial (R$ 397): núcleo clínico + Briefing IA (gostinho de IA).
///   • Pro       (R$ 597): + Insights dos 5 agentes + Busca semântica (RAG).
///   • Master    (R$ 997): + Escriba (transcrição + rascunho factual) = toda a IA.
///
/// Reusa os códigos físicos de `assinaturas.plano` (TEXT, sem CHECK): `starter`
/// = Essencial, `pro` = Pro, `master` = Master. `enterprise` fica como ALIAS legado
/// (Clínica antiga) — fora do self-checkout, herda toda a IA p/ não cegar linhas antigas.
/// `trial`/`pendente`/null/desconhecido = SEM feature de IA (fail-safe de custo: nunca
/// liberar LLM de graça). O valor cobrado vem SEMPRE daqui; o cliente nunca manda valor.
/// </summary>

/// Chaves de feature gateadas (camada IA). Use as constantes, não strings cruas.
public static class FeatureKeys
{
    public const string BriefingIa = "briefing_ia";  // resumo de IA no briefing pré-consulta
    public const string IaInsights = "ia_insights";  // 5 agentes analíticos + fila de insights
    public const string Rag        = "rag";           // busca semântica (prontuário + KB)
    public const string Escriba    = "escriba";       // transcrição + rascunho factual

    /// Toda a camada de IA (= o que o Master inclui). Mantido p/ aliases legados.
    public static readonly IReadOnlySet<string> CamadaIa =
        new HashSet<string> { BriefingIa, IaInsights, Rag, Escriba };

    // ── Conjuntos por tier (ADR-059) ──────────────────────────────────────────
    /// Essencial: só o gostinho de IA (briefing). Núcleo clínico não é feature gateada.
    public static readonly IReadOnlySet<string> Essencial =
        new HashSet<string> { BriefingIa };
    /// Pro: briefing + insights + RAG (a IA do dia-a-dia). Sem escriba.
    public static readonly IReadOnlySet<string> Pro =
        new HashSet<string> { BriefingIa, IaInsights, Rag };
    /// Master: toda a IA, incluindo escriba.
    public static readonly IReadOnlySet<string> Master = CamadaIa;
}

public sealed record PlanoCatalogo(
    string Codigo,
    string Label,
    decimal ValorCiclo,             // cobrado por ciclo no Asaas
    decimal ValorMensalEquivalente, // gravado em valor_mensal (MRR coerente)
    string Cycle,                   // "MONTHLY" (os 3 planos atuais são mensais)
    bool SelfCheckout,
    IReadOnlySet<string> Features); // features de IA liberadas pelo plano

public static class PlanCatalog
{
    public static readonly IReadOnlyDictionary<string, PlanoCatalogo> Planos =
        new Dictionary<string, PlanoCatalogo>(StringComparer.OrdinalIgnoreCase)
        {
            // Essencial: núcleo clínico completo + Briefing IA. Sem insights/RAG/escriba.
            ["starter"] = new("starter", "Essencial", 397.00m, 397.00m, "MONTHLY", true, FeatureKeys.Essencial),
            // Pro: + Insights + RAG.
            ["pro"]     = new("pro", "Pro", 597.00m, 597.00m, "MONTHLY", true, FeatureKeys.Pro),
            // Master: + Escriba (toda a camada de IA).
            ["master"]  = new("master", "Master", 997.00m, 997.00m, "MONTHLY", true, FeatureKeys.Master),
            // Clínica (legado, ADR-059 anterior): alias fora do self-checkout. Herda toda a
            // IA p/ não cortar quem o admin já tenha colocado aqui. Não é ofertado.
            ["enterprise"] = new("enterprise", "Clínica (legado)", 0.00m, 0.00m, "MONTHLY", false, FeatureKeys.CamadaIa),
        };

    public static PlanoCatalogo? TryGet(string? codigo) =>
        codigo is not null && Planos.TryGetValue(codigo, out var p) ? p : null;

    public static string CycleDe(string? codigo) => TryGet(codigo)?.Cycle ?? "MONTHLY";

    /// Códigos que o médico pode assinar sozinho (Essencial + Pro + Master).
    public static IReadOnlyList<string> CodigosSelfCheckout =>
        Planos.Values.Where(p => p.SelfCheckout).Select(p => p.Codigo).ToList();

    /// Features de IA liberadas pelo plano. Plano nulo/legado/desconhecido = nenhuma
    /// (fail-safe de custo: só plano conhecido libera IA paga).
    public static IReadOnlyCollection<string> FeaturesDe(string? codigo) =>
        TryGet(codigo)?.Features.ToList() ?? new List<string>();

    /// O plano tem a feature? (default fail-safe: plano nulo/desconhecido = sem IA.)
    public static bool TemFeature(string? codigo, string featureKey) =>
        TryGet(codigo)?.Features.Contains(featureKey) ?? false;
}
