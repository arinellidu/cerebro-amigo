using ApiGateway.Auth;
using ApiGateway.Data;
using ApiGateway.Models;
using ApiGateway.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace ApiGateway.Endpoints;

public static class AuthEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/auth").WithTags("auth");

        g.MapPost("/login", async (
            [FromBody] LoginRequest req,
            AppDbContext db,
            IPasswordHasher hasher,
            TokenService tokens,
            LoginRateLimiter rateLimiter) =>
        {
            var emailNorm = req.Email.Trim().ToLowerInvariant();

            // Rate limiting: bloqueio após 5 tentativas falhas em 15 min
            if (await rateLimiter.IsBlockedAsync(emailNorm))
                return Results.StatusCode(429);

            var user = await db.Usuarios.FirstOrDefaultAsync(u => u.Email == emailNorm);
            if (user is null || !hasher.Verify(req.Senha, user.SenhaHash))
            {
                await rateLimiter.RecordFailureAsync(emailNorm);

                // Antes de devolver 401 genérico, verifica se o email pertence
                // ao portal do paciente. Se for o caso, devolve 409 com hint pra
                // o frontend redirecionar — pacientes confundem `/login` (médico)
                // com `/p/entrar` (paciente) com facilidade.
                var ehPaciente = await db.Database.SqlQueryRaw<int>(@"
                    SELECT 1 FROM pacientes_credenciais pc
                    LEFT JOIN clientes c ON c.id = pc.paciente_id
                    WHERE pc.email = {0} OR c.email = {0}
                    LIMIT 1", emailNorm).AnyAsync();
                if (ehPaciente)
                {
                    return Results.Json(
                        new { error = "wrong_portal", expected = "paciente", go = "/p/entrar" },
                        statusCode: 409);
                }
                return Results.Unauthorized();
            }

            // Usuário desativado (soft delete) não loga.
            if (user.DesativadoEm is not null)
            {
                await rateLimiter.RecordFailureAsync(emailNorm);
                return Results.Unauthorized();
            }

            await rateLimiter.RecordSuccessAsync(emailNorm);
            user.UltimoLogin = DateTime.UtcNow;

            // Migração gradual: hash legado PBKDF2 → bcrypt no próximo login OK
            if (hasher.NeedsRehash(user.SenhaHash))
            {
                user.SenhaHash = hasher.Hash(req.Senha);
            }

            await db.SaveChangesAsync();

            var token = tokens.GenerateForUser(user);
            return Results.Ok(new LoginResponse(token, user.Nome, user.Role));
        })
        .AllowAnonymous()
        .WithSummary("Login no dashboard");

        // GET /api/v1/auth/me — valida a sessão e retorna dados do médico logado.
        // Útil para o frontend verificar se a configuração está ok antes de
        // operações que dependem do registro em `medicos`.
        g.MapGet("/me", async (AppDbContext db, ClaimsPrincipal user, BlobStoragePresigner storage, IConfiguration cfg) =>
        {
            var sub = user.FindFirst("sub")?.Value;
            if (!Guid.TryParse(sub, out var usuarioId))
                return Results.Forbid();

            var row = await db.Database.SqlQueryRaw<MedicoMeDto>(@"
                SELECT m.id AS medico_id, m.nome, m.crm, m.especialidade,
                       u.id AS usuario_id, u.email, u.role,
                       a.status AS assinatura_status, a.prazo_pagamento_ate, a.trial_ate,
                       a.plano, m.foto_s3key
                FROM medicos m
                JOIN usuarios u ON u.id = m.usuario_id
                LEFT JOIN assinaturas a ON a.medico_id = m.id
                WHERE m.usuario_id = {0}",
                usuarioId).FirstOrDefaultAsync();

            if (row is null) return Results.Forbid();

            // ADR-066: avatar via SAS GET curta (só se houver foto). /me é
            // chamado uma vez por navegação (cache no use-me) → custo aceitável.
            string? fotoUrl = null;
            if (!string.IsNullOrWhiteSpace(row.FotoS3Key))
            {
                var container = cfg["BLOB_CONTAINER_MEDICO_DOCS"] ?? "medico-docs";
                fotoUrl = storage.PresignGet(container, row.FotoS3Key, TimeSpan.FromMinutes(60));
            }

            // ADR-055: situação de acesso exposta p/ a UI (sidebar/banner/paywall).
            // SEM enforcement aqui — /me NUNCA é gateado (é como o front detecta o
            // bloqueio). O gate real (Fase D) mora nos endpoints de dashboard.
            var sit = AssinaturaGate.Avaliar(
                row.AssinaturaStatus, row.PrazoPagamentoAte, row.TrialAte, DateTime.UtcNow, row.Plano);

            return Results.Ok(new
            {
                medicoId = row.MedicoId, nome = row.Nome, crm = row.Crm,
                especialidade = row.Especialidade, usuarioId = row.UsuarioId,
                email = row.Email, role = row.Role,
                assinaturaStatus = row.AssinaturaStatus,
                liberado = sit.Liberado, bloqueado = !sit.Liberado, emPrazo = sit.EmPrazo,
                // ADR-065: trial de aquisição — UI mostra banner read-only + teaser.
                readOnly = sit.TrialReadOnly,
                diasRestantes = sit.DiasRestantes, motivo = sit.Motivo,
                prazoPagamentoAte = row.PrazoPagamentoAte,
                // ADR-059: plano + features liberadas (camada IA = Pro) p/ a UI gatear/upsell.
                plano = row.Plano,
                features = PlanCatalog.FeaturesDe(row.Plano),
                fotoUrl,
            });
        })
        .RequireAuthorization()
        .WithSummary("Perfil do médico logado (health-check de sessão)");

        // POST /api/v1/auth/ativar-conta — médico define senha usando token de convite.
        g.MapPost("/ativar-conta", async (
            [FromBody] AtivarContaRequest req,
            AppDbContext db, IPasswordHasher hasher) =>
        {
            if (string.IsNullOrWhiteSpace(req.Token) || string.IsNullOrWhiteSpace(req.Senha))
                return Results.BadRequest(new { error = "token e senha obrigatórios" });
            if (req.Senha.Length < 8)
                return Results.BadRequest(new { error = "senha minimo 8 caracteres" });

            var tokenHash = AuthSha256(req.Token);
            // Filtra proposito='ativacao' (ADR-066/migration 0053): um token de RESET
            // de senha não pode ser consumido pelo fluxo de ativação (isolamento por
            // finalidade). Tokens criados antes da 0053 têm o DEFAULT 'ativacao'.
            var row = await db.Database.SqlQueryRaw<TokenRow>(
                "SELECT usuario_id::text AS usuario_id, expira_em, usado_em FROM medico_invite_tokens WHERE token_hash = {0} AND proposito = 'ativacao'",
                tokenHash).FirstOrDefaultAsync();

            if (row is null) return Results.BadRequest(new { error = "token_invalido" });
            if (row.UsadoEm is not null) return Results.BadRequest(new { error = "token_ja_utilizado" });
            if (row.ExpiraEm < DateTime.UtcNow) return Results.StatusCode(410);

            var senhaHash = hasher.Hash(req.Senha);
            await db.Database.ExecuteSqlRawAsync(
                // T1-7: define senha + token_version++ (sem sessão ativa ainda; uniforme).
                "UPDATE usuarios SET senha_hash = {0}, token_version = token_version + 1 WHERE id = {1}::uuid",
                senhaHash, row.UsuarioId);
            await db.Database.ExecuteSqlRawAsync(
                "UPDATE medico_invite_tokens SET usado_em = NOW() WHERE token_hash = {0}",
                tokenHash);

            return Results.NoContent();
        })
        .AllowAnonymous()
        .WithSummary("Ativa conta de médico convidado (define senha)");

        // POST /api/v1/auth/medico/signup — auto-cadastro de médico EXTERNO (ADR-046).
        // Superfície PÚBLICA ANÔNIMA no gateway clínico. clinical-safety: sem dado de
        // paciente, sem LLM, médico nasce no próprio tenant (RLS) com zero pacientes.
        // Validação determinística (CFM); rate-limit por IP (Infosimples é PAGO); CRM
        // Regular hard gate + nome confere com CFM; e-mail-verify (ativa em /ativar-conta).
        g.MapPost("/medico/signup", async (
            [FromBody] MedicoSignupRequest req,
            MedicoOnboardingService onboarding,
            LoginRateLimiter rateLimiter,
            TurnstileVerifier turnstile,
            HttpContext ctx) =>
        {
            var ip = ClientIp(ctx);
            var rlKey = "signup:" + ip;
            if (await rateLimiter.IsBlockedAsync(rlKey))
                return Results.StatusCode(429);
            await rateLimiter.RecordFailureAsync(rlKey); // cada tentativa consome (sucesso também) — protege a API paga

            // Anti-abuso (ADR-055): valida o Turnstile ANTES da consulta de CRM (paga).
            // Desligado (sem TURNSTILE_SECRET_KEY) passa direto; fail-closed se indisponível.
            if (!await turnstile.VerifyAsync(req.TurnstileToken, ip))
                return Results.Json(new
                {
                    error = "captcha_invalido",
                    mensagem = "Falha na verificação de segurança. Recarregue a página e tente novamente."
                }, statusCode: 403);

            var src = (req.Src ?? "").Trim().ToLowerInvariant();
            var fromCheckup = src == "checkup";
            var rid = fromCheckup ? SanitizeRid(req.Rid) : null;

            // CPF OBRIGATÓRIO no signup (ADR-065): identidade forte (junto de CRM+UF+nome)
            // e necessário p/ o self-checkout Asaas. Vazio → 400; inválido → 400.
            if (string.IsNullOrWhiteSpace(req.Cpf))
                return Results.Json(new { error = "cpf_obrigatorio", mensagem = "CPF é obrigatório para o cadastro." }, statusCode: 400);
            if (!ApiGateway.Services.Cpf.Valido(req.Cpf))
                return Results.Json(new { error = "cpf_invalido", mensagem = "CPF inválido. Confira os números." }, statusCode: 400);
            var cpf = ApiGateway.Services.Cpf.Normalizar(req.Cpf);

            var r = await onboarding.OnboardAsync(new OnboardMedicoInput(
                Nome: req.Nome, Email: req.Email, Crm: req.Crm, CrmUf: req.CrmUf, Cpf: cpf,
                Plano: "pendente", ValorMensal: 0m,
                SignupSource: fromCheckup ? "checkup" : "self",
                CheckupRid: rid,
                AllowCrmSoftFail: false,
                RequireNameMatch: true));

            if (!r.Success)
                return Results.Json(new { error = r.Error, mensagem = r.Mensagem, situacao = r.Situacao },
                    statusCode: r.StatusCode);

            // Não retorna ids/token ao público; o e-mail-verify (/ativar-conta) é a próxima etapa.
            return Results.Json(new
            {
                mensagem = "Conta criada. Enviamos um e-mail para você definir a senha e ativar o acesso."
            }, statusCode: 202);
        })
        .AllowAnonymous()
        .WithSummary("Auto-cadastro de médico externo (valida CRM; ativa por e-mail)");
    }

    // IP do cliente atrás do Caddy: 1º IP do X-Forwarded-For; senão o socket.
    private static string ClientIp(HttpContext ctx)
    {
        if (ctx.Request.Headers.TryGetValue("X-Forwarded-For", out var xff))
        {
            var first = xff.ToString().Split(',', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault()?.Trim();
            if (!string.IsNullOrEmpty(first)) return first;
        }
        return ctx.Connection.RemoteIpAddress?.ToString() ?? "0.0.0.0";
    }

    // rid do Check-up (8 chars do UUID). Sanitiza valor público antes de gravar.
    private static string? SanitizeRid(string? rid)
    {
        if (string.IsNullOrWhiteSpace(rid)) return null;
        rid = rid.Trim();
        if (rid.Length is < 4 or > 32) return null;
        return rid.All(c => char.IsLetterOrDigit(c) || c == '-') ? rid : null;
    }

    private static string AuthSha256(string input)
    {
        var bytes = System.Security.Cryptography.SHA256.HashData(
            System.Text.Encoding.UTF8.GetBytes(input));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }
}

public record AtivarContaRequest(string Token, string Senha);
public record MedicoSignupRequest(
    string Nome, string Email, string Crm, string CrmUf, string? Src, string? Rid, string? TurnstileToken,
    string? Cpf = null);
internal record TokenRow(string UsuarioId, DateTime ExpiraEm, DateTime? UsadoEm);

public record MedicoMeDto(
    Guid MedicoId, string Nome, string Crm, string? Especialidade,
    Guid UsuarioId, string Email, string Role,
    string? AssinaturaStatus, DateTime? PrazoPagamentoAte, DateTime? TrialAte,
    string? Plano = null, string? FotoS3Key = null);
