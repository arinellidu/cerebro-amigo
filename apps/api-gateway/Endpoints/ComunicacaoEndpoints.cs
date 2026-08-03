using ApiGateway.Auth;
using ApiGateway.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;

namespace ApiGateway.Endpoints;

/// <summary>
/// Proxy para o rascunho de comunicação ADMINISTRATIVA gerado pela IA (Python).
///
/// O gateway nunca chama LLM — apenas encaminha ao orchestrator-py, que aplica o
/// guard imutável (clinical-safety #1: nunca conteúdo clínico). O texto volta
/// para o médico revisar/editar; o envio ao paciente é decisão humana.
/// </summary>
public static class ComunicacaoEndpoints
{
    public static void Map(WebApplication app)
    {
        // ADR-065: rascunho usa LLM (proxy ao orchestrator) → escrita IA. Gateado:
        // bloqueia trial read-only (403) e vencido (402); médico pagante passa.
        var g = app.MapGroup("/api/v1/comunicacao")
            .WithTags("comunicacao")
            .RequireAuthorization()
            .RequireAssinaturaAtiva()
            .RequireWriteAccess();

        g.MapPost("/rascunho", async (
            [FromBody] RascunhoRequest req, AppDbContext db, ClaimsPrincipal user,
            IHttpClientFactory httpFactory, IConfiguration cfg) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            // Tenant: se veio paciente, precisa ser do médico.
            if (req.PacienteId is Guid pid && !await db.Database.ExistsAsync(
                "SELECT 1 FROM pacientes WHERE cliente_id = {0} AND medico_responsavel_id = {1}",
                pid, medicoId.Value))
                return Results.Forbid();

            var orchUrl = cfg["ORCHESTRATOR_PY_URL"] ?? "http://localhost:8081";
            var token = cfg["INTERNAL_API_TOKEN"];

            var client = httpFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(30);

            using var msg = new HttpRequestMessage(
                HttpMethod.Post, $"{orchUrl}/internal/comunicacao/rascunho-admin");
            msg.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            msg.Content = JsonContent.Create(new
            {
                tipo = req.Tipo,
                nome_paciente = req.NomePaciente ?? "",
                contexto = req.Contexto ?? "",
            });

            try
            {
                var resp = await client.SendAsync(msg);
                if (!resp.IsSuccessStatusCode)
                    return Results.StatusCode((int)resp.StatusCode);
                var body = await resp.Content.ReadFromJsonAsync<RascunhoResposta>();
                return Results.Ok(body);
            }
            catch
            {
                return Results.StatusCode(502);
            }
        });
    }

    private static async Task<Guid?> GetMedicoIdAsync(AppDbContext db, ClaimsPrincipal user)
    {
        var sub = user.FindFirst("sub")?.Value;
        if (!Guid.TryParse(sub, out var userId)) return null;
        return await db.Database.ExecuteScalarAsync<Guid?>(
            "SELECT id FROM medicos WHERE usuario_id = {0}", userId);
    }
}

public record RascunhoRequest(Guid? PacienteId, string Tipo, string? NomePaciente, string? Contexto);

public record RascunhoResposta(string Rascunho, bool Administrativo);
