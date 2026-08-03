using ApiGateway.Data;
using ApiGateway.Auth;
using ApiGateway.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

// ADR-064: mensagens de áudio do paciente para o médico.
// Upload: paciente → SAS PUT → Azure Blob → registrar via POST (ADR-082).
// Playback: médico → SAS GET (1h) → Blob direto.
// Retenção: lifecycle 60d no container + expira_em no DB.

namespace ApiGateway.Endpoints;

public static class MensagensAudioEndpoints
{
    private const int PresignedUploadMinutes = 15;
    private const int PresignedPlayMinutes   = 60;

    public static void MapMensagensAudio(this WebApplication app)
    {
        var container = app.Configuration["BLOB_CONTAINER_AUDIO_MSGS"] ?? "audio-msgs";

        // ── PORTAL PACIENTE ──────────────────────────────────────────────────
        var p = app.MapGroup("/api/v1/portal/paciente/mensagens-audio")
            .WithTags("portal-audio")
            .RequireAuthorization("paciente");

        // Ativar/verificar consentimento
        p.MapPost("/consent", async (AppDbContext db, ClaimsPrincipal user) =>
        {
            var pid = PacienteAuthEndpoints.GetPacienteId(user);
            if (pid is null) return Results.Unauthorized();
            await db.Database.ExecuteSqlRawAsync(@"
                UPDATE pacientes SET consentimento_audio = TRUE
                WHERE cliente_id = {0}", pid.Value);
            return Results.NoContent();
        });

        p.MapGet("/consent", async (AppDbContext db, ClaimsPrincipal user) =>
        {
            var pid = PacienteAuthEndpoints.GetPacienteId(user);
            if (pid is null) return Results.Unauthorized();
            var ok = await db.Database.ExecuteScalarAsync<bool?>(@"
                SELECT consentimento_audio FROM pacientes WHERE cliente_id = {0}", pid.Value);
            return Results.Ok(new { consentimento = ok ?? false });
        });

        // Gerar URL de upload (SAS PUT, 15min)
        p.MapPost("/upload-url", async (AppDbContext db, ClaimsPrincipal user, BlobStoragePresigner storage) =>
        {
            var pid = PacienteAuthEndpoints.GetPacienteId(user);
            if (pid is null) return Results.Unauthorized();

            var consentimento = await db.Database.ExecuteScalarAsync<bool?>(@"
                SELECT consentimento_audio FROM pacientes WHERE cliente_id = {0}", pid.Value);
            if (consentimento != true)
                return Results.Json(new { erro = "consentimento_pendente" }, statusCode: 403);

            var key = $"audio/{pid.Value}/{Guid.NewGuid()}.webm";
            var url = storage.PresignPut(container, key, TimeSpan.FromMinutes(PresignedUploadMinutes));

            return Results.Ok(new { uploadUrl = url, s3Key = key });
        });

        // Registrar mensagem após upload concluído
        p.MapPost("/", async (AppDbContext db, ClaimsPrincipal user,
            [FromBody] RegistrarAudioRequest req) =>
        {
            var pid = PacienteAuthEndpoints.GetPacienteId(user);
            if (pid is null) return Results.Unauthorized();
            if (string.IsNullOrWhiteSpace(req.S3Key)) return Results.BadRequest();
            // Valida que a key pertence ao paciente: prefixo exato (não Contains, que
            // aceitaria o pid em qualquer posição de uma key forjada).
            if (!req.S3Key.StartsWith($"audio/{pid.Value}/", StringComparison.Ordinal))
                return Results.Forbid();

            var medicoId = await db.Database.ExecuteScalarAsync<Guid?>(@"
                SELECT medico_responsavel_id FROM pacientes WHERE cliente_id = {0}", pid.Value);
            if (medicoId is null) return Results.NotFound();

            // SET LOCAL: RLS do INSERT exige app.current_medico = medico_id inserido.
            // Paciente token seta current_paciente, não current_medico.
            // Usamos transação + set_config local para não vazar entre conexões do pool.
            await using var tx = await db.Database.BeginTransactionAsync();
            await db.Database.ExecuteRawAsync(
                "SELECT set_config('app.current_medico', {0}, true)", medicoId.Value.ToString());
            var id = await db.Database.ExecuteScalarAsync<Guid>(@"
                INSERT INTO mensagens_audio (paciente_id, medico_id, s3_key, duracao_s)
                VALUES ({0}, {1}, {2}, {3})
                RETURNING id",
                pid.Value, medicoId.Value, req.S3Key, req.DuracaoS > 0 ? req.DuracaoS : (int?)null);
            await tx.CommitAsync();

            return Results.Ok(new { id });
        });

        // Listar mensagens do paciente (para histórico)
        p.MapGet("/", async (AppDbContext db, ClaimsPrincipal user) =>
        {
            var pid = PacienteAuthEndpoints.GetPacienteId(user);
            if (pid is null) return Results.Unauthorized();
            var lista = await db.Database.SqlQueryRaw<MensagemAudioItem>(@"
                SELECT id, duracao_s, ouvido_em, criada_em, expira_em
                FROM mensagens_audio
                WHERE paciente_id = {0}
                ORDER BY criada_em DESC LIMIT 20", pid.Value).ToListAsync();
            return Results.Ok(lista);
        });

        // ── DASHBOARD MÉDICO ─────────────────────────────────────────────────
        var m = app.MapGroup("/api/v1/prontuario/{pacienteId:guid}/mensagens-audio")
            .WithTags("prontuario-audio")
            .RequireAuthorization("medico");

        // Listar mensagens de áudio do paciente
        m.MapGet("/", async (Guid pacienteId, AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await MedicoIdAsync(db, user);
            if (medicoId is null) return Results.Unauthorized();
            // RLS garante tenant; verificação explícita extra
            var lista = await db.Database.SqlQueryRaw<MensagemAudioItem>(@"
                SELECT ma.id, ma.duracao_s, ma.ouvido_em, ma.criada_em, ma.expira_em
                FROM mensagens_audio ma
                JOIN pacientes p ON p.cliente_id = ma.paciente_id
                WHERE ma.paciente_id = {0}
                  AND p.medico_responsavel_id = {1}
                ORDER BY ma.criada_em DESC LIMIT 50",
                pacienteId, medicoId.Value).ToListAsync();
            return Results.Ok(lista);
        });

        // SAS GET para playback (1h)
        m.MapGet("/{id:guid}/play-url", async (Guid pacienteId, Guid id,
            AppDbContext db, ClaimsPrincipal user, BlobStoragePresigner storage) =>
        {
            var medicoId = await MedicoIdAsync(db, user);
            if (medicoId is null) return Results.Unauthorized();

            var key = await db.Database.ExecuteScalarAsync<string?>(@"
                SELECT ma.s3_key
                FROM mensagens_audio ma
                JOIN pacientes p ON p.cliente_id = ma.paciente_id
                WHERE ma.id = {0}
                  AND ma.paciente_id = {1}
                  AND p.medico_responsavel_id = {2}",
                id, pacienteId, medicoId.Value);
            if (key is null) return Results.NotFound();

            var url = storage.PresignGet(container, key, TimeSpan.FromMinutes(PresignedPlayMinutes));
            return Results.Ok(new { playUrl = url });
        });

        // Marcar como ouvido
        m.MapPatch("/{id:guid}/ouvido", async (Guid pacienteId, Guid id,
            AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await MedicoIdAsync(db, user);
            if (medicoId is null) return Results.Unauthorized();
            var rows = await db.Database.ExecuteSqlRawAsync(@"
                UPDATE mensagens_audio ma
                SET ouvido_em = NOW()
                FROM pacientes p
                WHERE ma.id = {0}
                  AND ma.ouvido_em IS NULL
                  AND ma.paciente_id = p.cliente_id
                  AND p.medico_responsavel_id = {1}",
                id, medicoId.Value);
            return rows > 0 ? Results.NoContent() : Results.NotFound();
        });
    }

    // O claim `sub` do JWT do médico é o usuario_id, NÃO medicos.id. Toda query
    // aqui filtra por pacientes.medico_responsavel_id (= medicos.id) e a RLS usa
    // app.current_medico (= medicos.id, resolvido pelo TenantSessionMiddleware).
    // Precisa resolver usuario_id -> medicos.id, igual ao GetMedicoIdAsync dos
    // demais endpoints. Sem isso, o WHERE usa o id errado e nunca casa (lista vazia).
    private static async Task<Guid?> MedicoIdAsync(AppDbContext db, ClaimsPrincipal user)
    {
        var sub = user.FindFirstValue(ClaimTypes.NameIdentifier)
               ?? user.FindFirstValue("sub");
        if (!Guid.TryParse(sub, out var usuarioId)) return null;
        return await db.Database.ExecuteScalarAsync<Guid?>(
            "SELECT id FROM medicos WHERE usuario_id = {0}", usuarioId);
    }
}

public record RegistrarAudioRequest(string S3Key, int DuracaoS);

public record MensagemAudioItem(
    Guid Id,
    int? DuracaoS,
    DateTime? OuvidoEm,
    DateTime CriadaEm,
    DateTime ExpiraEm
);
