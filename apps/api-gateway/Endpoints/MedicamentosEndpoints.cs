using System.Security.Claims;
using ApiGateway.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ApiGateway.Endpoints;

public static class MedicamentosEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/medicamentos")
            .WithTags("medicamentos")
            .RequireAuthorization();

        // GET /api/v1/medicamentos?q=sertra&apenasDestaque=false&limit=20
        g.MapGet("/", async (
            AppDbContext db,
            [FromQuery] string? q,
            [FromQuery] bool apenasDestaque = false,
            [FromQuery] int limit = 20) =>
        {
            limit = Math.Clamp(limit, 1, 50);
            var termo = (q ?? "").Trim();

            string sql;
            object[] parametros;

            if (string.IsNullOrEmpty(termo) && apenasDestaque)
            {
                sql = @"SELECT id, nome_comercial, nome_generico, classe_terapeutica,
                              indicacoes_resumo, dosagens, formas_farmaceuticas,
                              registro_anvisa, laboratorio, observacoes, em_destaque
                       FROM medicamentos
                       WHERE ativo = TRUE AND em_destaque = TRUE
                       ORDER BY nome_generico
                       LIMIT {0}";
                parametros = new object[] { limit };
            }
            else if (string.IsNullOrEmpty(termo))
            {
                sql = @"SELECT id, nome_comercial, nome_generico, classe_terapeutica,
                              indicacoes_resumo, dosagens, formas_farmaceuticas,
                              registro_anvisa, laboratorio, observacoes, em_destaque
                       FROM medicamentos
                       WHERE ativo = TRUE
                       ORDER BY em_destaque DESC, nome_generico
                       LIMIT {0}";
                parametros = new object[] { limit };
            }
            else
            {
                // Full-text search com fallback ILIKE
                sql = @"SELECT id, nome_comercial, nome_generico, classe_terapeutica,
                              indicacoes_resumo, dosagens, formas_farmaceuticas,
                              registro_anvisa, laboratorio, observacoes, em_destaque
                       FROM medicamentos
                       WHERE ativo = TRUE
                         AND (
                           nome_generico ILIKE {0}
                           OR nome_comercial ILIKE {0}
                           OR to_tsvector('portuguese',
                                coalesce(nome_comercial,'') || ' ' || nome_generico || ' ' || classe_terapeutica)
                              @@ plainto_tsquery('portuguese', {1})
                         )
                       ORDER BY em_destaque DESC,
                                CASE WHEN lower(nome_generico) LIKE lower({2}) THEN 1 ELSE 2 END,
                                nome_generico
                       LIMIT {3}";
                parametros = new object[] { $"%{termo}%", termo, $"{termo}%", limit };
            }

            var rows = await db.Database.SqlQueryRaw<MedicamentoDto>(sql, parametros).ToListAsync();
            return Results.Ok(rows);
        });

        // GET /api/v1/medicamentos/{id}
        g.MapGet("/{id:guid}", async (Guid id, AppDbContext db) =>
        {
            var sql = @"SELECT id, nome_comercial, nome_generico, classe_terapeutica,
                              indicacoes_resumo, dosagens, formas_farmaceuticas,
                              registro_anvisa, laboratorio, observacoes, em_destaque
                       FROM medicamentos
                       WHERE id = {0} AND ativo = TRUE
                       LIMIT 1";
            var row = await db.Database.SqlQueryRaw<MedicamentoDto>(sql, id).FirstOrDefaultAsync();
            return row is null ? Results.NotFound() : Results.Ok(row);
        });

        // GET /api/v1/medicamentos/classes (lista classes terapêuticas distintas)
        g.MapGet("/classes", async (AppDbContext db) =>
        {
            var rows = await db.Database
                .SqlQueryRaw<ClasseDto>(@"SELECT DISTINCT classe_terapeutica AS classe
                                          FROM medicamentos
                                          WHERE ativo = TRUE
                                          ORDER BY classe_terapeutica")
                .ToListAsync();
            return Results.Ok(rows);
        });

        // GET /api/v1/medicamentos/agrupado — catálogo completo p/ o picker por classe.
        // Read-only e NÃO-tenant (`medicamentos` é dicionário global). O cliente agrupa
        // por classe_terapeutica. Cap alto: catálogo é pequeno, mas cresce com a curadoria
        // do A5 (não confiar no LIMIT 50 da busca). Ordenado p/ agrupamento estável.
        g.MapGet("/agrupado", async (AppDbContext db) =>
        {
            var rows = await db.Database
                .SqlQueryRaw<MedicamentoItemDto>(@"SELECT id, nome_comercial, nome_generico, classe_terapeutica
                                                  FROM medicamentos
                                                  WHERE ativo = TRUE
                                                  ORDER BY classe_terapeutica, nome_generico
                                                  LIMIT 1000")
                .ToListAsync();
            return Results.Ok(rows);
        });
    }
}

public record MedicamentoDto(
    Guid Id,
    string? NomeComercial,
    string NomeGenerico,
    string ClasseTerapeutica,
    string? IndicacoesResumo,
    string[] Dosagens,
    string[] FormasFarmaceuticas,
    string? RegistroAnvisa,
    string? Laboratorio,
    string? Observacoes,
    bool EmDestaque
);

public record ClasseDto(string Classe);

// Item enxuto do catálogo p/ o picker por classe (GET /agrupado). `public` (não `file`):
// `file record` quebra EF SqlQueryRaw<T> em runtime (IndexOutOfRangeException no ShortName).
public record MedicamentoItemDto(
    Guid Id,
    string? NomeComercial,
    string NomeGenerico,
    string ClasseTerapeutica
);
