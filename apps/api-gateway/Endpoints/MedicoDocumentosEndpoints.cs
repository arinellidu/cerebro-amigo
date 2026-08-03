using ApiGateway.Data;
using ApiGateway.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

// ADR-066: cofre de documentos do médico (Portal do Psiquiatra).
// Cofre BIDIRECIONAL, binário nunca passa pelo gateway (SAS do Azure Blob,
// ADR-082; padrão da ADR-064/MensagensAudio):
//   - médico ENVIA (direcao='enviado')          → entra 'pendente' de revisão admin
//   - admin DISPONIBILIZA (direcao='disponibilizado') → entra 'disponivel'
// Isolamento: RLS (migration 0052) por app.current_medico no lado do médico; o
// lado admin roda sob app.tenant_bypass (role admin/owner) e por isso FILTRA
// medico_id explicitamente em TODA query (bypass enxerga tudo).

namespace ApiGateway.Endpoints;

public static class MedicoDocumentosEndpoints
{
    private const int PresignUploadMin   = 15;
    private const int PresignDownloadMin = 5;

    // Allowlists (defesa: bloqueia upload de tipo/mime fora do esperado).
    private static readonly HashSet<string> MimeOk =
        new(StringComparer.OrdinalIgnoreCase) { "application/pdf", "image/jpeg", "image/png" };
    private static readonly HashSet<string> TipoMedico =
        new(StringComparer.OrdinalIgnoreCase) { "contrato", "comprovante", "diploma", "rg_cpf", "outro" };
    private static readonly HashSet<string> TipoAdmin =
        new(StringComparer.OrdinalIgnoreCase) { "contrato", "nfse", "recibo", "outro" };

    public static void MapMedicoDocumentos(this WebApplication app)
    {
        var container = app.Configuration["BLOB_CONTAINER_MEDICO_DOCS"] ?? "medico-docs";

        // ── MÉDICO ───────────────────────────────────────────────────────────
        // RequireAuthorization() (qualquer JWT) + GetMedicoIdAsync → Forbid se não-médico.
        // Não depende de policy "medico" (inexistente no Program.cs).
        var m = app.MapGroup("/api/v1/conta/documentos").WithTags("conta-documentos").RequireAuthorization();

        // Listar meus documentos (ambas direções). RLS filtra por current_medico.
        m.MapGet("/", async (AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();
            return Results.Ok(await ListarAsync(db, medicoId.Value));
        });

        // Gerar URL de upload (SAS PUT, 15min). Key namespaced por médico+direção;
        // sem string do usuário na key (evita path traversal).
        m.MapPost("/upload-url", async ([FromBody] DocumentoUploadUrlReq req,
            AppDbContext db, ClaimsPrincipal user, BlobStoragePresigner storage) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();
            if (!TipoMedico.Contains(req.Tipo ?? "")) return Results.BadRequest(new { error = "tipo_invalido" });
            if (!MimeOk.Contains(req.ContentType ?? "")) return Results.BadRequest(new { error = "tipo_arquivo_invalido" });

            var key = $"medico/{medicoId.Value}/enviado/{Guid.NewGuid()}.{Ext(req.ContentType!)}";
            return Results.Ok(new { uploadUrl = PresignPut(storage, container, key), s3Key = key });
        });

        // Registrar após upload concluído. Valida que a key pertence a este médico+direção.
        m.MapPost("/", async ([FromBody] DocumentoRegistrarReq req,
            AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();
            if (string.IsNullOrWhiteSpace(req.S3Key) || string.IsNullOrWhiteSpace(req.Titulo))
                return Results.BadRequest(new { error = "dados_invalidos" });
            if (!TipoMedico.Contains(req.Tipo ?? "")) return Results.BadRequest(new { error = "tipo_invalido" });
            if (!req.S3Key.StartsWith($"medico/{medicoId.Value}/enviado/", StringComparison.Ordinal))
                return Results.Forbid();

            // RLS WITH CHECK exige medico_id = current_medico (setado pelo middleware).
            var id = await InserirAsync(db, medicoId.Value, "enviado", req, "pendente", "medico");
            return Results.Ok(new { id });
        });

        // SAS GET p/ baixar um doc meu (qualquer direção). RLS limita ao dono.
        m.MapGet("/{id:guid}/download-url", async (Guid id,
            AppDbContext db, ClaimsPrincipal user, BlobStoragePresigner storage) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();
            var key = await KeyDoDocAsync(db, id, medicoId.Value);
            if (key is null) return Results.NotFound();
            return Results.Ok(new { downloadUrl = PresignGet(storage, container, key) });
        });

        // Médico pode remover só os que ELE enviou (não os disponibilizados pela plataforma).
        m.MapDelete("/{id:guid}", async (Guid id, AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();
            var rows = await db.Database.ExecuteRawAsync(
                "DELETE FROM medico_documentos WHERE id = {0} AND medico_id = {1} AND direcao = 'enviado'",
                id, medicoId.Value);
            return rows > 0 ? Results.NoContent() : Results.NotFound();
        });

        // ── ADMIN ──────────────────────────────────────────────────────────────
        // Roda sob app.tenant_bypass → SEMPRE filtra medico_id explicitamente.
        var a = app.MapGroup("/api/v1/admin/medicos/{medicoId:guid}/documentos")
            .WithTags("admin-documentos").RequireAuthorization("admin_geral");

        a.MapGet("/", async (Guid medicoId, AppDbContext db) =>
            Results.Ok(await ListarAsync(db, medicoId)));

        a.MapPost("/upload-url", async (Guid medicoId, [FromBody] DocumentoUploadUrlReq req, BlobStoragePresigner storage) =>
        {
            if (!TipoAdmin.Contains(req.Tipo ?? "")) return Results.BadRequest(new { error = "tipo_invalido" });
            if (!MimeOk.Contains(req.ContentType ?? "")) return Results.BadRequest(new { error = "tipo_arquivo_invalido" });
            var key = $"medico/{medicoId}/disponibilizado/{Guid.NewGuid()}.{Ext(req.ContentType!)}";
            return Results.Ok(new { uploadUrl = PresignPut(storage, container, key), s3Key = key });
        });

        a.MapPost("/", async (Guid medicoId, [FromBody] DocumentoRegistrarReq req, AppDbContext db) =>
        {
            if (string.IsNullOrWhiteSpace(req.S3Key) || string.IsNullOrWhiteSpace(req.Titulo))
                return Results.BadRequest(new { error = "dados_invalidos" });
            if (!TipoAdmin.Contains(req.Tipo ?? "")) return Results.BadRequest(new { error = "tipo_invalido" });
            if (!req.S3Key.StartsWith($"medico/{medicoId}/disponibilizado/", StringComparison.Ordinal))
                return Results.BadRequest(new { error = "s3key_invalida" });
            var id = await InserirAsync(db, medicoId, "disponibilizado", req, "disponivel", "admin");
            return Results.Ok(new { id });
        });

        // Revisar um doc enviado pelo médico: aprovar/rejeitar (+ nota).
        a.MapPatch("/{id:guid}/revisar", async (Guid medicoId, Guid id,
            [FromBody] AdminRevisarReq req, AppDbContext db) =>
        {
            if (req.Status is not ("aprovado" or "rejeitado"))
                return Results.BadRequest(new { error = "status_invalido" });
            var rows = await db.Database.ExecuteRawAsync(@"
                UPDATE medico_documentos
                SET status = {2}, observacoes = NULLIF({3}, ''), atualizado_em = NOW()
                WHERE id = {0} AND medico_id = {1} AND direcao = 'enviado'",
                id, medicoId, req.Status, req.Observacoes ?? "");
            return rows > 0 ? Results.NoContent() : Results.NotFound();
        });

        a.MapGet("/{id:guid}/download-url", async (Guid medicoId, Guid id, AppDbContext db, BlobStoragePresigner storage) =>
        {
            var key = await KeyDoDocAsync(db, id, medicoId);
            if (key is null) return Results.NotFound();
            return Results.Ok(new { downloadUrl = PresignGet(storage, container, key) });
        });
    }

    // ── Helpers compartilhados médico/admin (dedup ADR-066 review #7) ──────────

    private static Task<List<DocumentoItem>> ListarAsync(AppDbContext db, Guid medicoId) =>
        db.Database.SqlQueryRaw<DocumentoItem>(@"
            SELECT id, direcao, tipo, titulo, status,
                   content_type, tamanho_bytes, criado_em, observacoes
            FROM medico_documentos
            WHERE medico_id = {0}
            ORDER BY criado_em DESC LIMIT 200", medicoId).ToListAsync();

    // INSERT único parametrizado por direção/status/origem (médico=enviado/pendente,
    // admin=disponibilizado/disponivel). tamanho_bytes nulo se cliente não informou.
    private static Task<Guid> InserirAsync(AppDbContext db, Guid medicoId, string direcao,
        DocumentoRegistrarReq req, string status, string enviadoPor) =>
        db.Database.ExecuteScalarAsync<Guid>(@"
            INSERT INTO medico_documentos
                (medico_id, direcao, tipo, titulo, s3_key, content_type, tamanho_bytes, status, enviado_por)
            VALUES ({0}, {1}, {2}, {3}, {4}, NULLIF({5}, ''), {6}, {7}, {8})
            RETURNING id",
            medicoId, direcao, req.Tipo!, req.Titulo.Trim(), req.S3Key,
            req.ContentType ?? "", req.TamanhoBytes > 0 ? req.TamanhoBytes : (long?)null, status, enviadoPor);

    private static Task<string?> KeyDoDocAsync(AppDbContext db, Guid id, Guid medicoId) =>
        db.Database.ExecuteScalarAsync<string?>(
            "SELECT s3_key FROM medico_documentos WHERE id = {0} AND medico_id = {1}", id, medicoId);

    // SAS não impõe Content-Type (o presign do S3 impunha) — a allowlist de MIME
    // acima segue validando o pedido; enforcement pós-upload é o DEBT T1-8.
    private static string PresignPut(BlobStoragePresigner storage, string container, string key) =>
        storage.PresignPut(container, key, TimeSpan.FromMinutes(PresignUploadMin));

    private static string PresignGet(BlobStoragePresigner storage, string container, string key) =>
        storage.PresignGet(container, key, TimeSpan.FromMinutes(PresignDownloadMin));

    private static string Ext(string contentType) => contentType.ToLowerInvariant() switch
    {
        "application/pdf" => "pdf",
        "image/jpeg" => "jpg",
        "image/png" => "png",
        _ => "bin",
    };

    private static async Task<Guid?> GetMedicoIdAsync(AppDbContext db, ClaimsPrincipal user)
    {
        var sub = user.FindFirst("sub")?.Value;
        if (!Guid.TryParse(sub, out var userId)) return null;
        return await db.Database.ExecuteScalarAsync<Guid?>(
            "SELECT id FROM medicos WHERE usuario_id = {0}", userId);
    }
}

public record DocumentoUploadUrlReq(string Tipo, string Titulo, string ContentType);
public record DocumentoRegistrarReq(string S3Key, string Tipo, string Titulo, string? ContentType, long TamanhoBytes);
public record AdminRevisarReq(string Status, string? Observacoes);

public record DocumentoItem(
    Guid Id, string Direcao, string Tipo, string Titulo, string Status,
    string? ContentType, long? TamanhoBytes, DateTime CriadoEm, string? Observacoes);
