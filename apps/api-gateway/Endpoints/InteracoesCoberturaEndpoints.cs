using ApiGateway.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Globalization;
using System.Text;

namespace ApiGateway.Endpoints;

/// <summary>
/// Relatório de PONTOS-CEGOS do A5 (ADR-032/ADR-057): quais medicamentos prescritos
/// o `medicamento_dicionario` NÃO reconhece — ou seja, hoje passam SEM checagem de
/// interação (silenciosamente). É o worklist priorizado por frequência para a
/// revisão clínica do catálogo (Dr. Adonai expande o que aparece, por uso real).
///
/// DETERMINÍSTICO, read-only, sem IA. Admin (owner/admin), ZERO escopo de tenant —
/// vê a plataforma toda. O matching ESPELHA InteracoesEndpoints (mesma Norm +
/// substring de sinônimos/genérico), senão o relatório discordaria do motor.
/// </summary>
public static class InteracoesCoberturaEndpoints
{
    public static void Map(WebApplication app)
    {
        // T0-6/ADR-068: catálogo clínico de interações → SÓ owner (não admin_financeiro).
        var g = app.MapGroup("/api/v1/admin/interacoes")
            .WithTags("admin")
            .RequireAuthorization("owner");

        // ativasApenas=true limita às prescrições ativas; default = todo o vocabulário
        // já prescrito (cobertura é sobre o texto, não o estado).
        g.MapGet("/cobertura", async (AppDbContext db, [FromQuery] bool ativasApenas = false) =>
        {
            // Distintos medicamentos prescritos + frequência (sem tenant: admin vê tudo).
            // SQL montada em variável (não interpolada no call site): `ativasApenas`
            // só injeta um literal constante, sem dado de usuário (sem risco de injeção).
            var sql =
                @"SELECT medicamento AS ""Medicamento"", COUNT(*)::int AS ""Ocorrencias"" " +
                "FROM prescricoes " +
                "WHERE medicamento IS NOT NULL AND btrim(medicamento) <> '' " +
                (ativasApenas ? "AND ativa = TRUE " : "") +
                "GROUP BY medicamento";
            var presc = await db.Database.SqlQueryRaw<MedCountRow>(sql).ToListAsync();

            var dic = await db.Database.SqlQueryRaw<CobDicRow>(@"
                SELECT generico, array_to_string(sinonimos, '|') AS sinonimos, catalogo_versao
                FROM medicamento_dicionario WHERE ativo = TRUE").ToListAsync();

            string? versao = dic.Count > 0 ? dic[0].CatalogoVersao : null;

            var naoReconhecidos = new List<MedNaoReconhecido>();
            var reconhecidos = 0;
            foreach (var p in presc)
            {
                var norm = Norm(p.Medicamento);
                // Texto que não normaliza (só diacríticos/lixo) nunca casa no dicionário
                // → conta como não-reconhecido (mantém Reconhecidos + NaoReconhecidos == DistintosTotal).
                var bate = norm.Length > 0 && dic.Any(d =>
                {
                    var sins = (d.Sinonimos ?? "").Split('|', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
                    return sins.Any(s => norm.Contains(s)) || (d.Generico.Length > 0 && norm.Contains(d.Generico));
                });
                if (bate) reconhecidos++;
                else naoReconhecidos.Add(new MedNaoReconhecido(p.Medicamento, p.Ocorrencias));
            }

            naoReconhecidos = naoReconhecidos
                .OrderByDescending(x => x.Ocorrencias)
                .ThenBy(x => x.Medicamento)
                .ToList();

            return Results.Ok(new CoberturaInteracoesResposta(
                DistintosTotal: presc.Count,
                Reconhecidos: reconhecidos,
                NaoReconhecidos: naoReconhecidos.Count,
                DicionarioTamanho: dic.Count,
                CatalogoVersao: versao,
                AtivasApenas: ativasApenas,
                Itens: naoReconhecidos));
        });
    }

    // Espelha InteracoesEndpoints.Norm: minúsculo, sem acento (tokens do seed são ASCII).
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
}

// `public` (não `file`): file-scoped quebra EF Core SqlQueryRaw<T> (efcore #30115/#32323).
public record MedCountRow(string Medicamento, int Ocorrencias);
public record CobDicRow(string Generico, string? Sinonimos, string CatalogoVersao);

public record MedNaoReconhecido(string Medicamento, int Ocorrencias);

public record CoberturaInteracoesResposta(
    int DistintosTotal, int Reconhecidos, int NaoReconhecidos, int DicionarioTamanho,
    string? CatalogoVersao, bool AtivasApenas, List<MedNaoReconhecido> Itens);
