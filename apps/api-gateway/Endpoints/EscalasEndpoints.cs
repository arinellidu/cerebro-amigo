using ApiGateway.Data;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace ApiGateway.Endpoints;

/// <summary>
/// Escalas clínicas (PHQ-9 / GAD-7) — Measurement-Based Care (S1).
///
/// Dois lados:
///   • paciente: GET do instrumento versionado p/ renderizar o formulário no portal.
///   • médico:   GET do histórico longitudinal (trajetória, resposta, remissão).
///
/// O instrumento (texto dos itens/opções) é PADRONIZADO e versionado aqui —
/// não é copy gerada por IA. O scoring é determinístico (soma 0-3). A leitura
/// clínica é do médico; a IA não interpreta (regra #1). O item 9 do PHQ-9 é
/// ideação suicida → o gate de crise vive no fluxo de resposta (CheckinsEndpoints),
/// reusando o protocolo fixo.
/// </summary>
public static class EscalasEndpoints
{
    public static void Map(WebApplication app)
    {
        // Instrumento p/ o portal renderizar (paciente autenticado).
        app.MapGet("/api/v1/portal/paciente/escalas/{codigo}", (string codigo) =>
        {
            var def = EscalasCatalogo.Buscar(codigo.ToLowerInvariant());
            return def is null ? Results.NotFound() : Results.Ok(def);
        })
        .WithTags("paciente-escalas")
        .RequireAuthorization("paciente");

        // Histórico longitudinal de um paciente (médico). Tenant via JOIN.
        app.MapGet("/api/v1/pacientes/{id:guid}/escalas/historico", async (
            Guid id, AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            var rows = await db.Database.SqlQueryRaw<RespostaEscalaRow>(@"
                SELECT q.codigo, qr.score_total, qr.respondido_em
                FROM questionarios_respostas qr
                JOIN questionarios q ON q.id = qr.questionario_id
                JOIN pacientes p ON p.cliente_id = qr.paciente_id
                WHERE qr.paciente_id = {0} AND p.medico_responsavel_id = {1}
                ORDER BY qr.respondido_em",
                id, medicoId.Value).ToListAsync();

            var ultimaTroca = await db.Database.ExecuteScalarAsync<DateTime?>(@"
                SELECT MAX(pe.criado_em) FROM prescricao_eventos pe
                JOIN pacientes p ON p.cliente_id = pe.paciente_id
                WHERE pe.paciente_id = {0} AND p.medico_responsavel_id = {1}
                  AND pe.tipo IN ('adicao', 'troca', 'ajuste')",
                id, medicoId.Value);

            var escalas = rows
                .GroupBy(r => r.Codigo)
                .Select(g => CalcularDesfecho(g.Key, g.OrderBy(x => x.RespondidoEm).ToList()))
                .ToList();

            return Results.Ok(new HistoricoEscalasDto(escalas, ultimaTroca));
        })
        .WithTags("escalas")
        .RequireAuthorization();
    }

    /// <summary>
    /// Métricas de Measurement-Based Care a partir da série (ordenada no tempo):
    /// baseline (1º), atual (último), variação %, resposta (queda ≥50%),
    /// remissão (&lt;5), tempo até resposta (dias até a 1ª queda ≥50%). Tudo factual.
    /// </summary>
    private static DesfechoEscalaDto CalcularDesfecho(string codigo, List<RespostaEscalaRow> serie)
    {
        var pontos = serie.Select(r => new PontoEscalaDto(
            r.ScoreTotal,
            EscalasCatalogo.Interpretar(codigo, r.ScoreTotal),
            r.RespondidoEm)).ToList();

        var baseline = serie[0].ScoreTotal;
        var atual = serie[^1].ScoreTotal;
        var limiarResposta = baseline / 2.0; // queda ≥ 50%

        int? variacaoPct = baseline > 0
            ? (int)Math.Round((atual - baseline) / (double)baseline * 100)
            : null;
        var resposta = baseline > 0 && atual <= limiarResposta;
        var remissao = EscalasCatalogo.EmRemissao(atual);

        int? tempoAteRespostaDias = null;
        if (baseline > 0)
        {
            var primeira = serie.FirstOrDefault(r => r.ScoreTotal <= limiarResposta);
            if (primeira is not null)
                tempoAteRespostaDias = (int)Math.Round((primeira.RespondidoEm - serie[0].RespondidoEm).TotalDays);
        }

        var def = EscalasCatalogo.Buscar(codigo);
        return new DesfechoEscalaDto(
            codigo, def?.Nome ?? codigo, pontos,
            baseline, atual, variacaoPct, resposta, remissao, tempoAteRespostaDias);
    }

    private static async Task<Guid?> GetMedicoIdAsync(AppDbContext db, ClaimsPrincipal user)
    {
        var sub = user.FindFirst("sub")?.Value;
        if (!Guid.TryParse(sub, out var userId)) return null;
        return await db.Database.ExecuteScalarAsync<Guid?>(
            "SELECT id FROM medicos WHERE usuario_id = {0}", userId);
    }
}

// ─── Catálogo versionado dos instrumentos (texto padronizado, não-IA) ─────────

public static class EscalasCatalogo
{
    public const string Versao = "phq9-gad7-v1";

    // Opções de frequência (últimas 2 semanas), valores 0-3 — comuns às duas escalas.
    private static readonly OpcaoEscala[] OpcoesPadrao =
    [
        new("Nenhuma vez", 0),
        new("Vários dias", 1),
        new("Mais da metade dos dias", 2),
        new("Quase todos os dias", 3),
    ];

    private static readonly EscalaDef Phq9 = new(
        "phq9",
        "PHQ-9 — Sintomas depressivos",
        "Nas últimas 2 semanas, com que frequência você foi incomodado(a) por:",
        OpcoesPadrao,
        [
            "Pouco interesse ou pouco prazer em fazer as coisas",
            "Sentir-se para baixo, deprimido(a) ou sem esperança",
            "Dificuldade para pegar no sono, continuar dormindo ou dormir demais",
            "Sentir-se cansado(a) ou com pouca energia",
            "Falta de apetite ou comer demais",
            "Sentir-se mal consigo mesmo(a), achar que é um fracasso ou que decepcionou a si ou à família",
            "Dificuldade de se concentrar nas coisas (ler, ver televisão)",
            "Lentidão para se mover ou falar — ou o oposto: muito agitado(a) e inquieto(a)",
            "Pensar que seria melhor estar morto(a) ou em se machucar de algum jeito",
        ],
        ItemIdeacaoIndice: 8); // 0-based: 9º item = ideação suicida → gate de crise

    private static readonly EscalaDef Gad7 = new(
        "gad7",
        "GAD-7 — Sintomas de ansiedade",
        "Nas últimas 2 semanas, com que frequência você foi incomodado(a) por:",
        OpcoesPadrao,
        [
            "Sentir-se nervoso(a), ansioso(a) ou muito tenso(a)",
            "Não conseguir parar ou controlar as preocupações",
            "Preocupar-se demais com diversas coisas",
            "Dificuldade para relaxar",
            "Ficar tão agitado(a) que se torna difícil ficar parado(a)",
            "Ficar facilmente aborrecido(a) ou irritado(a)",
            "Sentir medo como se algo terrível fosse acontecer",
        ],
        ItemIdeacaoIndice: null);

    public static EscalaDef? Buscar(string codigo) => codigo switch
    {
        "phq9" => Phq9,
        "gad7" => Gad7,
        _ => null,
    };

    // Faixas de severidade (cutoffs padrão dos instrumentos).
    public static string Interpretar(string codigo, int score) => codigo switch
    {
        "phq9" => score switch
        { < 5 => "minima", < 10 => "leve", < 15 => "moderada", < 20 => "moderadamente_grave", _ => "grave" },
        "gad7" => score switch
        { < 5 => "minima", < 10 => "leve", < 15 => "moderada", _ => "grave" },
        _ => "desconhecida",
    };

    // Remissão (Measurement-Based Care): PHQ-9 < 5 e GAD-7 < 5.
    public static bool EmRemissao(int score) => score < 5;

    /// <summary>Chave do item de ideação no JSON de respostas (q{n}, 1-based). Só PHQ-9.</summary>
    public static string? ChaveItemIdeacao(string codigo)
        => Buscar(codigo)?.ItemIdeacaoIndice is int i ? $"q{i + 1}" : null;
}

public record OpcaoEscala(string Label, int Valor);

public record EscalaDef(
    string Codigo, string Nome, string Instrucao,
    OpcaoEscala[] Opcoes, string[] Itens, int? ItemIdeacaoIndice);

public record RespostaEscalaRow(string Codigo, int ScoreTotal, DateTime RespondidoEm);

public record PontoEscalaDto(int Score, string Interpretacao, DateTime RespondidoEm);

public record DesfechoEscalaDto(
    string Codigo, string Nome, List<PontoEscalaDto> Pontos,
    int Baseline, int Atual, int? VariacaoPct,
    bool Resposta, bool Remissao, int? TempoAteRespostaDias);

public record HistoricoEscalasDto(List<DesfechoEscalaDto> Escalas, DateTime? UltimaTrocaMedicacao);
