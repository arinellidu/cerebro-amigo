using ApiGateway.Auth;
using ApiGateway.Data;
using ApiGateway.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;

// ADR-066 Fase 4 — extras do Portal do Psiquiatra (médico-facing, sem LLM):
//   Segurança:  trocar senha (logado) · esqueci-senha · redefinir-senha (anon)
//   Foto:       upload-url + set (SAS do Azure Blob, container dos docs — ADR-082)
//   LGPD:       exportar meus dados (JSON) · solicitar exclusão (soft, Regra 5)

namespace ApiGateway.Endpoints;

public static class ContaEndpoints
{
    public static void Map(WebApplication app)
    {
        var container = app.Configuration["BLOB_CONTAINER_MEDICO_DOCS"] ?? "medico-docs";

        // ── SEGURANÇA (logado) ───────────────────────────────────────────────
        app.MapPost("/api/v1/me/senha", async (
            [FromBody] TrocarSenhaReq req, AppDbContext db, IPasswordHasher hasher,
            LoginRateLimiter rateLimiter, ClaimsPrincipal user, HttpContext ctx) =>
        {
            var sub = user.FindFirst("sub")?.Value;
            if (!Guid.TryParse(sub, out var userId)) return Results.Forbid();
            if (string.IsNullOrWhiteSpace(req.NovaSenha) || req.NovaSenha.Length < 8)
                return Results.BadRequest(new { error = "senha_curta" });

            // Rate-limit (ADR-066 review): impede brute-force online da senha ATUAL
            // por uma sessão (mesmo já autenticada). Mesma política de login (5/15min).
            var rlKey = "senha:" + userId;
            if (await rateLimiter.IsBlockedAsync(rlKey)) return Results.StatusCode(429);

            var u = await db.Usuarios.FirstOrDefaultAsync(x => x.Id == userId);
            if (u is null) return Results.Forbid();
            if (!hasher.Verify(req.SenhaAtual ?? "", u.SenhaHash))
            {
                await rateLimiter.RecordFailureAsync(rlKey);
                return Results.BadRequest(new { error = "senha_atual_incorreta" });
            }

            u.SenhaHash = hasher.Hash(req.NovaSenha);
            u.TokenVersion++;   // T1-7: revoga JWTs ativos emitidos antes da troca
            await db.SaveChangesAsync();
            await rateLimiter.RecordSuccessAsync(rlKey);
            await RegistrarEventoContaAsync(db, userId, null, "senha_alterada", ctx);
            return Results.NoContent();
        }).WithTags("conta").RequireAuthorization();

        // ── SEGURANÇA (anônimo): esqueci / redefinir senha ───────────────────
        // Reusa medico_invite_tokens com proposito='reset' (migration 0053).
        app.MapPost("/api/v1/auth/esqueci-senha", async (
            [FromBody] EsqueciSenhaReq req, AppDbContext db, ResendClient resend,
            LoginRateLimiter rateLimiter) =>
        {
            var emailNorm = (req.Email ?? "").Trim().ToLowerInvariant();
            // Anti-enumeração: SEMPRE 202, exista ou não a conta.
            if (string.IsNullOrWhiteSpace(emailNorm)) return Results.Accepted();

            // Rate-limit por e-mail (anti email-bombing / abuso de cota Resend) — mesma
            // política de login/signup (5/15min). Bloqueado → 202 silencioso (anti-enum).
            var rlKey = "reset:" + emailNorm;
            if (await rateLimiter.IsBlockedAsync(rlKey)) return Results.Accepted();
            await rateLimiter.RecordFailureAsync(rlKey);

            var u = await db.Usuarios.FirstOrDefaultAsync(x => x.Email == emailNorm);
            // Não emite reset p/ conta com exclusão LGPD pendente (coerência ADR-066):
            // exclusão é soft (não seta desativado_em), então checa explicitamente.
            var exclusao = u is null ? null : await db.Database.ExecuteScalarAsync<DateTime?>(
                "SELECT exclusao_solicitada_em FROM medicos WHERE usuario_id = {0}", u.Id);
            if (u is not null && u.Role == "medico" && u.DesativadoEm is null && exclusao is null)
            {
                // Um link de reset ativo por vez: invalida os anteriores ainda válidos.
                await db.Database.ExecuteSqlRawAsync(
                    "UPDATE medico_invite_tokens SET usado_em = NOW() WHERE usuario_id = {0} AND proposito = 'reset' AND usado_em IS NULL",
                    u.Id);
                var token = TokenAleatorio();
                await db.Database.ExecuteSqlRawAsync(@"
                    INSERT INTO medico_invite_tokens (usuario_id, token_hash, expira_em, proposito)
                    VALUES ({0}, {1}, NOW() + INTERVAL '1 hour', 'reset')",
                    u.Id, Sha256(token));

                var baseUrl = app.Configuration["PORTAL_PACIENTE_URL"] ?? "http://localhost:3000";
                var link = $"{baseUrl}/redefinir-senha?token={token}";
                var html = $"""
                    <p>Olá, {u.Nome}!</p>
                    <p>Recebemos um pedido para redefinir sua senha do <strong>Cérebro Amigo</strong>.</p>
                    <p><a href="{link}">Clique aqui para criar uma nova senha</a></p>
                    <p>O link vale por 1 hora. Se não foi você, ignore este e-mail.</p>
                    """;
                var txt = $"Redefina sua senha do Cérebro Amigo:\n{link}\n\nVálido por 1 hora.";
                try { await resend.SendAsync(emailNorm, "Redefinir senha — Cérebro Amigo", html, txt); }
                catch { /* best-effort: não revela falha ao cliente (anti-enum) */ }
            }
            return Results.Accepted();
        }).AllowAnonymous().WithTags("conta");

        app.MapPost("/api/v1/auth/redefinir-senha", async (
            [FromBody] RedefinirSenhaReq req, AppDbContext db, IPasswordHasher hasher,
            LoginRateLimiter rateLimiter, HttpContext ctx) =>
        {
            if (string.IsNullOrWhiteSpace(req.Token) || string.IsNullOrWhiteSpace(req.NovaSenha))
                return Results.BadRequest(new { error = "dados_invalidos" });
            if (req.NovaSenha.Length < 8) return Results.BadRequest(new { error = "senha_curta" });

            var hash = Sha256(req.Token);
            var row = await db.Database.SqlQueryRaw<ResetTokenRow>(@"
                SELECT usuario_id::text AS usuario_id, expira_em, usado_em
                FROM medico_invite_tokens
                WHERE token_hash = {0} AND proposito = 'reset'", hash).FirstOrDefaultAsync();
            if (row is null) return Results.BadRequest(new { error = "token_invalido" });
            if (row.UsadoEm is not null) return Results.BadRequest(new { error = "token_ja_utilizado" });
            if (row.ExpiraEm < DateTime.UtcNow) return Results.StatusCode(410);

            await db.Database.ExecuteSqlRawAsync(
                // T1-7: reset de senha revoga JWTs ativos (token_version++).
                "UPDATE usuarios SET senha_hash = {0}, token_version = token_version + 1 WHERE id = {1}::uuid",
                hasher.Hash(req.NovaSenha), row.UsuarioId);
            await db.Database.ExecuteSqlRawAsync(
                "UPDATE medico_invite_tokens SET usado_em = NOW() WHERE token_hash = {0}", hash);

            // Reset OK: limpa o rate-limit 'reset:<email>' p/ não travar reenvio legítimo
            // (ADR-066 review) + auditoria.
            var email = await db.Database.ExecuteScalarAsync<string>(
                "SELECT email FROM usuarios WHERE id = {0}::uuid", row.UsuarioId);
            if (!string.IsNullOrEmpty(email)) await rateLimiter.RecordSuccessAsync("reset:" + email);
            if (Guid.TryParse(row.UsuarioId, out var uid))
                await RegistrarEventoContaAsync(db, uid, null, "senha_redefinida", ctx);
            return Results.NoContent();
        }).AllowAnonymous().WithTags("conta");

        // ── FOTO DE PERFIL ───────────────────────────────────────────────────
        app.MapPost("/api/v1/me/foto/upload-url", async (
            [FromBody] FotoUploadReq req, AppDbContext db, ClaimsPrincipal user, BlobStoragePresigner storage) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();
            var ext = req.ContentType switch { "image/jpeg" => "jpg", "image/png" => "png", _ => "" };
            if (ext == "") return Results.BadRequest(new { error = "tipo_arquivo_invalido" });

            var key = $"medico/{medicoId.Value}/foto/{Guid.NewGuid()}.{ext}";
            var url = storage.PresignPut(container, key, TimeSpan.FromMinutes(15));
            return Results.Ok(new { uploadUrl = url, s3Key = key });
        }).WithTags("conta").RequireAuthorization();

        app.MapPost("/api/v1/me/foto", async (
            [FromBody] FotoSetReq req, AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();
            if (string.IsNullOrWhiteSpace(req.S3Key)
                || !req.S3Key.StartsWith($"medico/{medicoId.Value}/foto/", StringComparison.Ordinal))
                return Results.BadRequest(new { error = "s3key_invalida" });
            await db.Database.ExecuteSqlRawAsync(
                "UPDATE medicos SET foto_s3key = {1} WHERE id = {0}", medicoId.Value, req.S3Key);
            return Results.NoContent();
        }).WithTags("conta").RequireAuthorization();

        // ── LGPD: exportar meus dados (só do médico; sem conteúdo clínico de paciente) ──
        app.MapGet("/api/v1/me/exportar", async (AppDbContext db, ClaimsPrincipal user, HttpContext ctx) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            var perfil = await db.Database.SqlQueryRaw<ExportPerfil>(@"
                SELECT m.nome, u.email, m.crm, m.crm_uf, m.cpf, m.especialidade,
                       m.timezone, m.criado_em
                FROM medicos m JOIN usuarios u ON u.id = m.usuario_id
                WHERE m.id = {0}", medicoId.Value).FirstOrDefaultAsync();

            var assinatura = await db.Database.SqlQueryRaw<ExportAssinatura>(@"
                SELECT plano, valor_mensal, status, trial_ate, prazo_pagamento_ate
                FROM assinaturas WHERE medico_id = {0}", medicoId.Value).FirstOrDefaultAsync();

            var totalPacientes = await db.Database.ExecuteScalarAsync<long>(
                "SELECT COUNT(*) FROM pacientes WHERE medico_responsavel_id = {0}", medicoId.Value);

            if (Guid.TryParse(user.FindFirst("sub")?.Value, out var uidExp))
                await RegistrarEventoContaAsync(db, uidExp, medicoId.Value, "dados_exportados", ctx);

            return Results.Ok(new
            {
                geradoEm = DateTime.UtcNow,
                perfil,
                assinatura,
                contadores = new { pacientes = totalPacientes },
                observacao = "Exportação dos seus dados de cadastro (LGPD). Não inclui conteúdo clínico de pacientes."
            });
        }).WithTags("conta").RequireAuthorization();

        // ── LGPD: solicitar exclusão (soft — não apaga; admin processa; Regra 5) ──
        app.MapPost("/api/v1/me/exclusao", async (
            [FromBody] ExclusaoReq req, AppDbContext db, IPasswordHasher hasher,
            ClaimsPrincipal user, HttpContext ctx) =>
        {
            var sub = user.FindFirst("sub")?.Value;
            if (!Guid.TryParse(sub, out var userId)) return Results.Forbid();
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            // Reautenticação (ADR-066 review): exclusão de conta exige a senha atual —
            // caminho de alto risco, não pode depender só do cookie de sessão.
            var u = await db.Usuarios.FirstOrDefaultAsync(x => x.Id == userId);
            if (u is null) return Results.Forbid();
            if (!hasher.Verify(req.SenhaAtual ?? "", u.SenhaHash))
                return Results.BadRequest(new { error = "senha_atual_incorreta" });

            // Soft delete (Regra 5: não apaga nada): marca o pedido E desativa o login
            // (usuarios.desativado_em é o que o /login checa) — alinha código ⇄ ADR-066.
            await db.Database.ExecuteSqlRawAsync(
                "UPDATE medicos SET exclusao_solicitada_em = COALESCE(exclusao_solicitada_em, NOW()) WHERE id = {0}",
                medicoId.Value);
            await db.Database.ExecuteSqlRawAsync(
                "UPDATE usuarios SET desativado_em = COALESCE(desativado_em, NOW()) WHERE id = {0}", userId);
            await RegistrarEventoContaAsync(db, userId, medicoId.Value, "exclusao_solicitada", ctx);
            return Results.Accepted();
        }).WithTags("conta").RequireAuthorization();
    }

    private static string TokenAleatorio() =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .Replace("+", "-").Replace("/", "_").Replace("=", "");

    private static string Sha256(string input) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(input))).ToLowerInvariant();

    private static async Task<Guid?> GetMedicoIdAsync(AppDbContext db, ClaimsPrincipal user)
    {
        var sub = user.FindFirst("sub")?.Value;
        if (!Guid.TryParse(sub, out var userId)) return null;
        return await db.Database.ExecuteScalarAsync<Guid?>(
            "SELECT id FROM medicos WHERE usuario_id = {0}", userId);
    }

    // Trilha de auditoria das ações sensíveis de conta (LGPD art.37). Best-effort —
    // nunca bloqueia a ação. medico_id pode ser null (ex.: troca de senha resolve só
    // o usuário). Usa ExecuteRawAsync (null-safe; ExecuteSqlRawAsync estoura com DBNull).
    private static async Task RegistrarEventoContaAsync(
        AppDbContext db, Guid usuarioId, Guid? medicoId, string acao, HttpContext ctx)
    {
        try
        {
            var ip = ctx.Request.Headers["X-Forwarded-For"].ToString().Split(',')[0].Trim();
            if (string.IsNullOrEmpty(ip)) ip = ctx.Connection.RemoteIpAddress?.ToString() ?? "";
            await db.Database.ExecuteRawAsync(@"
                INSERT INTO eventos_conta (usuario_id, medico_id, acao, ip)
                VALUES ({0}, {1}, {2}, NULLIF({3}, ''))",
                usuarioId, medicoId, acao, ip);
        }
        catch { /* best-effort: auditoria não bloqueia a ação */ }
    }
}

public record TrocarSenhaReq(string? SenhaAtual, string NovaSenha);
public record EsqueciSenhaReq(string Email);
public record RedefinirSenhaReq(string Token, string NovaSenha);
public record ExclusaoReq(string? SenhaAtual);
public record FotoUploadReq(string ContentType);
public record FotoSetReq(string S3Key);
internal record ResetTokenRow(string UsuarioId, DateTime ExpiraEm, DateTime? UsadoEm);
public record ExportPerfil(
    string Nome, string Email, string? Crm, string? CrmUf, string? Cpf,
    string? Especialidade, string? Timezone, DateTime CriadoEm);
public record ExportAssinatura(
    string? Plano, decimal? ValorMensal, string? Status, DateTime? TrialAte, DateTime? PrazoPagamentoAte);
