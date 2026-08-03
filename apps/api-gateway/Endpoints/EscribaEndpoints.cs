using ApiGateway.Auth;
using ApiGateway.Data;
using ApiGateway.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text;
using System.Text.Json;

namespace ApiGateway.Endpoints;

/// <summary>
/// Escriba clínico (Ambient Scribe, ADR-040 + ADR-075). Áudio da consulta → transcrição
/// (agents-py) → rascunho FACTUAL → médico revisa/aprova → evolução append-only.
///
/// Dois caminhos de captura:
///   • Teleconsulta (ADR-040): áudio da videochamada chega em base64 → transcrição SÍNCRONA.
///   • Presencial   (ADR-075): médico atesta consentimento verbal → grava mic da sala →
///     upload via SAS direto no Azure Blob (ADR-082) → transcrição ASSÍNCRONA (fila + worker;
///     consulta longa não cabe numa request HTTP). O front faz polling na página de revisão.
///
/// Guardrails (clinical-safety):
///   • Regra #1: rascunho é factual; a IA não decide nada clínico (feito no prompt do agents-py).
///   • Regra #2: doctor-facing; não aciona protocolo de crise patient-facing — só flag mencao_risco.
///   • Regra #3: nada vira evolução sem aprovação do médico.
///   • Regra #4: gravação só com consentimento; transcrição/rascunho cifrados (ADR-018); áudio efêmero.
///   • Regra #5: evolucoes_clinicas é append-only.
/// Tenant: médico via JOIN pacientes.medico_responsavel_id; paciente via GetPacienteId.
/// </summary>
public static class EscribaEndpoints
{
    public static void Map(WebApplication app)
    {
        // Container efêmero do áudio do escriba — MESMO que o agents-py lê (blob_container_audio).
        var containerAudio = app.Configuration["BLOB_CONTAINER_AUDIO"] ?? "audio-efemero";

        // ─── Paciente: consentir / revogar gravação (teleconsulta) ────────────
        app.MapPost("/api/v1/portal/paciente/agenda/{id:guid}/escriba/consentir", async (
            Guid id, AppDbContext db, ClaimsPrincipal user) =>
        {
            var pid = PacienteAuthEndpoints.GetPacienteId(user);
            if (pid is null) return Results.Unauthorized();

            var afetadas = await db.Database.ExecuteSqlRawAsync(@"
                UPDATE consultas
                SET escriba_consentido_em = NOW(),
                    escriba_consentido_metodo = 'teleconsulta',
                    escriba_status = CASE WHEN escriba_status = 'idle' THEN 'consentido' ELSE escriba_status END
                WHERE id = {0} AND paciente_id = {1} AND modalidade = 'teleconsulta'",
                id, pid.Value);
            return afetadas == 0 ? Results.NotFound() : Results.NoContent();
        }).WithTags("escriba-paciente").RequireAuthorization("paciente");

        // Revogar consentimento (direito do titular, LGPD) — só se ainda não aprovado.
        app.MapDelete("/api/v1/portal/paciente/agenda/{id:guid}/escriba/consentir", async (
            Guid id, AppDbContext db, ClaimsPrincipal user) =>
        {
            var pid = PacienteAuthEndpoints.GetPacienteId(user);
            if (pid is null) return Results.Unauthorized();

            var afetadas = await db.Database.ExecuteSqlRawAsync(@"
                UPDATE consultas
                SET escriba_consentido_em = NULL, escriba_consentido_metodo = NULL, escriba_status = 'idle'
                WHERE id = {0} AND paciente_id = {1} AND escriba_status <> 'aprovado'",
                id, pid.Value);
            return afetadas == 0 ? Results.NotFound() : Results.NoContent();
        }).WithTags("escriba-paciente").RequireAuthorization("paciente");

        // ─── Médico: status do consentimento (checa antes de gravar) ──────────
        app.MapGet("/api/v1/consultas/{id:guid}/escriba/status", async (
            Guid id, AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            var info = await ConsultaInfoAsync(db, id, medicoId.Value);
            if (info is null) return Results.NotFound();

            return Results.Ok(new
            {
                consentido = info.EscribaConsentidoEm is not null,
                status = info.EscribaStatus,
                modalidade = info.Modalidade,
            });
        }).WithTags("escriba-medico").RequireAuthorization().RequireFeature(FeatureKeys.Escriba);

        // ─── Médico: consentimento PRESENCIAL atestado (verbal) — ADR-075 ─────
        // O paciente não tem sessão no device; o médico atesta o consentimento verbal.
        // Registrado com metodo='verbal_atestado' + timestamp (responsabilidade do médico).
        app.MapPost("/api/v1/consultas/{id:guid}/escriba/consentir-presencial", async (
            Guid id, JsonElement body, AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            var atestado = body.TryGetProperty("atestado", out var a) && a.ValueKind == JsonValueKind.True;
            if (!atestado) return Results.BadRequest(new { erro = "atestacao_obrigatoria" });

            var info = await ConsultaInfoAsync(db, id, medicoId.Value);
            if (info is null) return Results.NotFound();
            if (info.Modalidade != "presencial") return Results.BadRequest(new { erro = "nao_e_presencial" });

            await db.Database.ExecuteSqlRawAsync(@"
                UPDATE consultas
                SET escriba_consentido_em = NOW(),
                    escriba_consentido_metodo = 'verbal_atestado',
                    escriba_status = CASE WHEN escriba_status = 'idle' THEN 'consentido' ELSE escriba_status END
                WHERE id = {0}", id);
            return Results.NoContent();
        }).WithTags("escriba-medico").RequireAuthorization().RequireFeature(FeatureKeys.Escriba);

        // ─── Médico: URL de upload SAS (presencial) ───────────────────────────
        // Browser sobe o áudio direto pro Blob (dodge do cap 25MB base64 / TC-3).
        app.MapPost("/api/v1/consultas/{id:guid}/escriba/upload-url", async (
            Guid id, JsonElement body, AppDbContext db, ClaimsPrincipal user, BlobStoragePresigner storage) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            var info = await ConsultaInfoAsync(db, id, medicoId.Value);
            if (info is null) return Results.NotFound();
            if (info.EscribaConsentidoEm is null) return Results.Conflict(new { erro = "sem_consentimento" });

            var contentType = body.TryGetProperty("contentType", out var ctEl) ? ctEl.GetString() : null;
            var ext = !string.IsNullOrEmpty(contentType) && contentType.Contains("mp4") ? "mp4" : "webm";
            // Key namespaceada por paciente → o POST /escriba valida o prefixo (anti-forja).
            var key = $"escriba/{info.PacienteId}/{Guid.NewGuid()}.{ext}";

            var url = storage.PresignPut(containerAudio, key, TimeSpan.FromMinutes(15));
            return Results.Ok(new { uploadUrl = url, s3Key = key });
        }).WithTags("escriba-medico").RequireAuthorization().RequireFeature(FeatureKeys.Escriba);

        // ─── Médico: upload/registro do áudio → transcrição → grava cifrado ───
        app.MapPost("/api/v1/consultas/{id:guid}/escriba", async (
            Guid id, [FromBody] EscribaUploadRequest req, AppDbContext db, ClaimsPrincipal user,
            CryptoService crypto, IHttpClientFactory httpFactory, IConfiguration cfg,
            EscribaJobQueue jobQueue) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            var info = await ConsultaInfoAsync(db, id, medicoId.Value);
            if (info is null) return Results.NotFound();
            if (info.Modalidade != "teleconsulta" && info.Modalidade != "presencial")
                return Results.BadRequest(new { erro = "modalidade_invalida" });
            if (info.EscribaConsentidoEm is null)
                return Results.Conflict(new { erro = "sem_consentimento" });

            // ── Caminho PRESENCIAL: áudio já no Blob (SAS). Transcrição ASSÍNCRONA. ──
            if (!string.IsNullOrWhiteSpace(req.S3Key))
            {
                // Valida ownership da key por prefixo exato (padrão anti-forja, MensagensAudio).
                if (!req.S3Key.StartsWith($"escriba/{info.PacienteId}/", StringComparison.Ordinal))
                    return Results.Forbid();

                var transId = Guid.NewGuid();
                await db.Database.ExecuteSqlRawAsync(@"
                    INSERT INTO consulta_transcricoes
                      (id, consulta_id, paciente_id, medico_id, mencao_risco, status)
                    VALUES ({0}, {1}, {2}, {3}, FALSE, 'processando')",
                    transId, id, info.PacienteId, medicoId.Value);
                await db.Database.ExecuteSqlRawAsync(
                    "UPDATE consultas SET escriba_status = 'processando' WHERE id = {0}", id);

                await jobQueue.EnqueueAsync(new EscribaJob(
                    transId, id, info.PacienteId, medicoId.Value, req.S3Key,
                    string.IsNullOrWhiteSpace(req.ContentType) ? "audio/webm" : req.ContentType!));

                return Results.Accepted(
                    $"/api/v1/consultas/{id}/escriba", new { id = transId, status = "processando" });
            }

            // ── Caminho TELECONSULTA: áudio inline (base64), transcrição SÍNCRONA. ──
            if (string.IsNullOrWhiteSpace(req.AudioBase64))
                return Results.BadRequest(new { erro = "audio_vazio" });

            var internalToken = cfg["INTERNAL_API_TOKEN"]
                ?? throw new InvalidOperationException("INTERNAL_API_TOKEN ausente");

            // LLM/transcrição (Azure Speech) vivem só no Python (ADR-044/081). Gateway só orquestra + persiste.
            string transcricao; string rascunhoJson; bool mencaoRisco;
            try
            {
                var http = httpFactory.CreateClient("agents-py");
                var payload = JsonSerializer.Serialize(new
                {
                    audio_base64 = req.AudioBase64,
                    content_type = string.IsNullOrWhiteSpace(req.ContentType) ? "audio/webm" : req.ContentType,
                    paciente_id = info.PacienteId,
                });
                using var msg = new HttpRequestMessage(HttpMethod.Post, "/internal/escriba/transcrever")
                {
                    Content = new StringContent(payload, Encoding.UTF8, "application/json"),
                };
                msg.Headers.Authorization = new AuthenticationHeaderValue("Bearer", internalToken);

                using var resp = await http.SendAsync(msg);
                if (!resp.IsSuccessStatusCode) return Results.StatusCode(502);

                var json = await resp.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(json);
                transcricao = doc.RootElement.GetProperty("transcricao").GetString() ?? "";
                rascunhoJson = doc.RootElement.GetProperty("rascunho").GetRawText();
                mencaoRisco = doc.RootElement.TryGetProperty("mencao_risco", out var mr) && mr.GetBoolean();
            }
            catch
            {
                return Results.StatusCode(502);
            }

            var transcricaoId = Guid.NewGuid();
            await db.Database.ExecuteSqlRawAsync(@"
                INSERT INTO consulta_transcricoes
                  (id, consulta_id, paciente_id, medico_id, transcricao, rascunho, mencao_risco, status)
                VALUES ({0}, {1}, {2}, {3}, {4}, {5}, {6}, 'rascunho')",
                transcricaoId, id, info.PacienteId, medicoId.Value,
                crypto.Encrypt(transcricao) ?? "", crypto.Encrypt(rascunhoJson) ?? "", mencaoRisco);

            await db.Database.ExecuteSqlRawAsync(
                "UPDATE consultas SET escriba_status = 'rascunho' WHERE id = {0}", id);

            return Results.Ok(new
            {
                id = transcricaoId,
                transcricao,
                rascunho = ParseJson(rascunhoJson),
                mencaoRisco,
            });
        }).WithTags("escriba-medico").RequireAuthorization().RequireFeature(FeatureKeys.Escriba);

        // ─── Médico: leitura do rascunho mais recente (decifrado) ─────────────
        app.MapGet("/api/v1/consultas/{id:guid}/escriba", async (
            Guid id, AppDbContext db, ClaimsPrincipal user, CryptoService crypto) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            var row = await db.Database.SqlQueryRaw<TranscricaoRow>(@"
                SELECT ct.id, ct.transcricao, ct.rascunho, ct.mencao_risco, ct.status, ct.criado_em
                FROM consulta_transcricoes ct
                JOIN pacientes p ON p.cliente_id = ct.paciente_id
                WHERE ct.consulta_id = {0} AND p.medico_responsavel_id = {1}
                ORDER BY ct.criado_em DESC
                LIMIT 1", id, medicoId.Value).FirstOrDefaultAsync();
            if (row is null) return Results.NotFound();

            var status = row.Status;
            // Sweep: a fila de transcrição é in-process e não sobrevive a restart do
            // gateway. Após 15min preso em 'processando', marca 'erro' p/ o médico regravar.
            if (status == "processando" && row.CriadoEm < DateTime.UtcNow.AddMinutes(-15))
            {
                await db.Database.ExecuteSqlRawAsync(
                    "UPDATE consulta_transcricoes SET status = 'erro' WHERE id = {0} AND status = 'processando'",
                    row.Id);
                status = "erro";
            }

            var pronto = status is "rascunho" or "aprovado";
            return Results.Ok(new
            {
                transcricao = pronto && row.Transcricao is not null ? crypto.Decrypt(row.Transcricao) : null,
                rascunho = pronto && row.Rascunho is not null ? ParseJson(crypto.Decrypt(row.Rascunho)) : null,
                mencaoRisco = row.MencaoRisco,
                status,
            });
        }).WithTags("escriba-medico").RequireAuthorization().RequireFeature(FeatureKeys.Escriba);

        // ─── Médico: edita o rascunho (médico no loop) — só enquanto 'rascunho' ─
        app.MapPatch("/api/v1/consultas/{id:guid}/escriba", async (
            Guid id, JsonElement body, AppDbContext db, ClaimsPrincipal user, CryptoService crypto) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();
            if (!body.TryGetProperty("rascunho", out var rascunho))
                return Results.BadRequest(new { erro = "rascunho_obrigatorio" });

            var afetadas = await db.Database.ExecuteSqlRawAsync(@"
                UPDATE consulta_transcricoes SET rascunho = {2}
                WHERE consulta_id = {0} AND medico_id = {1} AND status = 'rascunho'",
                id, medicoId.Value, crypto.Encrypt(rascunho.GetRawText()) ?? "");
            return afetadas == 0 ? Results.Conflict(new { erro = "sem_rascunho_editavel" }) : Results.NoContent();
        }).WithTags("escriba-medico").RequireAuthorization().RequireFeature(FeatureKeys.Escriba);

        // ─── Médico: aprova → evolução append-only + fecha o rascunho ─────────
        app.MapPost("/api/v1/consultas/{id:guid}/escriba/aprovar", async (
            Guid id, JsonElement body, AppDbContext db, ClaimsPrincipal user, CryptoService crypto) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();
            var sub = user.FindFirst("sub")?.Value;
            Guid.TryParse(sub, out var usuarioId);

            if (!body.TryGetProperty("conteudo", out var c) || string.IsNullOrWhiteSpace(c.GetString()))
                return Results.BadRequest(new { erro = "conteudo_obrigatorio" });
            var conteudo = c.GetString()!;

            var info = await ConsultaInfoAsync(db, id, medicoId.Value);
            if (info is null) return Results.NotFound();

            var afetadas = await db.Database.ExecuteSqlRawAsync(@"
                UPDATE consulta_transcricoes SET status = 'aprovado', aprovado_em = NOW()
                WHERE consulta_id = {0} AND medico_id = {1} AND status = 'rascunho'",
                id, medicoId.Value);
            if (afetadas == 0) return Results.Conflict(new { erro = "sem_rascunho_ou_ja_aprovado" });

            var evoId = Guid.NewGuid();
            await db.Database.ExecuteSqlRawAsync(@"
                INSERT INTO evolucoes_clinicas
                  (id, paciente_id, medico_id, consulta_id, origem, conteudo, assistido_ia, criado_por)
                VALUES ({0}, {1}, {2}, {3}, 'escriba', {4}, TRUE, {5})",
                evoId, info.PacienteId, medicoId.Value, id, crypto.Encrypt(conteudo) ?? "", usuarioId);

            await db.Database.ExecuteSqlRawAsync(
                "UPDATE consultas SET escriba_status = 'aprovado' WHERE id = {0}", id);

            return Results.Ok(new { id = evoId });
        }).WithTags("escriba-medico").RequireAuthorization().RequireFeature(FeatureKeys.Escriba);
    }

    // ─── Helpers ───────────────────────────────────────────────────────────

    private static async Task<EscribaConsultaInfo?> ConsultaInfoAsync(AppDbContext db, Guid consultaId, Guid medicoId) =>
        await db.Database.SqlQueryRaw<EscribaConsultaInfo>(@"
            SELECT co.paciente_id, co.modalidade, co.escriba_status, co.escriba_consentido_em
            FROM consultas co
            JOIN pacientes p ON p.cliente_id = co.paciente_id
            WHERE co.id = {0} AND p.medico_responsavel_id = {1}",
            consultaId, medicoId).FirstOrDefaultAsync();

    private static JsonElement? ParseJson(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { return JsonSerializer.Deserialize<JsonElement>(json); }
        catch { return null; }
    }

    private static async Task<Guid?> GetMedicoIdAsync(AppDbContext db, ClaimsPrincipal user)
    {
        var sub = user.FindFirst("sub")?.Value;
        if (!Guid.TryParse(sub, out var userId)) return null;
        return await db.Database.ExecuteScalarAsync<Guid?>(
            "SELECT id FROM medicos WHERE usuario_id = {0}", userId);
    }
}

public record EscribaUploadRequest(string? AudioBase64, string? ContentType, string? S3Key);

public record EscribaConsultaInfo(
    Guid PacienteId, string Modalidade, string EscribaStatus, DateTime? EscribaConsentidoEm);

public record TranscricaoRow(
    Guid Id, string? Transcricao, string? Rascunho, bool MencaoRisco, string Status, DateTime CriadoEm);
