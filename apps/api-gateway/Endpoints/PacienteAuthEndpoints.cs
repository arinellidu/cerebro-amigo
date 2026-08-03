using ApiGateway.Auth;
using ApiGateway.Data;
using ApiGateway.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;

namespace ApiGateway.Endpoints;

/// <summary>
/// Endpoints de autenticação do paciente (separado dos médicos).
///
/// Fluxos:
///  1. Médico cadastra paciente -> sistema gera magic link -> bot manda no WhatsApp
///  2. Paciente clica no link -> /auth/paciente/magic -> define senha
///  3. Acessos seguintes: /auth/paciente/login com email + senha
/// </summary>
public static class PacienteAuthEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/auth/paciente").WithTags("paciente-auth");

        // Solicitar magic link — APENAS o médico dono do paciente (fluxo de convite).
        g.MapPost("/magic-link", async (
            [FromBody] SolicitarMagicLinkRequest req,
            AppDbContext db,
            IConfiguration config,
            LoginRateLimiter rateLimiter,
            ResendClient resend,
            ILogger<Program> logger,
            ClaimsPrincipal user) =>
        {
            if (string.IsNullOrWhiteSpace(req.Email))
                return Results.BadRequest(new { error = "email obrigatório" });

            // Tenant: resolve o médico do JWT (claim sub). Token de paciente ou
            // não-médico não resolve -> Forbid. Impede gerar link cross-tenant.
            var sub = user.FindFirst("sub")?.Value;
            if (!Guid.TryParse(sub, out var usuarioId)) return Results.Forbid();
            var medicoId = await db.Database.ExecuteScalarAsync<Guid?>(
                "SELECT id FROM medicos WHERE usuario_id = {0}", usuarioId);
            if (medicoId is null) return Results.Forbid();

            // Rate limiting: previne spam de magic links para o mesmo paciente
            var emailNorm = req.Email.Trim().ToLowerInvariant();
            if (await rateLimiter.IsBlockedAsync(emailNorm))
                return Results.StatusCode(429);

            // Busca paciente pelo email — ANCORADA no médico dono (não vaza cross-tenant).
            var paciente = await db.Database.SqlQueryRaw<MagicLinkPacienteDto>(@"
                SELECT c.id, COALESCE(c.email, '') AS email, c.nome
                FROM clientes c
                JOIN pacientes p ON p.cliente_id = c.id
                WHERE LOWER(c.email) = {0} AND p.medico_responsavel_id = {1}", emailNorm, medicoId.Value)
                .FirstOrDefaultAsync();

            if (paciente is null)
            {
                // Mesmo em 404, registra tentativa para evitar enumeration + spam
                await rateLimiter.RecordFailureAsync(emailNorm);
                return Results.NotFound();
            }

            // Gera token (bytes aleatórios -> base64url)
            var tokenBytes = RandomNumberGenerator.GetBytes(32);
            var token = Convert.ToBase64String(tokenBytes)
                .Replace("+", "-").Replace("/", "_").Replace("=", "");
            var hash = SHA256(token);

            // Um link de recuperação ativo por vez: invalida os anteriores ainda válidos.
            await db.Database.ExecuteSqlRawAsync(
                "UPDATE magic_links SET usado_em = NOW() WHERE paciente_id = {0} AND proposito = {1} AND usado_em IS NULL",
                paciente.Id, req.Proposito);

            await db.Database.ExecuteSqlRawAsync(@"
                INSERT INTO magic_links (paciente_id, token_hash, proposito, expira_em)
                VALUES ({0}, {1}, {2}, NOW() + INTERVAL '1 hour')",
                paciente.Id, hash, req.Proposito);

            var portalBase = config["PORTAL_PACIENTE_URL"] ?? "http://localhost:3000";
            var url = $"{portalBase}/p/entrar?token={token}";

            await rateLimiter.RecordFailureAsync(emailNorm); // conta tentativa (mesmo sucesso) — previne spam

            // Entrega POR E-MAIL ao próprio paciente — o médico NÃO recebe a URL
            // (preserva a credencial: só o paciente define a própria senha). best-effort:
            // se o Resend falhar, devolve a URL como fallback pro médico repassar.
            var (htmlBody, textBody) = MontarEmailRecuperacao(NomePrimeiro(paciente.Nome), url);
            string? emailErro = null;
            try
            {
                var r = await resend.SendAsync(
                    to: paciente.Email,
                    subject: "Redefinir senha — Cérebro Amigo",
                    htmlBody: htmlBody,
                    textBody: textBody);
                if (!r.Success) emailErro = r.Error;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "falha ao enviar magic link de recuperação ao paciente");
                emailErro = ex.Message;
            }

            var enviado = emailErro is null;
            return Results.Ok(new
            {
                enviado,
                email = paciente.Email,
                emailErro,
                url = enviado ? null : url, // fallback só quando o e-mail falhou
                expiraEm = DateTime.UtcNow.AddHours(1),
            });
        })
        .RequireAuthorization(); // só médico ou serviço interno

        // "Esqueci minha senha" — self-service do PACIENTE (anônimo).
        // Anti-enumeração: SEMPRE responde 202, exista ou não a conta — nunca revela
        // se o e-mail pertence a um paciente. Se pertencer, envia magic link de
        // recuperação (proposito='recuperacao', 1h) ao próprio e-mail.
        g.MapPost("/esqueci-senha", async (
            [FromBody] EsqueciSenhaPacienteRequest req,
            AppDbContext db,
            IConfiguration config,
            ResendClient resend,
            LoginRateLimiter rateLimiter,
            ILogger<Program> logger) =>
        {
            var emailNorm = (req.Email ?? "").Trim().ToLowerInvariant();
            if (string.IsNullOrWhiteSpace(emailNorm)) return Results.Accepted();

            // Rate-limit por e-mail (anti email-bombing / abuso de cota Resend) — mesma
            // política de login (5/15min). Bloqueado → 202 silencioso (anti-enum).
            var rlKey = "reset-pac:" + emailNorm;
            if (await rateLimiter.IsBlockedAsync(rlKey)) return Results.Accepted();
            await rateLimiter.RecordFailureAsync(rlKey);

            // Busca o paciente pelo e-mail SEM âncora de tenant — é o próprio paciente
            // pedindo e o link vai só pro e-mail dele (não vaza dado a terceiros).
            // LIMIT 1 espelha o /login (mesma resolução por e-mail).
            var paciente = await db.Database.SqlQueryRaw<MagicLinkPacienteDto>(@"
                SELECT c.id, COALESCE(c.email, '') AS email, c.nome
                FROM clientes c
                JOIN pacientes p ON p.cliente_id = c.id
                WHERE LOWER(c.email) = {0}
                LIMIT 1", emailNorm).FirstOrDefaultAsync();

            if (paciente is not null)
            {
                // Um link de recuperação ativo por vez.
                await db.Database.ExecuteSqlRawAsync(
                    "UPDATE magic_links SET usado_em = NOW() WHERE paciente_id = {0} AND proposito = 'recuperacao' AND usado_em IS NULL",
                    paciente.Id);

                var tokenBytes = RandomNumberGenerator.GetBytes(32);
                var token = Convert.ToBase64String(tokenBytes)
                    .Replace("+", "-").Replace("/", "_").Replace("=", "");
                await db.Database.ExecuteSqlRawAsync(@"
                    INSERT INTO magic_links (paciente_id, token_hash, proposito, expira_em)
                    VALUES ({0}, {1}, 'recuperacao', NOW() + INTERVAL '1 hour')",
                    paciente.Id, SHA256(token));

                var portalBase = config["PORTAL_PACIENTE_URL"] ?? "http://localhost:3000";
                var url = $"{portalBase}/p/entrar?token={token}";
                var (htmlBody, textBody) = MontarEmailRecuperacao(NomePrimeiro(paciente.Nome), url);
                try
                {
                    await resend.SendAsync(paciente.Email, "Redefinir senha — Cérebro Amigo", htmlBody, textBody);
                }
                catch (Exception ex)
                {
                    // best-effort: não revela falha ao cliente (anti-enum)
                    logger.LogError(ex, "falha ao enviar reset de senha do paciente");
                }
            }

            return Results.Accepted();
        })
        .AllowAnonymous();

        // Validar magic link e definir senha
        g.MapPost("/magic-validar", async (
            [FromBody] MagicValidarRequest req,
            AppDbContext db,
            IPasswordHasher hasher,
            IConfiguration config,
            HttpContext ctx) =>
        {
            var hash = SHA256(req.Token);
            var link = await db.Database.SqlQueryRaw<MagicLinkRow>(@"
                SELECT id, paciente_id, proposito,
                       expira_em, usado_em
                FROM magic_links WHERE token_hash = {0}", hash).FirstOrDefaultAsync();

            if (link is null || link.UsadoEm != null || link.ExpiraEm < DateTime.UtcNow)
                return Results.Unauthorized();

            // Senha é opcional: se fornecida, define/atualiza credenciais.
            // Sem senha = fluxo magic link puro (login sem trocar senha).
            if (!string.IsNullOrEmpty(req.NovaSenha))
            {
                if (req.NovaSenha.Length < 8) return Results.BadRequest(new { error = "senha_curta" });

                var senhaHash = hasher.Hash(req.NovaSenha);
                await db.Database.ExecuteSqlRawAsync(@"
                    INSERT INTO pacientes_credenciais (paciente_id, email, senha_hash, senha_definida_em)
                    SELECT {0}, c.email, {1}, NOW()
                    FROM clientes c WHERE c.id = {0}
                    ON CONFLICT (paciente_id) DO UPDATE
                    SET senha_hash = EXCLUDED.senha_hash,
                        email = EXCLUDED.email,
                        senha_definida_em = NOW(),
                        falhas_seguidas = 0,
                        bloqueado_ate = NULL,
                        token_version = pacientes_credenciais.token_version + 1",
                    link.PacienteId, senhaHash);
            }

            await db.Database.ExecuteSqlRawAsync(@"
                UPDATE magic_links SET usado_em = NOW(), ip_uso = {0}::inet WHERE id = {1}",
                ctx.Connection.RemoteIpAddress?.ToString() ?? "0.0.0.0", link.Id);

            await RegistrarAcesso(db, link.PacienteId, "magic_link_usado", ctx);

            // Gera token de sessão imediatamente, já com a token_version atual (T1-7).
            // Sem credencial (magic puro, sem senha) → null → 1; OnTokenValidated pula o
            // check quando não há linha em pacientes_credenciais.
            var tv = await db.Database.ExecuteScalarAsync<int?>(
                "SELECT token_version FROM pacientes_credenciais WHERE paciente_id = {0}", link.PacienteId) ?? 1;
            var (access, _) = GerarTokensSessao(link.PacienteId, tv, config);
            return Results.Ok(new { token = access });
        })
        .AllowAnonymous();

        // Login normal (após senha definida)
        g.MapPost("/login", async (
            [FromBody] PacienteLoginRequest req,
            AppDbContext db,
            IPasswordHasher hasher,
            IConfiguration config,
            HttpContext ctx) =>
        {
            if (string.IsNullOrEmpty(req.Email)) return Results.BadRequest();
            var emailNorm = req.Email.Trim().ToLowerInvariant();

            // O email pode estar em pacientes_credenciais OU em clientes.email
            // (depende se já fez magic-validar ou não)
            var cred = await db.Database.SqlQueryRaw<CredencialRow>(@"
                SELECT pc.paciente_id, pc.senha_hash,
                       pc.bloqueado_ate, pc.falhas_seguidas,
                       pc.senha_temporaria, pc.token_version
                FROM pacientes_credenciais pc
                LEFT JOIN clientes c ON c.id = pc.paciente_id
                WHERE pc.email = {0} OR c.email = {0}
                LIMIT 1",
                emailNorm).FirstOrDefaultAsync();

            if (cred is null || string.IsNullOrEmpty(cred.SenhaHash))
            {
                // Caso simétrico ao `/auth/login`: se o email pertence ao portal
                // do médico, devolve 409 com hint pra trocar de portal.
                var ehMedico = await db.Usuarios
                    .AnyAsync(u => u.Email == emailNorm);
                if (ehMedico)
                {
                    return Results.Json(
                        new { error = "wrong_portal", expected = "medico", go = "/login" },
                        statusCode: 409);
                }
                return Results.Unauthorized();
            }

            // Bloqueio temporário (5 falhas → 15min)
            if (cred.BloqueadoAte != null && cred.BloqueadoAte > DateTime.UtcNow)
                return Results.StatusCode(429);

            if (!hasher.Verify(req.Senha, cred.SenhaHash))
            {
                await db.Database.ExecuteSqlRawAsync(@"
                    UPDATE pacientes_credenciais
                    SET falhas_seguidas = falhas_seguidas + 1,
                        bloqueado_ate = CASE
                            WHEN falhas_seguidas + 1 >= 5
                                THEN NOW() + INTERVAL '15 minutes'
                            ELSE bloqueado_ate
                        END
                    WHERE paciente_id = {0}", cred.PacienteId);
                return Results.Unauthorized();
            }

            // Login OK
            var novoHash = hasher.NeedsRehash(cred.SenhaHash)
                ? hasher.Hash(req.Senha)
                : cred.SenhaHash;

            await db.Database.ExecuteSqlRawAsync(@"
                UPDATE pacientes_credenciais
                SET ultimo_login = NOW(),
                    falhas_seguidas = 0,
                    bloqueado_ate = NULL,
                    senha_hash = {1}
                WHERE paciente_id = {0}", cred.PacienteId, novoHash);

            await RegistrarAcesso(db, cred.PacienteId, "login", ctx);

            // token_version atual (o rehash acima NÃO a altera → não revoga no login). T1-7.
            var (access, _) = GerarTokensSessao(cred.PacienteId, cred.TokenVersion, config);
            // `senhaTemporaria` sinaliza pro frontend redirecionar à tela de
            // troca obrigatória de senha. Veio do médico via cadastro em
            // consultório (fluxo `senha_provisoria`).
            return Results.Ok(new { token = access, senhaTemporaria = cred.SenhaTemporaria });
        })
        .AllowAnonymous();

        // Trocar senha (paciente logado)
        g.MapPost("/senha", async (
            [FromBody] TrocarSenhaRequest req,
            AppDbContext db,
            IPasswordHasher hasher,
            ClaimsPrincipal user,
            HttpContext ctx) =>
        {
            var pid = GetPacienteId(user);
            if (pid is null) return Results.Unauthorized();

            var atual = await db.Database.ExecuteScalarAsync<string>(
                "SELECT senha_hash FROM pacientes_credenciais WHERE paciente_id = {0}",
                pid.Value);
            if (atual is null || !hasher.Verify(req.SenhaAtual, atual))
                return Results.Unauthorized();

            if (req.NovaSenha.Length < 8) return Results.BadRequest(new { error = "senha_curta" });

            await db.Database.ExecuteSqlRawAsync(@"
                UPDATE pacientes_credenciais
                SET senha_hash = {0},
                    senha_definida_em = NOW(),
                    senha_temporaria = FALSE,
                    token_version = token_version + 1
                WHERE paciente_id = {1}", hasher.Hash(req.NovaSenha), pid.Value);

            await RegistrarAcesso(db, pid.Value, "senha_alterada", ctx);
            return Results.NoContent();
        })
        .RequireAuthorization("paciente");
    }

    public static Guid? GetPacienteId(ClaimsPrincipal user)
    {
        var role = user.FindFirst("role")?.Value;
        if (role != "paciente") return null;
        var sub = user.FindFirst("sub")?.Value;
        return Guid.TryParse(sub, out var id) ? id : null;
    }

    private static (string accessToken, string refreshToken) GerarTokensSessao(
        Guid pacienteId, int tokenVersion, IConfiguration config)
    {
        var secret = config["Jwt:Secret"] is { Length: > 0 } s ? s : config["JWT_SECRET"]
                     ?? throw new InvalidOperationException("Jwt:Secret / JWT_SECRET obrigatório");
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, pacienteId.ToString()),
            new Claim("role", "paciente"),
            new Claim("tv", tokenVersion.ToString()),  // T1-7: versão de sessão (revogação)
            new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString())
        };

        var token = new JwtSecurityToken(
            issuer: config["Jwt:Issuer"] ?? "cerebro-amigo",
            audience: "portal-paciente",
            claims: claims,
            expires: DateTime.UtcNow.AddDays(7),
            signingCredentials: creds);

        var access = new JwtSecurityTokenHandler().WriteToken(token);
        var refresh = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
        return (access, refresh);
    }

    private static async Task RegistrarAcesso(AppDbContext db, Guid pid, string acao, HttpContext ctx)
    {
        await db.Database.ExecuteSqlRawAsync(@"
            INSERT INTO acessos_paciente (paciente_id, acao, ip, user_agent)
            VALUES ({0}, {1}, {2}::inet, {3})",
            pid, acao,
            ctx.Connection.RemoteIpAddress?.ToString() ?? "0.0.0.0",
            ctx.Request.Headers["User-Agent"].ToString());
    }

    private static string SHA256(string s)
    {
        using var sha = System.Security.Cryptography.SHA256.Create();
        return Convert.ToBase64String(sha.ComputeHash(Encoding.UTF8.GetBytes(s)));
    }

    private static string NomePrimeiro(string? nome)
        => string.IsNullOrWhiteSpace(nome) ? "" : nome.Trim().Split(' ')[0];

    /// <summary>
    /// E-mail de recuperação de senha do paciente (HTML + texto). Conteúdo estático,
    /// sem dado clínico — só o link de redefinição. O rodapé de segurança (CVV/SAMU)
    /// é texto fixo, não o protocolo de crise (ADR-005).
    /// </summary>
    private static (string html, string text) MontarEmailRecuperacao(string primeiroNome, string url)
    {
        var saudacao = string.IsNullOrEmpty(primeiroNome) ? "Olá," : $"Olá {primeiroNome},";

        var text = $"{saudacao}\n\n" +
            "Recebemos um pedido para redefinir a senha do seu acesso ao Cérebro Amigo.\n\n" +
            $"Para criar uma nova senha:\n{url}\n\n" +
            "O link é válido por 1 hora e é só seu — não compartilhe.\n" +
            "Se não foi você, pode ignorar este e-mail.\n\n" +
            "Em momentos difíceis: CVV 188 (24h) · SAMU 192 · pronto-socorro mais próximo.\n\n" +
            "Cérebro Amigo";

        var html = $@"<!DOCTYPE html>
<html><head><meta charset=""utf-8""></head>
<body style=""font-family:system-ui,sans-serif;background:#f5f3ff;padding:24px;color:#27272a"">
  <div style=""max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:32px"">
    <div style=""text-align:center;margin-bottom:24px"">
      <span style=""font-size:32px;color:#5b3a8e"">✦</span>
      <h1 style=""font-size:18px;color:#5b3a8e;margin:8px 0 0"">Cérebro Amigo</h1>
    </div>
    <p>{saudacao}</p>
    <p>Recebemos um pedido para redefinir a senha do seu acesso ao
       <strong>Cérebro Amigo</strong>.</p>
    <p style=""text-align:center;margin:32px 0"">
      <a href=""{url}""
         style=""display:inline-block;background:#5b3a8e;color:#fff;padding:14px 28px;
                border-radius:10px;text-decoration:none;font-weight:600"">
        Criar nova senha
      </a>
    </p>
    <p style=""font-size:13px;color:#71717a"">
      O link é válido por 1 hora e é só seu — não compartilhe.<br/>
      Se não foi você, pode ignorar este e-mail.
    </p>
    <hr style=""border:none;border-top:1px solid #e4e4e7;margin:24px 0""/>
    <p style=""font-size:12px;color:#71717a"">
      Em momentos difíceis: CVV 188 (24h) · SAMU 192 · pronto-socorro mais próximo.
    </p>
  </div>
</body></html>";

        return (html, text);
    }
}

public record SolicitarMagicLinkRequest(string Email, string Proposito);
public record EsqueciSenhaPacienteRequest(string Email);
public record MagicValidarRequest(string Token, string NovaSenha);
public record PacienteLoginRequest(string Email, string Senha);
public record TrocarSenhaRequest(string SenhaAtual, string NovaSenha);

internal record MagicLinkPacienteDto(Guid Id, string Email, string? Nome);
internal record MagicLinkRow(Guid Id, Guid PacienteId, string Proposito,
    DateTime ExpiraEm, DateTime? UsadoEm);
internal record CredencialRow(Guid PacienteId, string? SenhaHash,
    DateTime? BloqueadoAte, int FalhasSeguidas, bool SenhaTemporaria, int TokenVersion);
