using ApiGateway.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace ApiGateway.Endpoints;

/// <summary>
/// Newsletter do médico (free tier, ADR-065). Inscrição é automática no onboarding
/// (MedicoOnboardingService). Aqui ficam:
///   • POST /api/v1/newsletter/unsubscribe — ANÔNIMO, por token do link do e-mail.
///   • GET/PATCH /api/v1/me/newsletter — o médico logado vê e toggla a inscrição.
///
/// O ENVIO em si NÃO mora aqui: fica atrás da flag dark NEWSLETTER_SEND_ENABLED
/// (fail-closed) porque o SES production-access está pendente (CK-4). Enquanto a
/// flag estiver desligada, não há disparo de e-mail — só inscrição/cadastro.
///
/// A tabela `newsletter_inscricoes` NÃO tem RLS (identidade/marketing): o unsub é
/// anônimo (sem JWT → sem GUC de tenant), por isso o grupo /unsubscribe é AllowAnonymous
/// e NUNCA recebe RequireAssinaturaAtiva/RequireWriteAccess.
/// </summary>
public static class NewsletterEndpoints
{
    public static void Map(WebApplication app)
    {
        // ── Unsubscribe anônimo (link do e-mail) ────────────────────────────────
        var pub = app.MapGroup("/api/v1/newsletter").WithTags("newsletter");

        // Sempre 200 e idempotente: não vaza se o token existe (privacidade).
        pub.MapPost("/unsubscribe", async (
            [FromBody] UnsubscribeRequest req, AppDbContext db) =>
        {
            if (!string.IsNullOrWhiteSpace(req.Token))
            {
                await db.Database.ExecuteSqlRawAsync(@"
                    UPDATE newsletter_inscricoes
                       SET status = 'unsubscribed', unsubscribed_at = NOW()
                     WHERE unsub_token = {0} AND status <> 'unsubscribed'",
                    req.Token.Trim());
            }
            return Results.Ok(new { ok = true });
        })
        .AllowAnonymous()
        .WithSummary("Cancela inscrição na newsletter por token (anônimo)");

        // ── Toggle do próprio médico ────────────────────────────────────────────
        var me = app.MapGroup("/api/v1/me/newsletter").WithTags("newsletter").RequireAuthorization();

        me.MapGet("/", async (AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            var status = await db.Database.ExecuteScalarAsync<string>(
                "SELECT status FROM newsletter_inscricoes WHERE medico_id = {0}", medicoId.Value);
            return Results.Ok(new { inscrito = status == "subscribed", status });
        });

        me.MapPatch("/", async (
            [FromBody] NewsletterToggleRequest req, AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            if (req.Inscrito)
                await db.Database.ExecuteSqlRawAsync(@"
                    UPDATE newsletter_inscricoes
                       SET status = 'subscribed', unsubscribed_at = NULL
                     WHERE medico_id = {0}", medicoId.Value);
            else
                await db.Database.ExecuteSqlRawAsync(@"
                    UPDATE newsletter_inscricoes
                       SET status = 'unsubscribed', unsubscribed_at = NOW()
                     WHERE medico_id = {0}", medicoId.Value);

            return Results.NoContent();
        });

        // TODO(ADR-065 / CK-4): job de envio (SES in-region) atrás de NEWSLETTER_SEND_ENABLED,
        // fail-closed enquanto SES production-access não sair. Fora deste plano.
    }

    private static async Task<Guid?> GetMedicoIdAsync(AppDbContext db, ClaimsPrincipal user)
    {
        var sub = user.FindFirst("sub")?.Value;
        if (!Guid.TryParse(sub, out var userId)) return null;
        return await db.Database.ExecuteScalarAsync<Guid?>(
            "SELECT id FROM medicos WHERE usuario_id = {0}", userId);
    }
}

public record UnsubscribeRequest(string? Token);
public record NewsletterToggleRequest(bool Inscrito);
