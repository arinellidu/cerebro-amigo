using ApiGateway.Data;
using ApiGateway.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using System.Text.Json;

namespace ApiGateway.Endpoints;

/// <summary>
/// Configurações do próprio médico (timezone, horário de trabalho, preferências
/// de notificação). Escopo = self, via GetMedicoIdAsync. Consumido pela agenda,
/// pelo agendamento de conduta e pela notificação externa (canal opt-in).
/// </summary>
public static class ConfigEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/me/config").WithTags("config").RequireAuthorization();

        g.MapGet("/", async (AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            var cfg = await db.Database.SqlQueryRaw<MedicoConfigDto>(@"
                SELECT timezone,
                       horario_trabalho::text AS horario_trabalho,
                       notif_prefs::text AS notif_prefs,
                       crm, crm_uf, cpf
                FROM medicos WHERE id = {0}",
                medicoId.Value).FirstOrDefaultAsync();

            return cfg is null ? Results.NotFound() : Results.Ok(cfg);
        });

        g.MapPatch("/", async (
            [FromBody] MedicoConfigPatchRequest req, AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            var horario = req.HorarioTrabalho?.GetRawText() ?? "";
            var prefs = req.NotifPrefs?.GetRawText() ?? "";

            // CPF (opcional): valida dígitos verificadores e grava NORMALIZADO (só dígitos).
            // O self-checkout passa o CPF cru pro Asaas, que rejeita formato com pontos/traço.
            var cpfNorm = "";
            if (!string.IsNullOrWhiteSpace(req.Cpf))
            {
                if (!Cpf.Valido(req.Cpf)) return Results.BadRequest(new { error = "cpf_invalido" });
                cpfNorm = Cpf.Normalizar(req.Cpf);
            }

            await db.Database.ExecuteSqlRawAsync(@"
                UPDATE medicos SET
                    timezone         = COALESCE(NULLIF({1}, ''), timezone),
                    horario_trabalho = COALESCE(NULLIF({2}, '')::jsonb, horario_trabalho),
                    notif_prefs      = COALESCE(NULLIF({3}, '')::jsonb, notif_prefs),
                    crm_uf           = COALESCE(NULLIF({4}, ''), crm_uf),
                    cpf              = COALESCE(NULLIF({5}, ''), cpf)
                WHERE id = {0}",
                medicoId.Value, req.Timezone ?? "", horario, prefs,
                req.CrmUf ?? "", cpfNorm);

            return Results.NoContent();
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

public record MedicoConfigDto(
    string Timezone, string HorarioTrabalho, string NotifPrefs,
    string? Crm, string? CrmUf, string? Cpf);

public record MedicoConfigPatchRequest(
    string? Timezone, JsonElement? HorarioTrabalho, JsonElement? NotifPrefs,
    string? CrmUf, string? Cpf);
