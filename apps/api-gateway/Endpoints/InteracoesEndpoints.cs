using ApiGateway.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Globalization;
using System.Security.Claims;
using System.Text;

namespace ApiGateway.Endpoints;

/// <summary>
/// Rede de segurança de interações/duplicidade na prescrição (A5, ADR-032).
///
/// Checagem DETERMINÍSTICA contra uma base LOCAL versionada (medicamento_dicionario
/// + interacao_catalogo) — NÃO é IA, NÃO gera conduta. É uma SEGUNDA BARREIRA
/// factual ao MEMED. Cada medicamento (texto livre) é mapeado para genérico+classe
/// via substring de sinônimos; pares são cruzados contra o catálogo. A leitura e a
/// decisão são SEMPRE do médico. A base é DRAFT e requer revisão clínica.
/// Tenant: prescrições ativas do paciente só entram via JOIN pacientes.
/// </summary>
public static class InteracoesEndpoints
{
    private const string Disclaimer =
        "Segunda barreira factual (base local, não-exaustiva). NÃO substitui a "
        + "checagem do MEMED nem a bula/fonte oficial. A ausência de alerta não "
        + "garante ausência de interação. A decisão é sempre do médico.";

    public static void Map(WebApplication app)
    {
        app.MapPost("/api/v1/prescricoes/checar-interacoes", async (
            [FromBody] CheckarInteracoesRequest req, AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            // 1) Monta a lista de medicamentos a avaliar: os propostos +
            //    (se houver paciente) os ativos dele, escopados por tenant.
            var brutos = new List<string>();
            if (req.Medicamentos is not null) brutos.AddRange(req.Medicamentos);

            if (req.PacienteId is Guid pid)
            {
                var ativos = await db.Database.SqlQueryRaw<string>(@"
                    SELECT pr.medicamento AS ""Value""
                    FROM prescricoes pr
                    JOIN pacientes p ON p.cliente_id = pr.paciente_id
                    WHERE pr.ativa = TRUE AND pr.paciente_id = {0}
                      AND p.medico_responsavel_id = {1}
                    UNION ALL
                    -- Medicações EM USO (reconciliação, ADR-062): o que o paciente toma
                    -- por fora também entra na checagem — fecha o buraco de remédio externo.
                    SELECT mu.medicamento AS ""Value""
                    FROM medicacoes_em_uso mu
                    JOIN pacientes p2 ON p2.cliente_id = mu.paciente_id
                    WHERE mu.ativa = TRUE AND mu.paciente_id = {0}
                      AND p2.medico_responsavel_id = {1}",
                    pid, medicoId.Value).ToListAsync();
                brutos.AddRange(ativos);
            }

            // Dedup por forma normalizada (evita parear um medicamento com ele mesmo).
            var meds = new List<MedTokens>();
            var vistos = new HashSet<string>();
            foreach (var bruto in brutos)
            {
                var label = (bruto ?? "").Trim();
                if (label.Length == 0) continue;
                var norm = Norm(label);
                if (norm.Length == 0 || !vistos.Add(norm)) continue;
                meds.Add(new MedTokens(label, norm));
            }

            if (meds.Count < 1)
                return Results.Ok(new { alertas = Array.Empty<InteracaoAlerta>(), disclaimer = Disclaimer, catalogoVersao = (string?)null });

            // 2) Resolve cada medicamento → {genérico, classe} via dicionário.
            var dic = await db.Database.SqlQueryRaw<DicRow>(@"
                SELECT generico, classe, array_to_string(sinonimos, '|') AS sinonimos
                FROM medicamento_dicionario WHERE ativo = TRUE").ToListAsync();

            string? versao = null;
            foreach (var m in meds)
            {
                foreach (var d in dic)
                {
                    var sins = (d.Sinonimos ?? "").Split('|', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
                    var bate = sins.Any(s => m.Norm.Contains(s)) || (d.Generico.Length > 0 && m.Norm.Contains(d.Generico));
                    if (bate)
                    {
                        m.Tokens.Add(d.Generico);
                        m.Tokens.Add(d.Classe);
                        m.Genericos.Add(d.Generico);
                        m.Classes.Add(d.Classe);
                    }
                }
            }

            var alertas = new List<InteracaoAlerta>();
            var jaVisto = new HashSet<string>();

            // 3) Duplicidade: mesmo princípio ativo ou mesma classe entre 2 medicamentos.
            for (var i = 0; i < meds.Count; i++)
            for (var j = i + 1; j < meds.Count; j++)
            {
                var a = meds[i]; var b = meds[j];
                var gen = a.Genericos.Intersect(b.Genericos).FirstOrDefault();
                if (gen is not null)
                {
                    AddAlerta(alertas, jaVisto, new InteracaoAlerta(
                        "duplicidade", "moderada", a.Label, b.Label,
                        $"Mesmo princípio ativo ({gen}).",
                        "Confirmar se a duplicidade é intencional.", null));
                    continue; // já é duplicidade de genérico; não repetir como classe
                }
                var cls = a.Classes.Intersect(b.Classes).FirstOrDefault();
                if (cls is not null)
                {
                    AddAlerta(alertas, jaVisto, new InteracaoAlerta(
                        "duplicidade", "moderada", a.Label, b.Label,
                        $"Mesma classe terapêutica ({cls}).",
                        "Confirmar se a associação na mesma classe é intencional.", null));
                }
            }

            // 4) Interação: cruza cada par de medicamentos contra o catálogo.
            var cat = await db.Database.SqlQueryRaw<CatRow>(@"
                SELECT chave_a, tipo_a, chave_b, tipo_b, severidade, mecanismo,
                       recomendacao, fonte, catalogo_versao
                FROM interacao_catalogo WHERE ativo = TRUE").ToListAsync();

            foreach (var c in cat)
            {
                versao ??= c.CatalogoVersao;
                for (var i = 0; i < meds.Count; i++)
                for (var j = 0; j < meds.Count; j++)
                {
                    if (i == j) continue;
                    if (meds[i].Tokens.Contains(c.ChaveA) && meds[j].Tokens.Contains(c.ChaveB))
                    {
                        AddAlerta(alertas, jaVisto, new InteracaoAlerta(
                            "interacao", c.Severidade, meds[i].Label, meds[j].Label,
                            c.Mecanismo, c.Recomendacao, c.Fonte));
                    }
                }
            }

            // Graves primeiro.
            alertas = alertas
                .OrderBy(a => a.Severidade == "grave" ? 0 : 1)
                .ThenBy(a => a.Tipo)
                .ToList();

            return Results.Ok(new { alertas, disclaimer = Disclaimer, catalogoVersao = versao });
        })
        .WithTags("interacoes")
        .RequireAuthorization();
    }

    // Dedup de alerta por par (ordem-insensível) + mecanismo.
    private static void AddAlerta(List<InteracaoAlerta> acc, HashSet<string> seen, InteracaoAlerta a)
    {
        var par = string.CompareOrdinal(a.MedicamentoA, a.MedicamentoB) <= 0
            ? a.MedicamentoA + "|" + a.MedicamentoB
            : a.MedicamentoB + "|" + a.MedicamentoA;
        if (seen.Add(par + "|" + a.Mecanismo)) acc.Add(a);
    }

    // Normaliza: minúsculo, sem acento (casa com os tokens do seed, já em ASCII).
    private static string Norm(string s)
    {
        if (string.IsNullOrEmpty(s)) return "";
        var formD = s.ToLowerInvariant().Trim().Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder(formD.Length);
        foreach (var ch in formD)
            if (CharUnicodeInfo.GetUnicodeCategory(ch) != UnicodeCategory.NonSpacingMark)
                sb.Append(ch);
        return sb.ToString().Normalize(NormalizationForm.FormC);
    }

    private static async Task<Guid?> GetMedicoIdAsync(AppDbContext db, ClaimsPrincipal user)
    {
        var sub = user.FindFirst("sub")?.Value;
        if (!Guid.TryParse(sub, out var userId)) return null;
        return await db.Database.ExecuteScalarAsync<Guid?>(
            "SELECT id FROM medicos WHERE usuario_id = {0}", userId);
    }

    // Estado de resolução de um medicamento em memória.
    private sealed class MedTokens(string label, string norm)
    {
        public string Label { get; } = label;
        public string Norm { get; } = norm;
        public HashSet<string> Tokens { get; } = new();
        public HashSet<string> Genericos { get; } = new();
        public HashSet<string> Classes { get; } = new();
    }
}

public record CheckarInteracoesRequest(List<string>? Medicamentos, Guid? PacienteId);

public record InteracaoAlerta(
    string Tipo, string Severidade, string MedicamentoA, string MedicamentoB,
    string Mecanismo, string? Recomendacao, string? Fonte);

// `public` (não `file`): EF Core não materializa `SqlQueryRaw<T>` de tipo
// file-scoped — ShortName() estoura IndexOutOfRange no nome mangled (efcore #30115/#32323).
public record DicRow(string Generico, string Classe, string? Sinonimos);

public record CatRow(
    string ChaveA, string TipoA, string ChaveB, string TipoB, string Severidade,
    string Mecanismo, string Recomendacao, string Fonte, string CatalogoVersao);
