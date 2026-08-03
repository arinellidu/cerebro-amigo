using ApiGateway.Data;
using ApiGateway.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace ApiGateway.Endpoints;

/// <summary>
/// Endpoints de gerenciamento de prompts versionados (editor de prompts).
/// 
/// Permite que médicos com role=admin visualizem, editem e versionem
/// os prompts system dos agentes e do orchestrator.
/// 
/// As aplicações Python (orchestrator-py, agents-py) leem o prompt ativo
/// do banco em tempo de execução, com fallback para o builtin hardcoded.
/// </summary>
public static class PromptsEndpoints
{
    /// <summary>
    /// Salvaguardas clínicas que NÃO podem ser criadas/ativadas pelo painel
    /// (clinical-safety regras 2 e 3, ADR-035):
    ///  - orchestrator:crisis_detection — classificador de detecção de crise;
    ///  - orchestrator:audit — auditoria da resposta ao paciente.
    /// O orchestrator-py lê o prompt ATIVO do banco em runtime, então ativar uma
    /// versão maliciosa sobrescreveria a salvaguarda. A trava do front
    /// (lib/prompts-guard.ts) é só UX; ESTA é a fronteira de confiança real.
    /// Alterá-los exige decisão clínica + validação SHADOW + ADR, não um POST.
    /// </summary>
    private static readonly HashSet<string> PromptsTravados = new()
    {
        "orchestrator:crisis_detection",
        "orchestrator:audit",
    };

    private static bool EhTravado(string? agente, string? nome) =>
        PromptsTravados.Contains($"{agente}:{nome}");

    private static IResult RespostaTravado() => Results.Json(
        new
        {
            error = "prompt_travado",
            detalhe = "Prompt de salvaguarda clínica (detecção de crise / auditoria) "
                + "não pode ser alterado pelo painel — exige ADR e validação SHADOW.",
        },
        statusCode: StatusCodes.Status409Conflict);

    public static void Map(WebApplication app)
    {
        // Editor de prompts = poder de plataforma (salvaguarda crise/auditoria, ADR-035).
        // T0-6/ADR-068: SÓ owner — admin_financeiro não edita prompts.
        // (Os serviços Python leem o prompt ativo direto do banco, não por aqui.)
        var g = app.MapGroup("/api/v1/prompts")
            .WithTags("prompts")
            .RequireAuthorization("owner");

        // ─── LISTAR prompts ativos (todas as versões ativas) ────────────────────
        g.MapGet("/", async (AppDbContext db) =>
        {
            var rows = await db.Database.SqlQueryRaw<PromptAtivoDto>(@"
                SELECT p.id, p.agente, p.nome, p.versao, p.conteudo,
                       p.metadata, p.criado_em, u.nome AS criado_por_nome
                FROM prompts p
                LEFT JOIN usuarios u ON u.id = p.criado_por
                WHERE p.ativo = TRUE
                ORDER BY p.agente, p.nome").ToListAsync();
            return Results.Ok(rows);
        });

        // ─── HISTÓRICO de versões de um prompt ──────────────────────────────────
        g.MapGet("/{agente}/{nome}", async (
            string agente,
            string nome,
            AppDbContext db) =>
        {
            var rows = await db.Database.SqlQueryRaw<PromptVersaoDto>(@"
                SELECT p.id, p.versao, p.conteudo, p.ativo,
                       p.metadata, p.criado_em, u.nome AS criado_por_nome
                FROM prompts p
                LEFT JOIN usuarios u ON u.id = p.criado_por
                WHERE p.agente = {0} AND p.nome = {1}
                ORDER BY p.versao DESC", agente, nome).ToListAsync();
            return Results.Ok(rows);
        });

        // ─── CRIAR nova versão de prompt ────────────────────────────────────────
        // Requer role=admin.
        g.MapPost("/", async (
            [FromBody] CriarPromptRequest req,
            AppDbContext db,
            ClaimsPrincipal user) =>
        {
            if (!user.IsInRole("admin") && !user.IsInRole("owner"))
                return Results.Forbid();

            // Salvaguarda clínica: prompt de crise/auditoria não se edita pelo painel.
            if (EhTravado(req.Agente, req.Nome))
                return RespostaTravado();

            // T4-2: placeholder errado/chave solta = KeyError em runtime no
            // orchestrator → nó do grafo cai p/ todos os pacientes. Barra aqui.
            var erros = PromptValidation.Validar(req.Agente, req.Nome, req.Conteudo);
            if (erros.Count > 0)
                return Results.Json(new { error = "prompt_invalido", erros },
                    statusCode: StatusCodes.Status422UnprocessableEntity);

            var criadoPor = user.FindFirst("sub")?.Value
                ?? throw new InvalidOperationException("claim 'sub' ausente");

            // Calcula próxima versão
            // ADO.NET puro (DbExtensions): SqlQueryRaw<primitivo> + First*
            // compõe LIMIT sobre SQL não-composável (INSERT/agg) e quebra em
            // runtime — bug pego pela suite de integração (G-6).
            var ultimaVersao = await db.Database.ExecuteScalarAsync<int>(@"
                SELECT COALESCE(MAX(versao), 0)
                FROM prompts
                WHERE agente = {0} AND nome = {1}", req.Agente, req.Nome);

            var novaVersao = ultimaVersao + 1;

            var id = await db.Database.ExecuteScalarAsync<Guid>(@"
                INSERT INTO prompts
                    (agente, nome, versao, conteudo, metadata, criado_por)
                VALUES ({0}, {1}, {2}, {3}, {4}::jsonb, {5}::uuid)
                RETURNING id",
                req.Agente, req.Nome, novaVersao,
                req.Conteudo,
                string.IsNullOrEmpty(req.Metadata) ? "{}" : req.Metadata,
                criadoPor);

            return Results.Ok(new { id, versao = novaVersao });
        })
        .WithSummary("Criar nova versão de prompt (requer admin)");

        // ─── ATIVAR uma versão específica ──────────────────────────────────────
        // Desativa todas as outras versões do mesmo (agente, nome).
        g.MapPost("/{id:guid}/ativar", async (
            Guid id,
            AppDbContext db,
            ClaimsPrincipal user) =>
        {
            if (!user.IsInRole("admin") && !user.IsInRole("owner"))
                return Results.Forbid();

            var row = await db.Database.SqlQueryRaw<PromptAtivarTarget>(@"
                SELECT agente, nome, conteudo FROM prompts WHERE id = {0}", id).FirstOrDefaultAsync();

            if (row is null) return Results.NotFound();

            // Salvaguarda clínica: não permitir ativar versão de prompt travado
            // (ex.: ativar uma versão antiga/maliciosa de crisis_detection).
            if (EhTravado(row.Agente, row.Nome))
                return RespostaTravado();

            // T4-2: revalida na ativação — pega versões antigas, criadas antes
            // da validação existir (inclusive o caminho de rollback "Reverter").
            var erros = PromptValidation.Validar(row.Agente, row.Nome, row.Conteudo);
            if (erros.Count > 0)
                return Results.Json(new { error = "prompt_invalido", erros },
                    statusCode: StatusCodes.Status422UnprocessableEntity);

            await db.Database.ExecuteSqlRawAsync(@"
                UPDATE prompts SET ativo = FALSE
                WHERE agente = {0} AND nome = {1};
                UPDATE prompts SET ativo = TRUE
                WHERE id = {2}", row.Agente, row.Nome, id);

            return Results.Ok(new { ativado = id, agente = row.Agente, nome = row.Nome });
        })
        .WithSummary("Ativar versão de prompt (requer admin)");
    }
}

// ─── DTOs ───────────────────────────────────────────────────────────────────

public record PromptAtivoDto(
    Guid Id,
    string Agente,
    string Nome,
    int Versao,
    string Conteudo,
    string? Metadata,
    DateTime CriadoEm,
    string? CriadoPorNome);

public record PromptVersaoDto(
    Guid Id,
    int Versao,
    string Conteudo,
    bool Ativo,
    string? Metadata,
    DateTime CriadoEm,
    string? CriadoPorNome);

public record CriarPromptRequest(
    string Agente,
    string Nome,
    string Conteudo,
    string? Metadata);

public record PromptAtivarTarget(string Agente, string Nome, string Conteudo);
