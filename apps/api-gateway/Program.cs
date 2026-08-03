// =============================================================================
// Cérebro Amigo — API Gateway (.NET 10 Minimal API)
// =============================================================================
// Responsabilidades:
//   - Autenticação (JWT médico + paciente)
//   - REST CRUD transacional (pacientes, prescrições, check-ins, insights…)
//   - Proxy SSE para o orchestrator-py (conversa paciente↔IA)
//   - E-mail transacional via Resend (magic links)
//   - OpenAPI 3.1 nativo
//
// Não chama LLM. LLM é responsabilidade exclusiva de orchestrator-py e
// agents-py, via client unificado LLM_PROVIDER (vigente: Anthropic API direta
// — ADR-044; o caminho Bedrock do ADR-008 está suspenso, reativável por
// config). ANTHROPIC_API_KEY não existe neste serviço — vive apenas nos
// serviços Python (e no apps/checkup, exceção registrada no ADR-044).
//
// Runtime do portfólio público (ADR-080): Vercel + Azure Container Apps +
// Azure PostgreSQL Flexible Server. Arquivos (documentos/foto/áudio) vivem no
// Azure Blob Storage via SAS URLs (ADR-082); transcrição de áudio é Azure AI
// Speech no agents-py. Fonte: docs/CURRENT-PORTFOLIO-RUNTIME.md.
// =============================================================================

using ApiGateway.Auth;
using ApiGateway.Data;
using ApiGateway.Endpoints;
using ApiGateway.Features.Portal.Conversation;
using ApiGateway.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using System.Security.Cryptography;
using System.Text;

var builder = WebApplication.CreateBuilder(args);

// -----------------------------------------------------------------------------
// Sentry — rastreio de erros do backend. LGPD/clinical-safety regra #4: nunca PII
// em traces. SendDefaultPii=false + corpo de request desligado. Sem SENTRY_DSN no
// ambiente → SDK no-op (desligado). Só erros (TracesSampleRate=0).
// -----------------------------------------------------------------------------
builder.WebHost.UseSentry(o =>
{
    o.Dsn = builder.Configuration["SENTRY_DSN"] ?? "";
    o.Environment = builder.Configuration["APP_ENV"] ?? "production";
    o.SendDefaultPii = false;
    o.MaxRequestBodySize = Sentry.Extensibility.RequestSize.None;
    o.TracesSampleRate = 0;
});

// -----------------------------------------------------------------------------
// EF Core 10 + Npgsql
// -----------------------------------------------------------------------------
// Prioridade de connection string:
//   1. ConnectionStrings:Postgres  (dev local / appsettings)
//   2. ConnectionStrings:Default   (legado)
//   3. POSTGRES_DSN                (env var — docker-compose / Azure Container Apps)
var postgresConn =
    builder.Configuration.GetConnectionString("Postgres")
    ?? builder.Configuration.GetConnectionString("Default")
    ?? builder.Configuration["POSTGRES_DSN"]
    ?? throw new InvalidOperationException(
        "Connection string do Postgres não configurada. " +
        "Defina ConnectionStrings:Postgres, ConnectionStrings:Default ou POSTGRES_DSN.");

// T1-4: hosts RDS (*.rds.amazonaws.com — legado AWS) sobem para SSL
// Mode=VerifyFull (valida CA regional + hostname). Qualquer outro host —
// localhost/Testcontainers e o Azure PostgreSQL atual — passa intacto.
postgresConn = RdsCa.UpgradeToVerifyFull(postgresConn);

// Orçamento de conexões (ADR-043 item D, dimensionado na era RDS db.t4g.small:
// max_connections=181, soma dos pools de todos os serviços < ~178). Gateway
// capado em 40 (Npgsql default era 100); cap conservador mantido no Azure
// PostgreSQL Flexible Server atual. Override por env DB_MAX_POOL_SIZE.
{
    var maxPool = int.TryParse(builder.Configuration["DB_MAX_POOL_SIZE"], out var mp) && mp > 0
        ? mp
        : 40;
    postgresConn = new Npgsql.NpgsqlConnectionStringBuilder(postgresConn)
    {
        MaxPoolSize = maxPool,
    }.ConnectionString;
}

{
    var bootLogger = LoggerFactory.Create(b => b.AddConsole())
        .CreateLogger("Bootstrap");
    var sanitized = System.Text.RegularExpressions.Regex.Replace(
        postgresConn,
        @"(Password|password|pwd)=[^;]*",
        "$1=***");
    bootLogger.LogInformation("Postgres connection configurada: {Conn}", sanitized);
}

builder.Services.AddDbContext<AppDbContext>(opt =>
    opt.UseNpgsql(postgresConn).UseSnakeCaseNamingConvention());

// -----------------------------------------------------------------------------
// Autenticação JWT
// -----------------------------------------------------------------------------
var jwtSecret = builder.Configuration["Jwt:Secret"]
                ?? builder.Configuration["JWT_SECRET"]
                ?? throw new InvalidOperationException("Jwt:Secret / JWT_SECRET obrigatório");

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        // Mantém nomes curtos do JWT (sub, role, email, name) sem remapear para
        // URNs longos do System.Security.Claims. user.FindFirst("sub") funciona.
        options.MapInboundClaims = false;

        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = builder.Configuration["Jwt:Issuer"] ?? "cerebro-amigo",
            ValidAudiences = [
                builder.Configuration["Jwt:Audience"] ?? "dashboard",
                "portal-paciente"
            ],
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret)),
            NameClaimType = "sub",
            RoleClaimType = "role",
        };

        // T1-7: revogação de sessão por token_version. Após assinatura/lifetime válidos,
        // confere o claim `tv` contra usuarios/pacientes_credenciais.token_version e
        // rejeita o token se a senha foi trocada/redefinida desde a emissão.
        options.Events = new JwtBearerEvents
        {
            OnTokenValidated = async context =>
            {
                var principal = context.Principal;
                var tvClaim = principal?.FindFirst("tv")?.Value;
                // Token sem `tv` = emitido antes do deploy → passa (transição graciosa,
                // sem logout em massa); vira revogável no próximo login.
                if (string.IsNullOrEmpty(tvClaim)) return;
                if (!int.TryParse(tvClaim, out var tv)) { context.Fail("tv_invalido"); return; }

                var sub = principal!.FindFirst("sub")?.Value;
                var role = principal.FindFirst("role")?.Value;
                if (!Guid.TryParse(sub, out var id)) { context.Fail("sub_invalido"); return; }

                var sp = context.HttpContext.RequestServices;
                var db = sp.GetRequiredService<AppDbContext>();
                try
                {
                    var atual = role == "paciente"
                        ? await db.Database.ExecuteScalarAsync<int?>(
                            "SELECT token_version FROM pacientes_credenciais WHERE paciente_id = {0}", id)
                        : await db.Database.ExecuteScalarAsync<int?>(
                            "SELECT token_version FROM usuarios WHERE id = {0}", id);
                    // atual == null: credencial inexistente (ex.: paciente sem senha) → sem revogação aplicável.
                    if (atual is not null && atual.Value != tv)
                        context.Fail("sessao_revogada");
                }
                catch (Exception ex)
                {
                    // Fail-open: um hiccup do DB não derruba todas as sessões. A request real
                    // depende do DB e falhará no endpoint se ele estiver fora.
                    sp.GetRequiredService<ILoggerFactory>()
                      .CreateLogger("Auth.TokenVersion")
                      .LogWarning(ex, "token_version check falhou (fail-open)");
                }
            }
        };
    });

builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("paciente", policy =>
        policy.RequireClaim("role", "paciente"));

    // Policy para endpoints chamados por serviços internos (Python → .NET).
    // Valida header: Authorization: Bearer ${INTERNAL_API_TOKEN}
    options.AddPolicy("internal", policy =>
        policy.RequireAssertion(ctx =>
        {
            var cfg = ctx.Resource as HttpContext
                ?? throw new InvalidOperationException();
            var token = cfg.Request.Headers["Authorization"]
                .ToString().Replace("Bearer ", "").Trim();
            var expected = builder.Configuration["INTERNAL_API_TOKEN"] ?? "";
            // Comparação constante-time (timing-attack safe) via CryptographicOperations
            return !string.IsNullOrEmpty(expected)
                && CryptographicOperations.FixedTimeEquals(
                    System.Text.Encoding.UTF8.GetBytes(token),
                    System.Text.Encoding.UTF8.GetBytes(expected));
        }));

    // Admin master (#1 = dono da plataforma, role='owner').
    // Gerado pelo seed original (role='admin') e promovido via migration 0010.
    options.AddPolicy("owner", policy =>
        policy.RequireClaim("role", "owner"));

    // Admins gerais + owner: acesso de leitura ao painel admin.
    options.AddPolicy("admin_geral", policy =>
        policy.RequireAssertion(ctx =>
            ctx.User.HasClaim("role", "owner") || ctx.User.HasClaim("role", "admin")));

    // Médico (dashboard clínico). Usada por MensagensAudioEndpoints (ADR-064) e conta;
    // estava ausente → RequireAuthorization("medico") lançava em runtime. owner/admin
    // entram também (master). O escopo de dado real continua via GetMedicoIdAsync.
    options.AddPolicy("medico", policy =>
        policy.RequireAssertion(ctx =>
            ctx.User.HasClaim("role", "medico")
            || ctx.User.HasClaim("role", "owner")
            || ctx.User.HasClaim("role", "admin")));
});

// -----------------------------------------------------------------------------
// CORS para o frontend Next.js
// -----------------------------------------------------------------------------
builder.Services.AddCors(options =>
{
    options.AddPolicy("dashboard", policy =>
    {
        var origens = builder.Configuration.GetSection("Cors:Origins").Get<string[]>()
                      ?? ["http://localhost:3000"];
        policy.WithOrigins(origens)
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials();
    });
});

// -----------------------------------------------------------------------------
// Serviços de domínio
// -----------------------------------------------------------------------------
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<TokenService>();
builder.Services.AddScoped<MedicoOnboardingService>();
builder.Services.AddSingleton<IPasswordHasher, PasswordHasher>();
// NpgsqlDataSource dedicado (fora do EF) p/ o rate limiter de login (T1-1):
// singleton, conexão sob demanda, mesma connection string (já com verify-full).
builder.Services.AddSingleton(_ => Npgsql.NpgsqlDataSource.Create(postgresConn));
builder.Services.AddSingleton<LoginRateLimiter>();
builder.Services.AddSingleton<CryptoService>();
builder.Services.AddScoped<ITenantContext, TenantContext>();

// Teleconsulta (vídeo P2P): credencial TURN efêmera + relay de sinalização
// em memória (singleton — pareia os 2 peers por consulta_id). Não trafega
// mídia nem persiste sinalização (SDP/ICE têm IP = PII).
builder.Services.AddSingleton<TurnCredentialService>();
builder.Services.AddSingleton<TeleconsultaSignalingHub>();

builder.Services.AddMemoryCache();

// HTTP clients
builder.Services.AddHttpClient(); // factory genérico

builder.Services.AddHttpClient<ResendClient>()
    .AddStandardResilienceHandler();

builder.Services.AddHttpClient<MemedClient>()
    .AddStandardResilienceHandler();

// CfmClient: SEM StandardResilienceHandler — o scrape do CFM pela Infosimples
// leva até ~60s (o total-timeout padrão de 30s mataria). Retries MANUAIS (3x, 1s)
// controlados no CfmClient — o StandardResilienceHandler duplicaria chamadas PAGAS.
builder.Services.AddHttpClient<CfmClient>();

// TurnstileVerifier: anti-abuso do signup público de médico (ADR-055). SEM resilience
// handler — o token do Turnstile é single-use (retry com o mesmo token reprovaria).
// Flag-gated por TURNSTILE_SECRET_KEY; timeout curto definido no próprio serviço.
builder.Services.AddHttpClient<TurnstileVerifier>();

// AsaasClient: SEM StandardResilienceHandler — retry automático em POST /payments
// criaria COBRANÇA DUPLICADA (mesmo motivo do CfmClient). Idempotência fica a
// cargo do fluxo (1 cobrança por chamada do médico).
builder.Services.AddHttpClient<AsaasClient>();

// AsaasReconcileService: reconciliação agendada DETECT-ONLY (ADR-055 Fase E) — loga
// divergência local×Asaas (webhook perdido) sem escrever em `assinaturas`. Gate:
// ASAAS_API_KEY setada + ASAAS_RECONCILE_INTERVAL_HORAS > 0 (default 24h).
builder.Services.AddHostedService<AsaasReconcileService>();

// OrchestratorStreamClient — proxy SSE para o orchestrator-py
builder.Services.AddOrchestratorStreamClient(builder.Configuration);

// HttpClient nomeado para agents-py (chamadas on-demand de agentes)
builder.Services.AddHttpClient("agents-py", client =>
{
    var url = builder.Configuration["AGENTS_PY_URL"] ?? "http://agents-py:8082";
    client.BaseAddress = new Uri(url);
    // Diário de voz: agents-py espera o Azure Speech até transcribe_timeout_s
    // (120s) + chamada Claude. Gateway precisa esperar mais que isso, senão aborta
    // a transcrição no meio. Margem para o Claude por cima dos 120s.
    client.Timeout = TimeSpan.FromSeconds(150);
});

// HttpClient dedicado ao worker do Escriba presencial (ADR-075): transcrição
// assíncrona de consulta longa pode levar minutos → timeout folgado. Roda em
// background (não segura request de usuário), por isso é separado do "agents-py".
builder.Services.AddHttpClient("agents-py-escriba", client =>
{
    var url = builder.Configuration["AGENTS_PY_URL"] ?? "http://agents-py:8082";
    client.BaseAddress = new Uri(url);
    client.Timeout = TimeSpan.FromSeconds(600);
});

// Fila in-process + worker da transcrição assíncrona do Escriba presencial (ADR-075).
builder.Services.AddSingleton<EscribaJobQueue>();
builder.Services.AddHostedService<EscribaJobWorker>();

// -----------------------------------------------------------------------------
// OpenAPI 3.1 (nativo no .NET 10)
// -----------------------------------------------------------------------------
builder.Services.AddSignalR();

// Azure Blob Storage (ADR-082) — SAS URLs das features de arquivo (o binário
// nunca passa pelo gateway): cofre de documentos e foto do médico
// (BLOB_CONTAINER_MEDICO_DOCS), áudio de mensagens do paciente
// (BLOB_CONTAINER_AUDIO_MSGS) e áudio efêmero do escriba (BLOB_CONTAINER_AUDIO).
// Lazy: sem AZURE_STORAGE_CONNECTION_STRING os endpoints de arquivo falham
// isolados, sem afetar o resto do gateway.
builder.Services.AddSingleton<BlobStoragePresigner>();

builder.Services.AddOpenApi("v1", options =>
{
    options.AddDocumentTransformer((document, _, _) =>
    {
        document.Info.Title = "Cérebro Amigo — API Gateway";
        document.Info.Version = "v1";
        document.Info.Description = "API transacional do Cérebro Amigo V3. Não chama LLM.";
        return Task.CompletedTask;
    });
});

// -----------------------------------------------------------------------------
// Build e pipeline
// -----------------------------------------------------------------------------
var app = builder.Build();

app.MapOpenApi();

if (app.Environment.IsDevelopment())
    app.MapGet("/", () => Results.Redirect("/openapi/v1.json"));

// -----------------------------------------------------------------------------
// Tratamento global de exceção
// -----------------------------------------------------------------------------
// `EXPOSE_ERROR_DETAILS=true` inclui mensagem e tipo no body — útil em dev,
// mas vaza implementação em prod. Use o trace_id para correlacionar logs.
app.UseExceptionHandler(errorApp =>
{
    errorApp.Run(async context =>
    {
        var feature = context.Features.Get<Microsoft.AspNetCore.Diagnostics.IExceptionHandlerFeature>();
        var ex = feature?.Error;
        var logger = context.RequestServices.GetRequiredService<ILoggerFactory>()
            .CreateLogger("GlobalExceptionHandler");

        var traceId = context.TraceIdentifier;
        logger.LogError(ex,
            "Exceção não tratada em {Method} {Path} (trace {TraceId})",
            context.Request.Method, context.Request.Path, traceId);

        context.Response.StatusCode = StatusCodes.Status500InternalServerError;
        context.Response.ContentType = "application/json";

        var exposeDetails = string.Equals(
            builder.Configuration["EXPOSE_ERROR_DETAILS"], "true",
            StringComparison.OrdinalIgnoreCase);

        var payload = exposeDetails
            ? new
            {
                error = "internal_server_error",
                message = ex?.Message,
                type = ex?.GetType().FullName,
                trace_id = traceId,
            }
            : (object)new
            {
                error = "internal_server_error",
                trace_id = traceId,
            };

        await context.Response.WriteAsJsonAsync(payload);
    });
});

app.UseCors("dashboard");

// -----------------------------------------------------------------------------
// Edge origin auth (ADR-074) — autenticação de ORIGEM, acima do JWT/INTERNAL_API_TOKEN.
// Quando EDGE_AUTH_SECRET está configurado, todo request exige o header
// `X-Edge-Auth: <secret>`, provando que o caller é a nossa origem (o BFF na Vercel).
// O egress da Vercel não tem IP fixo p/ allowlist no ALB → a origem é provada por
// segredo compartilhado. FLAG-GATED: sem a env é no-op (não afeta o web-no-EC2 atual
// nem o dev). Roda antes da authn p/ barrar randoms cedo, fail-closed 403.
// Exemções = callers públicos legítimos que NÃO passam pelo BFF: health/ready
// (ALB+uptime), webhook do Asaas (auth própria por ASAAS_WEBHOOK_TOKEN), OpenAPI,
// e o preflight CORS. Chamadas internas (workers Python → gateway) passam pelo
// bypass do INTERNAL_API_TOKEN. Links de e-mail (magic-link, unsubscribe, reset)
// apontam pro domínio do web (FRONTEND_URL/PORTAL_PACIENTE_URL) e chegam ao gateway
// via BFF → carregam o header, não precisam de exemção. Novo webhook público direto
// no gateway PRECISA entrar nesta lista antes de habilitar o segredo.
// -----------------------------------------------------------------------------
var edgeAuthSecret = app.Configuration["EDGE_AUTH_SECRET"];
if (!string.IsNullOrEmpty(edgeAuthSecret))
{
    var edgeBytes = System.Text.Encoding.UTF8.GetBytes(edgeAuthSecret);
    // Rotação zero-downtime: durante a janela, o valor anterior também é aceito,
    // então dá p/ trocar o segredo no web e no gateway sem 403 no meio.
    var edgeAuthPrevious = app.Configuration["EDGE_AUTH_SECRET_PREVIOUS"];
    var edgePrevBytes = string.IsNullOrEmpty(edgeAuthPrevious)
        ? null : System.Text.Encoding.UTF8.GetBytes(edgeAuthPrevious);
    var internalApiToken = app.Configuration["INTERNAL_API_TOKEN"] ?? "";
    var internalBytes = System.Text.Encoding.UTF8.GetBytes(internalApiToken);

    app.Use(async (context, next) =>
    {
        var req = context.Request;
        var exempt =
            HttpMethods.IsOptions(req.Method)
            || req.Path.StartsWithSegments("/health")
            || req.Path.StartsWithSegments("/ready")
            || req.Path.StartsWithSegments("/openapi")
            || req.Path.StartsWithSegments("/api/v1/asaas/webhook");

        if (!exempt)
        {
            // Comparação constante-time (timing-safe), espelhando a policy "internal".
            var provided = req.Headers["X-Edge-Auth"].ToString();
            var providedBytes = System.Text.Encoding.UTF8.GetBytes(provided);
            var okEdge = provided.Length > 0
                && (CryptographicOperations.FixedTimeEquals(providedBytes, edgeBytes)
                    || (edgePrevBytes is not null
                        && CryptographicOperations.FixedTimeEquals(providedBytes, edgePrevBytes)));

            // Bypass das chamadas internas (workers Python) que já se autenticam
            // com Bearer ${INTERNAL_API_TOKEN}. O BFF usa JWT do usuário (não este
            // token) → o BFF depende do X-Edge-Auth, como desejado.
            var okInternal = false;
            if (!okEdge && internalApiToken.Length > 0)
            {
                var auth = req.Headers.Authorization.ToString();
                if (auth.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
                {
                    var bearer = auth["Bearer ".Length..].Trim();
                    okInternal = bearer.Length > 0
                        && CryptographicOperations.FixedTimeEquals(
                            System.Text.Encoding.UTF8.GetBytes(bearer), internalBytes);
                }
            }

            if (!okEdge && !okInternal)
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                context.Response.ContentType = "application/json";
                await context.Response.WriteAsJsonAsync(new { error = "edge_auth_required" });
                return;
            }
        }

        await next();
    });
}

app.UseAuthentication();
app.UseAuthorization();

// Tenant na conexão p/ a RLS (0037). Depois da auth (precisa do ctx.User),
// antes dos endpoints. Anônimo passa direto (endpoints anônimos não tocam
// tabela com RLS).
app.UseMiddleware<ApiGateway.Auth.TenantSessionMiddleware>();

// Liveness e readiness
app.MapGet("/health", () => Results.Ok(new { status = "ok" })).AllowAnonymous();
app.MapGet("/ready", async (AppDbContext db) =>
{
    try
    {
        await db.Database.CanConnectAsync();
        return Results.Ok(new { status = "ready" });
    }
    catch
    {
        return Results.StatusCode(503);
    }
}).AllowAnonymous();

// Endpoints
AuthEndpoints.Map(app);
NewsletterEndpoints.Map(app); // ADR-065: newsletter do médico (inscrição/unsub; free tier)
AgentesEndpoints.Map(app);
PacientesPsiqEndpoints.Map(app);
PrescricoesEndpoints.Map(app);
MemedEndpoints.Map(app);
MedicamentosEndpoints.Map(app);
MedicacoesEmUsoEndpoints.Map(app);
NotificacoesEndpoints.Map(app);
PacienteAuthEndpoints.Map(app);
PortalPacienteEndpoints.Map(app);
PortalAgendaEndpoints.Map(app);
app.MapPortalConversation();
CheckinsEndpoints.Map(app);
EscalasEndpoints.Map(app);
ExamesEndpoints.Map(app);
RenovacoesEndpoints.Map(app);
InteracoesEndpoints.Map(app);
InteracoesCoberturaEndpoints.Map(app);
CobrancasEndpoints.Map(app);
BlindagemEndpoints.Map(app);
RoiEndpoints.Map(app);
RagEndpoints.Map(app);
InsightsEndpoints.Map(app);
ConsultasEndpoints.Map(app);
TeleconsultaEndpoints.Map(app);
EscribaEndpoints.Map(app);
CriseEndpoints.Map(app);
FilaAtencaoEndpoints.Map(app);
EvolucaoEndpoints.Map(app);
CondutasEndpoints.Map(app);
ConfigEndpoints.Map(app);
EscalacaoEndpoints.Map(app);
ComunicacaoEndpoints.Map(app);
MensagensEndpoints.Map(app);
app.MapMensagensAudio();
app.MapMedicoDocumentos();
ContaEndpoints.Map(app);
PromptsEndpoints.Map(app);
AdminEndpoints.Map(app);
SeedEndpoint.Map(app);

app.Run();

// Expõe a classe Program (top-level statements) para WebApplicationFactory<Program>
// nos testes de integração (apps/api-gateway-tests). Sem efeito em runtime.
public partial class Program { }
