using ApiGateway.Auth;
using ApiGateway.Data;
using ApiGateway.Services;
using Microsoft.EntityFrameworkCore;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text;
using System.Text.Json;

namespace ApiGateway.Endpoints;

/// <summary>
/// RAG (ADR-028) — busca semântica doctor-facing. O gateway é só PROXY: NÃO
/// chama LLM nem gera embedding (isso é Python). Deriva o tenant (medico_id) do
/// JWT e repassa ao agents-py com INTERNAL_API_TOKEN. Retrieval-only — devolve
/// trechos citados, nunca conduta (regra #1). O medico_id NUNCA vem do corpo do
/// cliente: é sempre resolvido do JWT validado aqui.
/// </summary>
public static class RagEndpoints
{
    public static void Map(WebApplication app)
    {
        // Busca no prontuário de UM paciente (+ KB). Tenant via JWT; o agents-py
        // refiltra por tenant + decifra a fonte no read.
        app.MapPost("/api/v1/pacientes/{id:guid}/rag/buscar", async (
            Guid id, BuscaRequest req, AppDbContext db, ClaimsPrincipal user,
            IHttpClientFactory httpFactory, IConfiguration cfg) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            // Defesa extra antes do proxy: o paciente é deste médico?
            var doMedico = await db.Database.ExecuteScalarAsync<bool?>(
                "SELECT TRUE FROM pacientes WHERE cliente_id = {0} AND medico_responsavel_id = {1}",
                id, medicoId.Value);
            if (doMedico != true) return Results.Forbid();

            return await ProxyBuscar(httpFactory, cfg, medicoId.Value, req, id);
        }).RequireFeature(FeatureKeys.Rag); // ADR-059: RAG/busca semântica = camada IA (Pro)

        // Busca só na base de conhecimento do médico (sem paciente).
        app.MapPost("/api/v1/rag/buscar", async (
            BuscaRequest req, AppDbContext db, ClaimsPrincipal user,
            IHttpClientFactory httpFactory, IConfiguration cfg) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();
            return await ProxyBuscar(httpFactory, cfg, medicoId.Value, req, null);
        }).RequireFeature(FeatureKeys.Rag); // ADR-059: RAG/busca semântica = camada IA (Pro)
    }

    private static async Task<IResult> ProxyBuscar(
        IHttpClientFactory httpFactory, IConfiguration cfg, Guid medicoId,
        BuscaRequest req, Guid? pacienteId)
    {
        if (string.IsNullOrWhiteSpace(req.Query))
            return Results.BadRequest(new { error = "query vazia" });

        var internalToken = cfg["INTERNAL_API_TOKEN"]
            ?? throw new InvalidOperationException("INTERNAL_API_TOKEN missing");

        var payload = JsonSerializer.Serialize(new
        {
            medico_id = medicoId,            // tenant do JWT — nunca do cliente
            query = req.Query,
            paciente_id = pacienteId,
            k = req.K,
            fontes = req.Fontes,
            incluir_kb = req.IncluirKb ?? true,
        });

        try
        {
            var http = httpFactory.CreateClient("agents-py");
            using var msg = new HttpRequestMessage(HttpMethod.Post, "/internal/rag/buscar")
            {
                Content = new StringContent(payload, Encoding.UTF8, "application/json"),
            };
            msg.Headers.Authorization = new AuthenticationHeaderValue("Bearer", internalToken);

            using var resp = await http.SendAsync(msg);
            var json = await resp.Content.ReadAsStringAsync();
            return resp.IsSuccessStatusCode
                ? Results.Content(json, "application/json")
                : Results.StatusCode((int)resp.StatusCode);
        }
        catch
        {
            // Busca semântica é auxiliar — falha do Python não derruba o dashboard.
            return Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
        }
    }

    private static async Task<Guid?> GetMedicoIdAsync(AppDbContext db, ClaimsPrincipal user)
    {
        var sub = user.FindFirst("sub")?.Value;
        if (!Guid.TryParse(sub, out var userId)) return null;
        return await db.Database.ExecuteScalarAsync<Guid?>(
            "SELECT id FROM medicos WHERE usuario_id = {0}", userId);
    }

    public record BuscaRequest(string Query, int? K, string[]? Fontes, bool? IncluirKb);
}
