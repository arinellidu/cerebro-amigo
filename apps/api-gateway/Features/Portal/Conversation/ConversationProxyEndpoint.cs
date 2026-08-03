using Microsoft.Extensions.Options;

namespace ApiGateway.Features.Portal.Conversation;

/// <summary>
/// Endpoint que recebe a mensagem do paciente no PWA e faz proxy
/// transparente do stream SSE entre o orchestrator-py (grafo
/// conversacional) e o navegador.
///
/// Mapeado em <c>POST /api/portal/conversation/message</c> com policy
/// <c>"paciente"</c> (role=paciente no JWT). Não responde para tokens
/// de médico.
/// </summary>
public static class ConversationProxyEndpoint
{
    private const string ContextSourceTag = "pwa";

    // UTF-8 literal — zero alocação no path quente
    private static readonly byte[] StreamErrorEventBytes =
        "event: error\ndata: {\"message\":\"upstream stream error\"}\n\n"u8.ToArray();

    /// <summary>
    /// Registra a rota. Chamar em <c>Program.cs</c> após
    /// <c>app.UseAuthentication() + app.UseAuthorization()</c>.
    /// </summary>
    public static IEndpointConventionBuilder MapPortalConversation(this IEndpointRouteBuilder app)
    {
        var group = app
            .MapGroup("/api/portal/conversation")
            .RequireAuthorization("paciente")            // policy já registrada no Program.cs
            .WithTags("Portal · Conversation");

        group.MapPost("/message", HandleMessageAsync)
            .WithName("PortalConversationMessage")
            .WithDescription(
                "Recebe mensagem do paciente (PWA) e faz proxy SSE para o "
                + "orchestrator-py. paciente_id vem do JWT, nunca do body.");

        return group;
    }

    private static async Task HandleMessageAsync(
        HttpContext ctx,
        PortalConversationRequest body,
        OrchestratorStreamClient orchestrator,
        IOptions<OrchestratorStreamOptions> opts,
        ILogger<OrchestratorStreamClient> logger)
    {
        var ct = ctx.RequestAborted;

        // ─── 1. Extrair paciente_id do JWT ────────────────────────────
        var claimName = opts.Value.PacienteIdClaim;
        var pacienteClaim = ctx.User.FindFirst(claimName)?.Value;
        if (string.IsNullOrEmpty(pacienteClaim) || !Guid.TryParse(pacienteClaim, out var pacienteId))
        {
            ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
            await ctx.Response.WriteAsJsonAsync(
                new { error = $"missing or invalid '{claimName}' claim in JWT" }, ct);
            return;
        }

        // ─── 2. Validar body ──────────────────────────────────────────
        if (string.IsNullOrWhiteSpace(body.Mensagem))
        {
            ctx.Response.StatusCode = StatusCodes.Status400BadRequest;
            await ctx.Response.WriteAsJsonAsync(new { error = "mensagem is required" }, ct);
            return;
        }
        if (body.IdempotencyKey == Guid.Empty)
        {
            ctx.Response.StatusCode = StatusCodes.Status400BadRequest;
            await ctx.Response.WriteAsJsonAsync(
                new { error = "idempotencyKey (UUID) is required" }, ct);
            return;
        }

        // ─── 3. Montar request upstream ───────────────────────────────
        var upstreamRequest = new OrchestratorMessageRequest(
            PacienteId: pacienteId,
            Mensagem: body.Mensagem,
            IdempotencyKey: body.IdempotencyKey.ToString(),
            Canal: ContextSourceTag);

        HttpResponseMessage upstream;
        try
        {
            upstream = await orchestrator.SendMessageAsync(upstreamRequest, ct);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            logger.LogError(ex,
                "Orchestrator unreachable for paciente {PacienteId}", pacienteId);
            ctx.Response.StatusCode = StatusCodes.Status502BadGateway;
            await ctx.Response.WriteAsJsonAsync(new { error = "orchestrator unreachable" }, ct);
            return;
        }

        try
        {
            // ─── 4. Upstream respondeu, mas com erro? ─────────────────
            if (!upstream.IsSuccessStatusCode)
            {
                var status = (int)upstream.StatusCode;
                var upstreamBody = await upstream.Content.ReadAsStringAsync(ct);
                // NÃO logar o body: pode conter texto de resposta ao paciente
                // (conteúdo clínico / PII — LGPD categoria especial).
                logger.LogWarning(
                    "Orchestrator returned {Status} for paciente {PacienteId}",
                    upstream.StatusCode, pacienteId);

                ctx.Response.StatusCode = status;
                ctx.Response.ContentType = upstream.Content.Headers.ContentType?.ToString()
                                           ?? "application/json";
                await ctx.Response.WriteAsync(upstreamBody, ct);
                return;
            }

            // ─── 5. Upstream OK — configurar SSE downstream ───────────
            ctx.Response.Headers.ContentType = "text/event-stream";
            ctx.Response.Headers.CacheControl = "no-cache";
            ctx.Response.Headers["X-Accel-Buffering"] = "no";

            await using var upstreamStream = await upstream.Content.ReadAsStreamAsync(ct);

            try
            {
                await upstreamStream.CopyToAsync(ctx.Response.Body, ct);
                await ctx.Response.Body.FlushAsync(ct);
            }
            catch (OperationCanceledException)
            {
                logger.LogInformation(
                    "Client disconnected mid-stream for paciente {PacienteId}", pacienteId);
            }
            catch (Exception ex)
            {
                logger.LogError(ex,
                    "Stream error for paciente {PacienteId}", pacienteId);
                try
                {
                    await ctx.Response.Body.WriteAsync(StreamErrorEventBytes, ct);
                    await ctx.Response.Body.FlushAsync(ct);
                }
                catch
                {
                    // conexão já estava perdida
                }
            }
        }
        finally
        {
            upstream.Dispose();
        }
    }
}
