using ApiGateway.Data;
using Microsoft.EntityFrameworkCore;
using System.Data;
using System.Data.Common;

namespace ApiGateway.Auth;

/// <summary>
/// Seta, por request, o tenant na conexão do Postgres para a RLS (migration
/// 0037) decidir o que o role do gateway (cerebro_gateway, NOBYPASSRLS) pode
/// ver/escrever. Defesa em profundidade: complementa o WHERE da aplicação —
/// se um WHERE for esquecido, a RLS ainda barra o cross-tenant.
///
/// Mecânica (ver 0037): abre a conexão do DbContext (que o EF e o DbExtensions
/// reusam — o guard `jaAberta` não fecha conexão já aberta), seta um GUC de
/// sessão via set_config(...,false) e reseta no fim. O GUC vale para TODAS as
/// queries do request porque rodam na mesma conexão.
///
///   role=medico    -> app.current_medico  = medico_id (resolvido do claim sub)
///   role=paciente  -> app.current_paciente = paciente_id (sub do paciente_token)
///   role=owner      -> app.tenant_bypass = on (leitura cross-tenant do painel; SÓ owner)
///   role=admin      -> nenhum GUC (admin_financeiro, T0-6/ADR-068): fail-closed na
///                      clínica; tabelas administrativas não têm RLS → segue lendo
///   anônimo / sem médico -> nenhum GUC (fail-closed: RLS não entrega nada)
/// </summary>
public sealed class TenantSessionMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext ctx, AppDbContext db)
    {
        if (ctx.User?.Identity?.IsAuthenticated != true)
        {
            await next(ctx);
            return;
        }

        var role = ctx.User.FindFirst("role")?.Value;
        var sub = ctx.User.FindFirst("sub")?.Value;

        string? gucName = null;
        string? gucValue = null;

        if (role == "medico" && Guid.TryParse(sub, out var usuarioId))
        {
            var medicoId = await db.Database.ExecuteScalarAsync<Guid?>(
                "SELECT id FROM medicos WHERE usuario_id = {0}", usuarioId);
            if (medicoId is not null)
            {
                gucName = "app.current_medico";
                gucValue = medicoId.Value.ToString();
            }
        }
        else if (role == "paciente" && Guid.TryParse(sub, out var pacienteId))
        {
            gucName = "app.current_paciente";
            gucValue = pacienteId.ToString();
        }
        else if (role is "owner")
        {
            // SÓ owner faz bypass cross-tenant da RLS (inclui dado clínico).
            gucName = "app.tenant_bypass";
            gucValue = "on";
        }
        // role=admin (admin_financeiro — T0-6/ADR-068): NÃO recebe bypass. Cai no
        // ramo gucName==null abaixo → fail-closed nas 25 tabelas clínicas com RLS
        // (vê nada mesmo se um endpoint esquecer o filtro). Tabelas administrativas
        // (assinaturas/pagamentos/cobrancas/medico_asaas_config/newsletter) não têm
        // RLS → admin segue lendo normal. Minimização LGPD (clinical-safety regra #3):
        // perfil financeiro/suporte não enxerga conteúdo clínico de tenant nenhum.

        if (gucName is null)
        {
            // Médico sem registro em `medicos`, ou role desconhecida: não seta GUC.
            // Em tabela com RLS isso é fail-closed (não vê nada) — comportamento seguro.
            await next(ctx);
            return;
        }

        var conn = db.Database.GetDbConnection();
        var wasOpen = conn.State == ConnectionState.Open;
        if (!wasOpen) await conn.OpenAsync();
        try
        {
            await SetConfigAsync(conn, gucName, gucValue!);
            await next(ctx);
        }
        finally
        {
            // Limpa o GUC antes de a conexão voltar ao pool (defesa extra além do
            // reset-on-close do Npgsql). NULLIF(...,'') na policy trata o valor vazio.
            try { await SetConfigAsync(conn, gucName, ""); } catch { /* conexão pode ter caído */ }
            if (!wasOpen) await conn.CloseAsync();
        }
    }

    private static async Task SetConfigAsync(DbConnection conn, string name, string value)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT set_config(@n, @v, false)";
        var pn = cmd.CreateParameter(); pn.ParameterName = "n"; pn.Value = name; cmd.Parameters.Add(pn);
        var pv = cmd.CreateParameter(); pv.ParameterName = "v"; pv.Value = value; cmd.Parameters.Add(pv);
        await cmd.ExecuteNonQueryAsync();
    }
}
