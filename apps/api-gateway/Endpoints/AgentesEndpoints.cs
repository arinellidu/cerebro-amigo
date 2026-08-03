using ApiGateway.Data;
using ApiGateway.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ApiGateway.Endpoints;

/// <summary>
/// Editor de prompts dos agentes analíticos.
/// GET lista todos; PATCH atualiza system_prompt / modelo_default / ativo.
/// </summary>
public static class AgentesEndpoints
{
    public static void Map(WebApplication app)
    {
        // Editor de prompts = poder de plataforma (salvaguarda crise/auditoria).
        // T0-6/ADR-068: SÓ owner — admin_financeiro não edita prompts de agente.
        var g = app.MapGroup("/api/v1/agentes")
            .WithTags("agentes")
            .RequireAuthorization("owner");

        g.MapGet("/", async (AppDbContext db) =>
            Results.Ok(await db.Agentes.OrderBy(a => a.Nome).ToListAsync()));

        g.MapPatch("/{id:guid}", async (
            Guid id,
            [FromBody] AtualizarAgenteRequest req,
            AppDbContext db) =>
        {
            var ag = await db.Agentes.FirstOrDefaultAsync(a => a.Id == id);
            if (ag is null) return Results.NotFound();

            if (req.SystemPrompt != null) ag.SystemPrompt = req.SystemPrompt;
            if (req.ModeloDefault != null) ag.ModeloDefault = req.ModeloDefault;
            if (req.Ativo.HasValue) ag.Ativo = req.Ativo.Value;
            ag.AtualizadoEm = DateTime.UtcNow;

            await db.SaveChangesAsync();
            return Results.Ok(ag);
        });
    }
}
