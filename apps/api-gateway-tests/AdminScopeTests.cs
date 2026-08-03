using System.Net;
using Npgsql;
using Xunit;

namespace ApiGateway.Tests;

/// <summary>
/// T0-6 / ADR-068 — escopo admin_financeiro. Defesa em profundidade, duas camadas:
///
///  (1) AUTHZ dos endpoints: role=admin recebe 403 nos endpoints que tocam dado
///      CLÍNICO ou poder de plataforma (owner-only); 200 nos administrativos/financeiros.
///      owner = 200 nos clínicos (controle positivo).
///  (2) DATA-LAYER (RLS): conexão do gateway SEM app.tenant_bypass — exatamente o que o
///      TenantSessionMiddleware deixa para role=admin — é fail-closed nas tabelas clínicas
///      e lê as administrativas (sem RLS).
///
/// Fecha o vazamento do T0-6: admin de suporte/financeiro NÃO enxerga conteúdo clínico
/// de tenant nenhum (categoria especial LGPD; clinical-safety regra #3 — minimização).
/// Regressão clássica que isto pega: alguém re-adiciona "admin" ao bypass do middleware,
/// ou tira o RequireAuthorization("owner") de um endpoint clínico.
/// </summary>
[Collection("tenant")]
public class AdminScopeTests(TenantIsolationFixture fx)
{
    // Endpoints owner-only que tocam clínico / poder de plataforma (T0-6/ADR-068).
    // Prompts e Agentes (editor de prompts) usam o MESMO gate de grupo .RequireAuthorization
    // ("owner") — a mecânica é provada aqui pelo /admin/interacoes/cobertura (gate de grupo).
    public static readonly string[] ClinicosOwnerOnly =
    {
        "/api/v1/admin/metricas",
        "/api/v1/admin/crises",
        "/api/v1/admin/acessos",
        "/api/v1/admin/interacoes/cobertura",
    };

    // ── Camada 1: autorização ────────────────────────────────────────────────

    [Fact]
    public async Task Admin_403_NosEndpointsClinicos()
    {
        var admin = fx.ClientForRole("admin");
        foreach (var rota in ClinicosOwnerOnly)
            Assert.Equal(HttpStatusCode.Forbidden, (await admin.GetAsync(rota)).StatusCode);

        // Drill-down 360º do médico (rota com {id}) — também owner-only.
        Assert.Equal(HttpStatusCode.Forbidden,
            (await admin.GetAsync($"/api/v1/admin/medicos/{fx.MedicoB}")).StatusCode);
    }

    [Fact]
    public async Task Admin_200_NosEndpointsFinanceiros()
    {
        var admin = fx.ClientForRole("admin");
        // admin_financeiro PRECISA do billing (admin_geral; tabelas sem RLS).
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync("/api/v1/admin/assinaturas")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync("/api/v1/admin/cockpit")).StatusCode);
    }

    [Fact]
    public async Task Owner_200_NosEndpointsClinicos()
    {
        var owner = fx.ClientForRole("owner");
        Assert.Equal(HttpStatusCode.OK, (await owner.GetAsync("/api/v1/admin/metricas")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await owner.GetAsync("/api/v1/admin/crises")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await owner.GetAsync("/api/v1/admin/acessos")).StatusCode);
        Assert.Equal(HttpStatusCode.OK,
            (await owner.GetAsync($"/api/v1/admin/medicos/{fx.MedicoB}")).StatusCode);
    }

    // ── Camada 2: garantia no data-layer (RLS) ───────────────────────────────

    [Fact]
    public async Task AdminFinanceiro_SemBypass_FailClosedClinico_LeAdministrativo()
    {
        // Médico/assinatura descartáveis (IDs próprios) só para provar que a tabela
        // administrativa é legível — isolado dos tenants A/B do fixture compartilhado.
        var usuarioId = Guid.NewGuid();
        var medicoId = Guid.NewGuid();
        await using (var sup = await fx.OpenDbAsync())
        {
            async Task Exec(string sql, params (string, object)[] ps)
            {
                await using var c = new NpgsqlCommand(sql, sup);
                foreach (var (n, v) in ps) c.Parameters.AddWithValue(n, v);
                await c.ExecuteNonQueryAsync();
            }
            await Exec("INSERT INTO usuarios (id,email,senha_hash,nome,role) VALUES (@u,@e,'x','Fin Throwaway','medico')",
                ("u", usuarioId), ("e", $"fin-{usuarioId}@example.com"));
            await Exec("INSERT INTO medicos (id,usuario_id,nome,crm) VALUES (@m,@u,'Fin Throwaway','CRM-FIN')",
                ("m", medicoId), ("u", usuarioId));
            await Exec("INSERT INTO assinaturas (id,medico_id,plano,valor_mensal,status) VALUES (@id,@m,'pro',597,'ativa')",
                ("id", Guid.NewGuid()), ("m", medicoId));
        }

        // Conexão do gateway (NOBYPASSRLS) SEM nenhum GUC = estado que o middleware
        // deixa para role=admin (não seta app.tenant_bypass).
        await using var conn = await fx.OpenGatewayDbAsync();

        // Clínico: fail-closed em toda tabela com RLS (zero de tenant nenhum).
        foreach (var tabela in new[]
                 {
                     "prescricoes", "mensagens", "protocolos_crise_acionados",
                     "notificacoes_medico", "acessos_prontuario", "conversas",
                 })
        {
            var n = (long)(await Scalar(conn, $"SELECT count(*) FROM {tabela}"))!;
            Assert.Equal(0, n);
        }

        // Administrativo: legível (sem RLS) — billing é o escopo do admin_financeiro.
        var assinaturas = (long)(await Scalar(conn, "SELECT count(*) FROM assinaturas"))!;
        Assert.True(assinaturas >= 1, $"admin_financeiro deve ler assinaturas; viu {assinaturas}");
    }

    private static async Task<object?> Scalar(NpgsqlConnection conn, string sql)
    {
        await using var cmd = new NpgsqlCommand(sql, conn);
        return await cmd.ExecuteScalarAsync();
    }
}
