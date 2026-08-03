using ApiGateway.Auth;
using ApiGateway.Data;
using ApiGateway.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using System.Text.Json;

namespace ApiGateway.Endpoints;

/// <summary>
/// Teleconsulta por vídeo (WebRTC P2P) — sinalização e ciclo de vida.
///
/// A mídia é peer-to-peer (E2E, DTLS-SRTP) e NUNCA passa pelo gateway; aqui só
/// trafega a SINALIZAÇÃO (offer/answer/ICE), repassada de um peer ao outro pelo
/// <see cref="TeleconsultaSignalingHub"/>. Não há gravação (ADR-026).
///
/// Acesso (regra clínica: tenant é a 1ª cláusula, revalidado em TODA chamada):
///   • médico   → consulta dele (JOIN pacientes.medico_responsavel_id)
///   • paciente → a própria consulta (paciente_id)
/// Só consultas com modalidade = 'teleconsulta'. O hub pareia por consulta_id,
/// então só o médico responsável e o paciente dono podem estar na mesma sala.
///
/// Transporte da sinalização: SSE (servidor→cliente, GET /sinal) + POST /sinal
/// (cliente→servidor), no mesmo padrão de proxy do resto do BFF. EventSource não
/// envia header; quem autentica é o BFF (injeta o cookie de sessão como Bearer).
/// </summary>
public static class TeleconsultaEndpoints
{
    private static readonly HashSet<string> TiposSinal = ["offer", "answer", "candidate", "bye"];

    // Expiração do link (migration 0058). Verdadeiro quando AGORA já passou do
    // menor entre: a finalização manual (video_link_expira_em, NULL = nunca) e o
    // cap implícito de 120 min após o fim previsto (inicia_em + duracao_min).
    // Colunas SEM alias de propósito: resolvem para `consultas` tanto na query do
    // médico (JOIN pacientes, que não tem essas colunas) quanto na do paciente.
    private const string LinkExpiradoSql =
        "(NOW() > LEAST(" +
        "COALESCE(video_link_expira_em, 'infinity'::timestamptz), " +
        "inicia_em + ((duracao_min + 120) * INTERVAL '1 minute')))";

    public static void Map(WebApplication app)
    {
        // ─── Médico ───────────────────────────────────────────────────────
        var med = app.MapGroup("/api/v1/consultas/{id:guid}/video")
            .WithTags("teleconsulta-medico")
            .RequireAuthorization()
            .RequireAssinaturaAtiva()  // ADR-065: iniciar teleconsulta = operacional (só lado médico)
            .RequireWriteAccess();     // trial read-only bloqueia; vencido cai no paywall

        med.MapPost("/entrar", async (
            Guid id, AppDbContext db, ClaimsPrincipal user, TurnCredentialService turn) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            var row = await db.Database.SqlQueryRaw<VideoConsultaRow>(@"
                SELECT co.modalidade, co.status, " + LinkExpiradoSql + @" AS link_expirado
                FROM consultas co
                JOIN pacientes p ON p.cliente_id = co.paciente_id
                WHERE co.id = {0} AND p.medico_responsavel_id = {1}",
                id, medicoId.Value).FirstOrDefaultAsync();

            var erro = ValidarEntrada(row);
            if (erro is not null) return erro;

            await MarcarSalaAbertaAsync(db, id);
            await AuditarAsync(db, id, TeleconsultaSignalingHub.PapelMedico, "entrou");

            return Results.Ok(new EntrarResponse(
                id, TeleconsultaSignalingHub.PapelMedico, turn.BuildIceServers(id.ToString())));
        });

        // Encerrar a sala (só o médico). Não muda consulta.status — o desfecho
        // (notas + 'realizada') é registrado à parte em /consultas/{id}/desfecho.
        med.MapPost("/encerrar", async (Guid id, AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            var afetadas = await db.Database.ExecuteSqlRawAsync(@"
                UPDATE consultas
                SET video_status = 'encerrada', video_encerrada_em = NOW()
                WHERE id = {0}
                  AND paciente_id IN (
                      SELECT cliente_id FROM pacientes WHERE medico_responsavel_id = {1}
                  )",
                id, medicoId.Value);
            if (afetadas == 0) return Results.NotFound();

            await AuditarAsync(db, id, TeleconsultaSignalingHub.PapelMedico, "encerrou");
            return Results.NoContent();
        });

        // Finalizar a teleconsulta a partir da agenda: agenda a EXPIRAÇÃO do link
        // (não é o mesmo que /encerrar, que só finaliza a chamada ao vivo). Com
        // graça anti-engano: o link vale até NOW()+15min, mas nunca além do cap de
        // 120min após o fim previsto ("sempre o menor" via LEAST). Expirado, o
        // /entrar passa a recusar (410) — quem está na sala não é derrubado.
        // Só após o início previsto (inicia_em <= NOW): com "sempre o menor", clicar
        // numa consulta futura mataria o link antes da hora.
        med.MapPost("/finalizar", async (Guid id, AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            var afetadas = await db.Database.ExecuteSqlRawAsync(@"
                UPDATE consultas
                SET video_link_expira_em = LEAST(
                        inicia_em + ((duracao_min + 120) * INTERVAL '1 minute'),
                        NOW() + INTERVAL '15 minute'),
                    video_status = 'encerrada',
                    video_encerrada_em = COALESCE(video_encerrada_em, NOW())
                WHERE id = {0}
                  AND modalidade = 'teleconsulta'
                  AND status <> 'cancelada'
                  AND inicia_em <= NOW()
                  AND paciente_id IN (
                      SELECT cliente_id FROM pacientes WHERE medico_responsavel_id = {1}
                  )",
                id, medicoId.Value);
            if (afetadas == 0) return Results.NotFound();

            await AuditarAsync(db, id, TeleconsultaSignalingHub.PapelMedico, "finalizou");
            return Results.NoContent();
        });

        med.MapGet("/sinal", async (
            Guid id, HttpContext ctx, AppDbContext db, ClaimsPrincipal user,
            TeleconsultaSignalingHub hub, ILoggerFactory lf) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null || !await PossuiMedicoAsync(db, id, medicoId.Value))
            {
                ctx.Response.StatusCode = StatusCodes.Status404NotFound;
                return;
            }
            await BombearSinalizacaoAsync(
                ctx, db, hub, id, TeleconsultaSignalingHub.PapelMedico, lf);
        });

        med.MapPost("/sinal", async (
            Guid id, JsonElement body, AppDbContext db, ClaimsPrincipal user,
            TeleconsultaSignalingHub hub) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null || !await PossuiMedicoAsync(db, id, medicoId.Value))
                return Results.NotFound();
            return Repassar(hub, id, TeleconsultaSignalingHub.PapelMedico, body);
        });

        // ─── Paciente ─────────────────────────────────────────────────────
        var pac = app.MapGroup("/api/v1/portal/paciente/agenda/{id:guid}/video")
            .WithTags("teleconsulta-paciente")
            .RequireAuthorization("paciente");

        pac.MapPost("/entrar", async (
            Guid id, AppDbContext db, ClaimsPrincipal user, TurnCredentialService turn) =>
        {
            var pid = PacienteAuthEndpoints.GetPacienteId(user);
            if (pid is null) return Results.Unauthorized();

            var row = await db.Database.SqlQueryRaw<VideoConsultaRow>(
                "SELECT modalidade, status, " + LinkExpiradoSql + @" AS link_expirado
                 FROM consultas WHERE id = {0} AND paciente_id = {1}",
                id, pid.Value).FirstOrDefaultAsync();

            var erro = ValidarEntrada(row);
            if (erro is not null) return erro;

            await MarcarSalaAbertaAsync(db, id);
            await AuditarAsync(db, id, TeleconsultaSignalingHub.PapelPaciente, "entrou");

            return Results.Ok(new EntrarResponse(
                id, TeleconsultaSignalingHub.PapelPaciente, turn.BuildIceServers(id.ToString())));
        });

        pac.MapGet("/sinal", async (
            Guid id, HttpContext ctx, AppDbContext db, ClaimsPrincipal user,
            TeleconsultaSignalingHub hub, ILoggerFactory lf) =>
        {
            var pid = PacienteAuthEndpoints.GetPacienteId(user);
            if (pid is null || !await PossuiPacienteAsync(db, id, pid.Value))
            {
                ctx.Response.StatusCode = StatusCodes.Status404NotFound;
                return;
            }
            await BombearSinalizacaoAsync(
                ctx, db, hub, id, TeleconsultaSignalingHub.PapelPaciente, lf);
        });

        pac.MapPost("/sinal", async (
            Guid id, JsonElement body, AppDbContext db, ClaimsPrincipal user,
            TeleconsultaSignalingHub hub) =>
        {
            var pid = PacienteAuthEndpoints.GetPacienteId(user);
            if (pid is null || !await PossuiPacienteAsync(db, id, pid.Value))
                return Results.NotFound();
            return Repassar(hub, id, TeleconsultaSignalingHub.PapelPaciente, body);
        });
    }

    // ─── Validação / posse (tenant) ────────────────────────────────────────

    private static IResult? ValidarEntrada(VideoConsultaRow? row)
    {
        if (row is null) return Results.NotFound();
        if (row.Modalidade != "teleconsulta")
            return Results.BadRequest(new { erro = "nao_e_teleconsulta" });
        if (row.Status == "cancelada")
            return Results.Conflict(new { erro = "consulta_cancelada" });
        if (row.LinkExpirado)
            return Results.Json(new { erro = "link_expirado" }, statusCode: StatusCodes.Status410Gone);
        return null;
    }

    private static Task<bool> PossuiMedicoAsync(AppDbContext db, Guid consultaId, Guid medicoId) =>
        db.Database.ExistsAsync(@"
            SELECT 1 FROM consultas co
            JOIN pacientes p ON p.cliente_id = co.paciente_id
            WHERE co.id = {0} AND p.medico_responsavel_id = {1}
              AND co.modalidade = 'teleconsulta'",
            consultaId, medicoId);

    private static Task<bool> PossuiPacienteAsync(AppDbContext db, Guid consultaId, Guid pacienteId) =>
        db.Database.ExistsAsync(
            "SELECT 1 FROM consultas WHERE id = {0} AND paciente_id = {1} AND modalidade = 'teleconsulta'",
            consultaId, pacienteId);

    // ─── Sinalização ─────────────────────────────────────────────────────

    /// <summary>Valida o tipo do sinal e repassa o JSON opaco ao outro peer.</summary>
    private static IResult Repassar(
        TeleconsultaSignalingHub hub, Guid consultaId, string papel, JsonElement body)
    {
        if (body.ValueKind != JsonValueKind.Object
            || !body.TryGetProperty("tipo", out var t)
            || t.ValueKind != JsonValueKind.String
            || !TiposSinal.Contains(t.GetString()!))
            return Results.BadRequest(new { erro = "sinal_invalido" });

        hub.Publish(consultaId, papel, body.GetRawText());
        return Results.NoContent();
    }

    /// <summary>
    /// Mantém o SSE aberto entregando as mensagens do outro peer + presença.
    /// Heartbeat (comentário ": ping") a cada 20s p/ não morrer em proxy ocioso.
    /// Ao desconectar, registra 'saiu' na auditoria.
    /// </summary>
    private static async Task BombearSinalizacaoAsync(
        HttpContext ctx, AppDbContext db, TeleconsultaSignalingHub hub,
        Guid consultaId, string papel, ILoggerFactory lf)
    {
        var logger = lf.CreateLogger("Teleconsulta");
        var ct = ctx.RequestAborted;

        ctx.Response.Headers.ContentType = "text/event-stream";
        ctx.Response.Headers.CacheControl = "no-cache";
        ctx.Response.Headers["X-Accel-Buffering"] = "no";

        using var sub = hub.Subscribe(consultaId, papel);
        var ping = TimeSpan.FromSeconds(20);

        try
        {
            await ctx.Response.WriteAsync(": ok\n\n", ct);
            await ctx.Response.Body.FlushAsync(ct);

            while (!ct.IsCancellationRequested)
            {
                bool temDado;
                using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct))
                {
                    timeout.CancelAfter(ping);
                    try
                    {
                        temDado = await sub.Reader.WaitToReadAsync(timeout.Token);
                    }
                    catch (OperationCanceledException) when (!ct.IsCancellationRequested)
                    {
                        // ocioso → heartbeat (comentário SSE) p/ não morrer em proxy
                        await ctx.Response.WriteAsync(": ping\n\n", ct);
                        await ctx.Response.Body.FlushAsync(ct);
                        continue;
                    }
                }

                if (!temDado) break; // canal encerrado (reconexão substituiu este peer)
                while (sub.Reader.TryRead(out var msg))
                    await ctx.Response.WriteAsync($"data: {msg}\n\n", ct);
                await ctx.Response.Body.FlushAsync(ct);
            }
        }
        catch (OperationCanceledException)
        {
            // cliente desconectou — fluxo normal
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Erro no SSE de sinalização (consulta {Consulta})", consultaId);
        }
        finally
        {
            try { await AuditarAsync(db, consultaId, papel, "saiu"); }
            catch { /* scope pode já estar encerrando */ }
        }
    }

    // ─── Estado / auditoria ────────────────────────────────────────────────

    private static Task MarcarSalaAbertaAsync(AppDbContext db, Guid consultaId) =>
        db.Database.ExecuteSqlRawAsync(@"
            UPDATE consultas
            SET video_status = 'aguardando',
                video_iniciada_em = COALESCE(video_iniciada_em, NOW())
            WHERE id = {0}", consultaId);

    private static Task AuditarAsync(
        AppDbContext db, Guid consultaId, string ator, string evento) =>
        db.Database.ExecuteSqlRawAsync(
            "INSERT INTO consulta_video_eventos (consulta_id, ator, evento) VALUES ({0}, {1}, {2})",
            consultaId, ator, evento);

    private static async Task<Guid?> GetMedicoIdAsync(AppDbContext db, ClaimsPrincipal user)
    {
        var sub = user.FindFirst("sub")?.Value;
        if (!Guid.TryParse(sub, out var userId)) return null;
        return await db.Database.ExecuteScalarAsync<Guid?>(
            "SELECT id FROM medicos WHERE usuario_id = {0}", userId);
    }
}

public record VideoConsultaRow(string Modalidade, string Status, bool LinkExpirado);

public record EntrarResponse(
    Guid RoomId, string Papel, IReadOnlyList<TurnCredentialService.IceServer> IceServers);
