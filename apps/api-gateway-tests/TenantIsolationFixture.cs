using System.IdentityModel.Tokens.Jwt;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.IdentityModel.Tokens;
using Npgsql;
using Testcontainers.PostgreSql;
using Xunit;

namespace ApiGateway.Tests;

/// <summary>
/// Sobe um Postgres real (com pgvector), aplica TODAS as migrations de
/// infra/migrations e seeda dois médicos (tenants) com um paciente cada, mais
/// dados clínicos do paciente do médico B. Expõe o gateway via
/// WebApplicationFactory e helpers para mintar JWT de médico e consultar o banco.
///
/// O objetivo é provar o ISOLAMENTO DE TENANT: médico A nunca lê/altera dado do
/// paciente do médico B. Foi exatamente o modo de falha dos 7 IDOR de 2026-06-08.
/// </summary>
public sealed class TenantIsolationFixture : IAsyncLifetime
{
    // pgvector/pgvector traz vector + uuid-ossp + pgcrypto (migration 0001 exige).
    private readonly PostgreSqlContainer _pg = new PostgreSqlBuilder()
        .WithImage("pgvector/pgvector:pg16")
        .WithDatabase("cerebro_v3_test")
        .Build();

    public const string JwtSecret = "test-secret-tenant-isolation-0123456789-abcdefghij";
    public const string InternalToken = "test-internal-token";
    public const string AsaasWebhookToken = "test-asaas-webhook-token";

    private WebApplicationFactory<Program> _factory = default!;
    // Conexão de admin (superuser do container) — migrations, seed e asserts.
    public string ConnectionString { get; private set; } = "";
    // Conexão que o GATEWAY usa: role restrito (NOBYPASSRLS) p/ a RLS valer.
    public string GatewayConnectionString { get; private set; } = "";
    private const string GwRolePassword = "gw_test_pw";

    // ── IDs seedados (preenchidos no InitializeAsync) ──
    public Guid UsuarioA { get; } = Guid.NewGuid();
    public Guid UsuarioB { get; } = Guid.NewGuid();
    public Guid MedicoA { get; } = Guid.NewGuid();
    public Guid MedicoB { get; } = Guid.NewGuid();
    public Guid PacienteA { get; } = Guid.NewGuid(); // cliente_id do paciente do médico A
    public Guid PacienteB { get; } = Guid.NewGuid(); // cliente_id do paciente do médico B
    public string PacienteBEmail { get; } = "paciente.b@example.com";

    public Guid PrescricaoB { get; } = Guid.NewGuid();   // prescrição ATIVA do paciente B
    public Guid PrescricaoA { get; } = Guid.NewGuid();   // prescrição do paciente A (controle +)
    public Guid NotificacaoB { get; } = Guid.NewGuid();  // notificação do médico B

    // ── Iteração 2 (0038): conversa/mensagem + trilhas que faltavam ──
    public Guid ConversaB { get; } = Guid.NewGuid();     // conversa do paciente B (2-hop por cliente_id)
    public Guid ConversaA { get; } = Guid.NewGuid();     // conversa do paciente A (controle +)

    // ── Cofre de documentos (ADR-066/0052): tenant direto por medico_id ──
    public Guid DocB { get; } = Guid.NewGuid();          // documento do médico B (alvo do ataque)
    public Guid DocA { get; } = Guid.NewGuid();          // documento do médico A (controle +)

    public async Task InitializeAsync()
    {
        await _pg.StartAsync();
        ConnectionString = _pg.GetConnectionString();

        await ApplyMigrationsAsync();
        await SeedAsync();
        await CreateRestrictedGatewayRoleAsync();

        // Override via env vars (separador __): prioridade acima de appsettings e,
        // com ambiente "Testing", os user-secrets (Development-only) não carregam.
        // ConfigureAppConfiguration no WebApplicationFactory não vencia o appsettings.
        // O gateway conecta como gw_test (NOBYPASSRLS) → a RLS da 0037 VALE.
        Environment.SetEnvironmentVariable("ConnectionStrings__Postgres", GatewayConnectionString);
        Environment.SetEnvironmentVariable("Jwt__Secret", JwtSecret);
        Environment.SetEnvironmentVariable("Jwt__Issuer", "cerebro-amigo");
        Environment.SetEnvironmentVariable("Jwt__Audience", "dashboard");
        Environment.SetEnvironmentVariable("INTERNAL_API_TOKEN", InternalToken);
        Environment.SetEnvironmentVariable("ASAAS_WEBHOOK_TOKEN", AsaasWebhookToken);
        Environment.SetEnvironmentVariable("EXPOSE_ERROR_DETAILS", "true");
        // RESEND_API_KEY: o POST /pacientes injeta ResendClient (resolvido pelo DI ANTES
        // do handler); sem a key o app estoura 500 antes mesmo do cap/validação rodarem.
        // Key dummy só p/ construir o client — os testes retornam (cap/validação/403/400)
        // antes de qualquer SendAsync, então nenhum e-mail é realmente enviado. O ctor do
        // ResendClient exige RESEND_API_KEY E EMAIL_FROM; sem qualquer um → 500.
        Environment.SetEnvironmentVariable("RESEND_API_KEY", "test-resend-key");
        Environment.SetEnvironmentVariable("EMAIL_FROM", "Cérebro Amigo CI <ci@example.com>");

        _factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder => builder.UseEnvironment("Testing"));
    }

    public async Task DisposeAsync()
    {
        _factory?.Dispose();
        await _pg.DisposeAsync();
    }

    // Factory base (p/ testes que precisam derivar com ConfigureTestServices, ex.:
    // stubar o handler HTTP do ResendClient e não enviar e-mail de verdade).
    public WebApplicationFactory<Program> Factory => _factory;

    // JWT de médico cru (p/ clientes criados a partir de um factory derivado).
    public string TokenForMedico(Guid usuarioId) => MintToken(usuarioId, "medico");

    // ── HttpClient autenticado como um médico (JWT no formato do TokenService) ──
    public HttpClient ClientForMedico(Guid usuarioId) => ClientForRole("medico", usuarioId);

    // HttpClient autenticado com role arbitrário (owner/admin/medico) — T0-6/ADR-068.
    public HttpClient ClientForRole(string role, Guid? sub = null)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", MintToken(sub ?? Guid.NewGuid(), role));
        return client;
    }

    // T1-7: médico/paciente com (ou sem) o claim `tv` de versão de sessão.
    public HttpClient ClientForMedicoTv(Guid usuarioId, int? tv)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", MintToken(usuarioId, "medico", tv, "dashboard"));
        return client;
    }

    public HttpClient ClientForPacienteTv(Guid pacienteId, int? tv)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", MintToken(pacienteId, "paciente", tv, "portal-paciente"));
        return client;
    }

    private static string MintToken(Guid sub, string role, int? tv = null, string audience = "dashboard")
    {
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(JwtSecret));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, sub.ToString()),
            new("role", role),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
        };
        if (tv is not null) claims.Add(new Claim("tv", tv.Value.ToString()));  // T1-7
        var token = new JwtSecurityToken(
            issuer: "cerebro-amigo",
            audience: audience,
            claims: claims,
            expires: DateTime.UtcNow.AddHours(1),
            signingCredentials: creds);
        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    // Cliente HTTP SEM autenticação (p/ endpoints anônimos, ex.: unsubscribe da newsletter).
    public HttpClient AnonClient() => _factory.CreateClient();

    // Service provider do host de teste (p/ introspecção de EndpointDataSource — ADR-065 R2).
    public IServiceProvider Services => _factory.Services;

    public async Task<NpgsqlConnection> OpenDbAsync()
    {
        var conn = new NpgsqlConnection(ConnectionString);
        await conn.OpenAsync();
        return conn;
    }

    /// <summary>Abre conexão como o role restrito do gateway (RLS VALE aqui).</summary>
    public async Task<NpgsqlConnection> OpenGatewayDbAsync()
    {
        var conn = new NpgsqlConnection(GatewayConnectionString);
        await conn.OpenAsync();
        return conn;
    }

    // Cria gw_test (NOSUPERUSER, NOBYPASSRLS) + grants. Espelha cerebro_gateway de
    // prod (0036): a RLS da 0037 só filtra um role não-dono e sem BYPASSRLS.
    private async Task CreateRestrictedGatewayRoleAsync()
    {
        await using var conn = new NpgsqlConnection(ConnectionString);
        await conn.OpenAsync();
        await using (var cmd = new NpgsqlCommand($@"
            DROP ROLE IF EXISTS gw_test;
            CREATE ROLE gw_test LOGIN PASSWORD '{GwRolePassword}' NOSUPERUSER NOBYPASSRLS;
            GRANT USAGE ON SCHEMA public TO gw_test;
            GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gw_test;
            GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gw_test;", conn))
        {
            await cmd.ExecuteNonQueryAsync();
        }

        GatewayConnectionString = new NpgsqlConnectionStringBuilder(ConnectionString)
        {
            Username = "gw_test",
            Password = GwRolePassword,
        }.ToString();
    }

    // ── Aplica infra/migrations/0*.sql em ordem ──
    private async Task ApplyMigrationsAsync()
    {
        var dir = FindMigrationsDir();
        var files = Directory.GetFiles(dir, "0*.sql")
            // 0036 cria roles/grants de infra referenciando o dono de PROD
            // (cerebroadmin), que não existe no container. É ortogonal ao schema
            // que os testes exercitam — os testes rodam como superuser do container.
            .Where(f => !Path.GetFileName(f).Contains("least_privilege_roles"))
            .OrderBy(f => f).ToArray();
        await using var conn = new NpgsqlConnection(ConnectionString);
        await conn.OpenAsync();

        // Migrations recentes (ex.: 0050) fazem GRANT a cerebro_gateway/cerebro_workers —
        // roles criados em PROD pela 0036 (que o fixture pula). Cria stubs idempotentes só
        // p/ os GRANTs não falharem; as conexões de teste usam superuser + gw_test (depois).
        await using (var roleCmd = new NpgsqlCommand(@"
            DO $$ BEGIN
              IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='cerebro_gateway') THEN CREATE ROLE cerebro_gateway NOLOGIN; END IF;
              IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='cerebro_workers') THEN CREATE ROLE cerebro_workers NOLOGIN; END IF;
            END $$;", conn))
        {
            await roleCmd.ExecuteNonQueryAsync();
        }

        foreach (var file in files)
        {
            var sql = await File.ReadAllTextAsync(file);
            await using var cmd = new NpgsqlCommand(sql, conn);
            try { await cmd.ExecuteNonQueryAsync(); }
            catch (Exception ex)
            {
                throw new InvalidOperationException(
                    $"Falha ao aplicar migration {Path.GetFileName(file)}: {ex.Message}", ex);
            }
        }
    }

    private static string FindMigrationsDir()
    {
        var d = new DirectoryInfo(AppContext.BaseDirectory);
        while (d is not null)
        {
            var candidate = Path.Combine(d.FullName, "infra", "migrations");
            if (Directory.Exists(candidate)) return candidate;
            d = d.Parent;
        }
        throw new DirectoryNotFoundException(
            "Não encontrei infra/migrations subindo a partir de " + AppContext.BaseDirectory);
    }

    // ── Seed: 2 tenants + dados clínicos do paciente B + controle do paciente A ──
    private async Task SeedAsync()
    {
        await using var conn = new NpgsqlConnection(ConnectionString);
        await conn.OpenAsync();

        async Task Exec(string sql, params object[] p)
        {
            await using var cmd = new NpgsqlCommand(sql, conn);
            for (var i = 0; i < p.Length; i++)
                cmd.Parameters.AddWithValue("p" + i, p[i]);
            await cmd.ExecuteNonQueryAsync();
        }

        // usuarios (role medico) + medicos
        await Exec(@"INSERT INTO usuarios (id, email, senha_hash, nome, role)
                     VALUES (@p0,'medico.a@example.com','x','Médico A','medico'),
                            (@p1,'medico.b@example.com','x','Médico B','medico')",
            UsuarioA, UsuarioB);
        await Exec(@"INSERT INTO medicos (id, usuario_id, nome, crm)
                     VALUES (@p0,@p1,'Médico A','CRM-A'),
                            (@p2,@p3,'Médico B','CRM-B')",
            MedicoA, UsuarioA, MedicoB, UsuarioB);

        // clientes + pacientes (1 por médico)
        await Exec(@"INSERT INTO clientes (id, email, nome)
                     VALUES (@p0,'paciente.a@example.com','Paciente A'),
                            (@p1,@p2,'Paciente B')",
            PacienteA, PacienteB, PacienteBEmail);
        await Exec(@"INSERT INTO pacientes (cliente_id, medico_responsavel_id)
                     VALUES (@p0,@p1),(@p2,@p3)",
            PacienteA, MedicoA, PacienteB, MedicoB);

        // prescrições: B (alvo do ataque) e A (controle positivo)
        await Exec(@"INSERT INTO prescricoes (id, paciente_id, medico_id, medicamento, dose_descricao, ativa)
                     VALUES (@p0,@p1,@p2,'Sertralina 50mg','1x ao dia',TRUE)",
            PrescricaoB, PacienteB, MedicoB);
        await Exec(@"INSERT INTO prescricoes (id, paciente_id, medico_id, medicamento, dose_descricao, ativa)
                     VALUES (@p0,@p1,@p2,'Escitalopram 10mg','1x ao dia',TRUE)",
            PrescricaoA, PacienteA, MedicoA);

        // evento de prescrição do paciente B (alvo do GET historico cross-tenant)
        await Exec(@"INSERT INTO prescricao_eventos (paciente_id, medico_id, prescricao_id, tipo, medicamento)
                     VALUES (@p0,@p1,@p2,'adicao','Sertralina 50mg')",
            PacienteB, MedicoB, PrescricaoB);

        // notificação do médico B (alvo do marcar-lida cross-tenant)
        await Exec(@"INSERT INTO notificacoes_medico (id, medico_id, paciente_id, severidade, tipo, titulo, mensagem, lida)
                     VALUES (@p0,@p1,@p2,'critico','crise','Alerta','Paciente B em risco',FALSE)",
            NotificacaoB, MedicoB, PacienteB);

        // ── Iteração 2 (0038) ──
        // conversa do paciente B (2-hop via cliente_id) + do A (controle +), com
        // uma mensagem cada (3-hop via conversa_id). O conteúdo de B é o alvo.
        await Exec(@"INSERT INTO conversas (id, cliente_id, status)
                     VALUES (@p0,@p1,'aberta'),(@p2,@p3,'aberta')",
            ConversaB, PacienteB, ConversaA, PacienteA);
        await Exec(@"INSERT INTO mensagens (conversa_id, papel, conteudo)
                     VALUES (@p0,'user','Mensagem secreta de B'),
                            (@p1,'user','Mensagem de A')",
            ConversaB, ConversaA);

        // crise_alerta_eventos do médico B (tenant direto por medico_id; precisa do
        // protocolo pai). É o leak que a 0038 fecha: alerta de crise entre tenants.
        var protocoloB = Guid.NewGuid();
        await Exec(@"INSERT INTO protocolos_crise_acionados (id, paciente_id, medico_id, gatilho)
                     VALUES (@p0,@p1,@p2,'ideacao')",
            protocoloB, PacienteB, MedicoB);
        await Exec(@"INSERT INTO crise_alerta_eventos (protocolo_id, medico_id, canal, evento)
                     VALUES (@p0,@p1,'email','enviado')",
            protocoloB, MedicoB);

        // condutas_eventos do médico B (paciente_id 1-hop; precisa da conduta pai)
        var condutaB = Guid.NewGuid();
        await Exec(@"INSERT INTO condutas_automacao (id, paciente_id, medico_id, tipo)
                     VALUES (@p0,@p1,@p2,'checkin_humor')",
            condutaB, PacienteB, MedicoB);
        await Exec(@"INSERT INTO condutas_eventos (conduta_id, paciente_id, medico_id, acao)
                     VALUES (@p0,@p1,@p2,'configurada')",
            condutaB, PacienteB, MedicoB);

        // receitas_memed do médico B (paciente_id 1-hop)
        await Exec(@"INSERT INTO receitas_memed (paciente_id, medico_id, memed_prescricao_id)
                     VALUES (@p0,@p1,'memed-b-1')",
            PacienteB, MedicoB);

        // acesso ao prontuário do paciente B pelo médico B (tenant direto por medico_id)
        await Exec(@"INSERT INTO acessos_prontuario (medico_id, paciente_id, recurso)
                     VALUES (@p0,@p1,'timeline')",
            MedicoB, PacienteB);

        // cofre de documentos (ADR-066/0052): doc do médico B (alvo) + do A (controle +).
        await Exec(@"INSERT INTO medico_documentos (id, medico_id, direcao, tipo, titulo, s3_key)
                     VALUES (@p0,@p1,'enviado','contrato','Doc secreto de B','medico/b/enviado/b.pdf'),
                            (@p2,@p3,'enviado','contrato','Doc de A','medico/a/enviado/a.pdf')",
            DocB, MedicoB, DocA, MedicoA);
    }
}

[CollectionDefinition("tenant")]
public sealed class TenantCollection : ICollectionFixture<TenantIsolationFixture> { }
