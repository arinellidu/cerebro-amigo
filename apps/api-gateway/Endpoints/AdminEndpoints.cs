using ApiGateway.Auth;
using ApiGateway.Data;
using ApiGateway.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace ApiGateway.Endpoints;

/// <summary>
/// Painel do dono da plataforma (role=owner / role=admin).
/// Endpoints administrativos/financeiros requerem policy "admin_geral" (owner OU admin).
/// Operações destrutivas (change role) e endpoints que tocam dado CLÍNICO
/// (/metricas, /crises, /acessos, /medicos/{id}) exigem policy "owner" — T0-6/ADR-068:
/// o admin_financeiro não enxerga conteúdo clínico (minimização LGPD, regra #3).
/// owner tem bypass RLS; admin é fail-closed na clínica (TenantSessionMiddleware).
/// </summary>
public static class AdminEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/admin")
            .WithTags("admin")
            .RequireAuthorization("admin_geral");

        // ─── Métricas gerais da plataforma ───────────────────────────────────

        g.MapGet("/metricas", async (AppDbContext db) =>
        {
            var agora = DateTime.UtcNow;
            // Fronteira de "mês atual" no fuso de Brasília (UTC-3, sem DST), não em
            // UTC: 00:00 BRT do dia 1 = 03:00 UTC. Sem isto, pagamentos/custos das
            // ~3h finais do último dia do mês (horário BR) cairiam no mês seguinte.
            var agoraBrt = agora.AddHours(-3);
            var inicioMes = new DateTime(agoraBrt.Year, agoraBrt.Month, 1, 0, 0, 0, DateTimeKind.Utc).AddHours(3);
            var sete = agora.AddDays(-7);

            // Médicos e pacientes
            var totalMedicos = await db.Database.ExecuteScalarAsync<int?>("SELECT COUNT(*)::int FROM medicos") ?? 0;
            var totalPacientes = await db.Database.ExecuteScalarAsync<int?>("SELECT COUNT(*)::int FROM clientes") ?? 0;

            // Ativos 7 dias
            var medicosAtivos7d = await db.Database.ExecuteScalarAsync<int?>(
                "SELECT COUNT(DISTINCT m.id)::int FROM medicos m " +
                "JOIN pacientes p ON p.medico_responsavel_id = m.id " +
                "JOIN conversas c ON c.cliente_id = p.cliente_id " +
                "JOIN mensagens ms ON ms.conversa_id = c.id " +
                "WHERE ms.criada_em >= {0}", sete) ?? 0;

            var pacientesAtivos7d = await db.Database.ExecuteScalarAsync<int?>(
                "SELECT COUNT(DISTINCT p.cliente_id)::int FROM pacientes p " +
                "JOIN conversas c ON c.cliente_id = p.cliente_id " +
                "JOIN mensagens ms ON ms.conversa_id = c.id " +
                "WHERE ms.criada_em >= {0}", sete) ?? 0;

            // Mensagens e checkins 7d
            var mensagens7d = await db.Database.ExecuteScalarAsync<int?>(
                "SELECT COUNT(*)::int FROM mensagens WHERE criada_em >= {0}", sete) ?? 0;

            var checkinsRespondidos7d = await db.Database.ExecuteScalarAsync<int?>(
                "SELECT COUNT(*)::int FROM checkins WHERE respondido_em >= {0}", sete) ?? 0;

            // Custo LLM mês atual
            var custoLlmMes = await db.Database.ExecuteScalarAsync<decimal?>(
                "SELECT COALESCE(SUM(custo_usd), 0)::numeric FROM agente_execucoes " +
                "WHERE iniciado_em >= {0}", inicioMes) ?? 0;

            // Billing: MRR (assinaturas ativas)
            var mrr = await db.Database.ExecuteScalarAsync<decimal?>(
                "SELECT COALESCE(SUM(valor_mensal), 0)::numeric FROM assinaturas WHERE status = 'ativa'") ?? 0;

            // Receita confirmada do mês
            var receitaMes = await db.Database.ExecuteScalarAsync<decimal?>(
                "SELECT COALESCE(SUM(pm.valor), 0)::numeric FROM pagamentos_manuais pm " +
                "WHERE pm.status = 'confirmado' AND pm.pago_em >= {0}", inicioMes) ?? 0;

            // Receita total histórica
            var receitaTotal = await db.Database.ExecuteScalarAsync<decimal?>(
                "SELECT COALESCE(SUM(valor), 0)::numeric FROM pagamentos_manuais WHERE status = 'confirmado'") ?? 0;

            // Custo LLM histórico
            var custoLlmTotal = await db.Database.ExecuteScalarAsync<decimal?>(
                "SELECT COALESCE(SUM(custo_usd), 0)::numeric FROM agente_execucoes") ?? 0;

            // Trials ativos (legado pré-ADR-055)
            var trials = await db.Database.ExecuteScalarAsync<int?>(
                "SELECT COUNT(*)::int FROM assinaturas WHERE status = 'trial'") ?? 0;

            // Pendentes (ADR-055): assinatura criada, aguardando 1º pagamento.
            var pendentes = await db.Database.ExecuteScalarAsync<int?>(
                "SELECT COUNT(*)::int FROM assinaturas WHERE status = 'pendente'") ?? 0;

            // Assinaturas ativas
            var assinaturasAtivas = await db.Database.ExecuteScalarAsync<int?>(
                "SELECT COUNT(*)::int FROM assinaturas WHERE status = 'ativa'") ?? 0;

            return Results.Ok(new
            {
                // Plataforma
                totalMedicos,
                totalPacientes,
                medicosAtivos7d,
                pacientesAtivos7d,
                mensagens7d,
                checkinsRespondidos7d,
                trials,
                pendentes,
                assinaturasAtivas,
                // Financeiro (USD e BRL separados — LLM é USD, billing é BRL)
                mrr,                 // BRL/mês — base MRR
                receitaMes,          // BRL confirmado este mês
                receitaTotal,        // BRL histórico
                custoLlmMesUsd = custoLlmMes,
                custoLlmTotalUsd = custoLlmTotal,
                lucroBrutoMes = receitaMes,  // Por enquanto = receita (infra não rastreada aqui)
                calculadoEm = agora,
            });
        })
        .RequireAuthorization("owner"); // T0-6/ADR-068: conta mensagens/checkins (RLS) → só owner

        // ── Cockpit de receita (Fluxo A): MRR, receita/mês, inadimplência, funil ──
        // Foca na cobrança plataforma→médico (assinaturas + pagamentos_manuais).
        // NÃO faz decomposição de MRR (Novo/Churn) — exigiria histórico de snapshots.
        g.MapGet("/cockpit", async (AppDbContext db) =>
        {
            // MRR atual = soma das mensalidades das assinaturas ativas.
            var mrr = await db.Database.ExecuteScalarAsync<decimal?>(
                "SELECT COALESCE(SUM(valor_mensal),0)::numeric FROM assinaturas WHERE status='ativa'") ?? 0;

            var mrrPorPlano = await db.Database.SqlQueryRaw<MrrPlanoRow>(@"
                SELECT plano,
                       COUNT(*)::int AS quantidade,
                       COALESCE(SUM(valor_mensal),0)::numeric AS valor
                FROM assinaturas WHERE status='ativa'
                GROUP BY plano ORDER BY valor DESC").ToListAsync();

            // Receita realizada por mês (12m) — pagamentos confirmados, bucket no fuso BR.
            var receitaMensal = await db.Database.SqlQueryRaw<ReceitaMesRow>(@"
                SELECT to_char(date_trunc('month', pago_em AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM') AS mes,
                       COALESCE(SUM(valor),0)::numeric AS valor,
                       COUNT(*)::int AS pagamentos
                FROM pagamentos_manuais
                WHERE status='confirmado' AND pago_em IS NOT NULL
                  AND pago_em >= (NOW() - INTERVAL '12 months')
                GROUP BY 1 ORDER BY 1").ToListAsync();

            // Inadimplência (Fluxo A): assinaturas suspensas = pagamento Asaas vencido.
            var inadimplentes = await db.Database.SqlQueryRaw<InadimplenteRow>(@"
                SELECT a.id AS assinatura_id, a.medico_id, m.nome AS medico_nome,
                       u.email AS medico_email, a.valor_mensal, a.atualizado_em AS desde
                FROM assinaturas a
                JOIN medicos m ON m.id = a.medico_id
                JOIN usuarios u ON u.id = m.usuario_id
                WHERE a.status='suspensa'
                ORDER BY a.valor_mensal DESC").ToListAsync();
            var mrrEmRisco = inadimplentes.Sum(x => x.ValorMensal);

            // Trials ativos + os que vencem em ≤7 dias.
            var trialsAtivos = await db.Database.ExecuteScalarAsync<int?>(
                "SELECT COUNT(*)::int FROM assinaturas WHERE status='trial'") ?? 0;
            var trialsExpirando = await db.Database.SqlQueryRaw<TrialRow>(@"
                SELECT a.id AS assinatura_id, a.medico_id, m.nome AS medico_nome, a.trial_ate
                FROM assinaturas a JOIN medicos m ON m.id = a.medico_id
                WHERE a.status='trial' AND a.trial_ate IS NOT NULL
                  AND a.trial_ate <= (NOW() + INTERVAL '7 days')
                ORDER BY a.trial_ate").ToListAsync();

            // Pendentes (ADR-055): aguardando 1º pagamento. VENCIDOS = prazo passou →
            // paywall ativo (potencial churn de entrada; valor_mensal costuma ser 0 até
            // escolher plano, por isso fica fora do MRR em risco — é contador, não receita).
            var pendentesAtivos = await db.Database.ExecuteScalarAsync<int?>(
                "SELECT COUNT(*)::int FROM assinaturas WHERE status='pendente'") ?? 0;
            var pendentesVencidos = await db.Database.SqlQueryRaw<PendenteRow>(@"
                SELECT a.id AS assinatura_id, a.medico_id, m.nome AS medico_nome,
                       a.valor_mensal, a.prazo_pagamento_ate
                FROM assinaturas a JOIN medicos m ON m.id = a.medico_id
                WHERE a.status='pendente' AND a.prazo_pagamento_ate IS NOT NULL
                  AND a.prazo_pagamento_ate < NOW()
                ORDER BY a.prazo_pagamento_ate").ToListAsync();
            var pendentesVencendo = await db.Database.SqlQueryRaw<PendenteRow>(@"
                SELECT a.id AS assinatura_id, a.medico_id, m.nome AS medico_nome,
                       a.valor_mensal, a.prazo_pagamento_ate
                FROM assinaturas a JOIN medicos m ON m.id = a.medico_id
                WHERE a.status='pendente' AND a.prazo_pagamento_ate IS NOT NULL
                  AND a.prazo_pagamento_ate >= NOW()
                  AND a.prazo_pagamento_ate <= (NOW() + INTERVAL '3 days')
                ORDER BY a.prazo_pagamento_ate").ToListAsync();

            // Funil (aproximado): convidados → ativaram conta → em trial → converteram.
            var convidados = await db.Database.ExecuteScalarAsync<int?>(
                "SELECT COUNT(*)::int FROM medico_invite_tokens") ?? 0;
            var ativaram = await db.Database.ExecuteScalarAsync<int?>(
                "SELECT COUNT(*)::int FROM medico_invite_tokens WHERE usado_em IS NOT NULL") ?? 0;
            var convertidos = await db.Database.ExecuteScalarAsync<int?>(@"
                SELECT COUNT(DISTINCT a.id)::int FROM assinaturas a
                JOIN pagamentos_manuais pm ON pm.assinatura_id = a.id AND pm.status='confirmado'
                WHERE a.status='ativa'") ?? 0;

            // Cobráveis ainda sem cobrança Asaas (CPF + valor>0, sem subscription).
            var cobraveisSemAsaas = await db.Database.SqlQueryRaw<CobravelRow>(@"
                SELECT a.id AS assinatura_id, a.medico_id, m.nome AS medico_nome,
                       a.valor_mensal, m.cpf
                FROM assinaturas a
                JOIN medicos m ON m.id = a.medico_id
                WHERE a.status IN ('trial','pendente','ativa')
                  AND a.asaas_subscription_id IS NULL
                  AND a.valor_mensal > 0
                  AND m.cpf IS NOT NULL AND m.cpf <> ''
                ORDER BY a.valor_mensal DESC").ToListAsync();

            return Results.Ok(new
            {
                mrr,
                mrrPorPlano,
                receitaMensal,
                inadimplencia = new { mrrEmRisco, itens = inadimplentes },
                trials = new { ativos = trialsAtivos, expirando = trialsExpirando },
                pendentes = new { ativos = pendentesAtivos, vencidos = pendentesVencidos, vencendo = pendentesVencendo },
                funil = new { convidados, ativaram, emTrial = trialsAtivos, emPendente = pendentesAtivos, convertidos },
                cobraveisSemAsaas,
            });
        });

        // ── Reconciliação Asaas (ADR-055 Fase E): divergência status local × Asaas ──
        // Rede de segurança contra webhook perdido (assinatura presa em status errado).
        // DETECT-ONLY: não escreve nada — corrigir é decisão humana (evita auto-suspender/
        // auto-ativar por leitura possivelmente transitória do Asaas). Chamável manual
        // pelo admin ou por scheduler externo (EventBridge) no futuro.
        g.MapGet("/asaas/reconciliacao", async (AppDbContext db, AsaasClient asaas) =>
        {
            if (!asaas.Configurado)
                return Results.Json(new { error = "asaas_nao_configurado" }, statusCode: 503);

            var assinaturas = await db.Database.SqlQueryRaw<ReconAssinaturaRow>(@"
                SELECT a.id AS assinatura_id, a.medico_id, m.nome AS medico_nome,
                       a.status AS status_local, a.asaas_subscription_id
                FROM assinaturas a JOIN medicos m ON m.id = a.medico_id
                WHERE a.asaas_subscription_id IS NOT NULL AND a.status <> 'cancelada'").ToListAsync();

            var divergencias = new List<object>();
            var indisponiveis = 0;
            foreach (var a in assinaturas)
            {
                var statusAsaas = await asaas.ObterStatusAssinaturaAsync(a.AsaasSubscriptionId!);
                if (statusAsaas is null) { indisponiveis++; continue; }
                var esperado = statusAsaas.ToUpperInvariant() switch
                {
                    "ACTIVE" => "ativa",
                    "EXPIRED" or "INACTIVE" => "suspensa",
                    _ => null,
                };
                if (esperado is not null && !string.Equals(esperado, a.StatusLocal, StringComparison.OrdinalIgnoreCase))
                    divergencias.Add(new
                    {
                        assinaturaId = a.AssinaturaId, medicoNome = a.MedicoNome,
                        statusLocal = a.StatusLocal, statusAsaas, esperado,
                    });
            }
            return Results.Ok(new { verificadas = assinaturas.Count, divergencias, indisponiveis });
        });

        // ── Sala de supervisão de crise (governança platform-wide, READ-ONLY) ─────
        // Lê a trilha imutável protocolos_crise_acionados (clinical-safety regra 5:
        // NUNCA edita/apaga). Expõe só METADADOS (médico, origem, categoria de
        // gatilho, SLA de notificação) — sem conteúdo clínico cru e sem PII do
        // paciente (regra 4 — minimização). Mede a regra "médico no loop".
        g.MapGet("/crises", async (AppDbContext db) =>
        {
            var total30d = await db.Database.ExecuteScalarAsync<int?>(
                "SELECT COUNT(*)::int FROM protocolos_crise_acionados WHERE criado_em >= NOW() - INTERVAL '30 days'") ?? 0;
            var semNotificacao = await db.Database.ExecuteScalarAsync<int?>(
                "SELECT COUNT(*)::int FROM protocolos_crise_acionados WHERE medico_notificado = FALSE AND criado_em >= NOW() - INTERVAL '30 days'") ?? 0;
            var slaMedioSegundos = await db.Database.ExecuteScalarAsync<double?>(@"
                SELECT AVG(EXTRACT(EPOCH FROM (medico_notificado_em - criado_em)))::float8
                FROM protocolos_crise_acionados
                WHERE medico_notificado = TRUE AND medico_notificado_em IS NOT NULL
                  AND criado_em >= NOW() - INTERVAL '30 days'");
            var automacaoPausada = await db.Database.ExecuteScalarAsync<int?>(
                "SELECT COUNT(*)::int FROM pacientes WHERE automacao_pausada = TRUE") ?? 0;

            var eventos = await db.Database.SqlQueryRaw<CriseEventoRow>(@"
                SELECT pc.id, pc.criado_em, m.nome AS medico_nome, pc.origem,
                       pc.gatilho, pc.confianca, pc.medico_notificado,
                       pc.medico_notificado_em,
                       COALESCE(p.automacao_pausada, FALSE) AS automacao_pausada
                FROM protocolos_crise_acionados pc
                LEFT JOIN medicos m ON m.id = pc.medico_id
                LEFT JOIN pacientes p ON p.cliente_id = pc.paciente_id
                WHERE pc.criado_em >= NOW() - INTERVAL '30 days'
                ORDER BY pc.criado_em DESC
                LIMIT 100").ToListAsync();

            return Results.Ok(new
            {
                total30d,
                semNotificacao,
                slaMedioSegundos,
                automacaoPausada,
                eventos,
            });
        })
        .RequireAuthorization("owner"); // T0-6/ADR-068: supervisão de crise (clínico) → só owner

        // ── Trilha de acesso a dados sensíveis (LGPD art.37, READ-ONLY) ───────────
        // Quem-viu-qual-paciente. Detecta acesso cruzado (médico abriu paciente que
        // não é dele). Só metadados de acesso — nunca conteúdo clínico.
        g.MapGet("/acessos", async (AppDbContext db, [FromQuery] string? q) =>
        {
            var filtro = q ?? "";
            var total30d = await db.Database.ExecuteScalarAsync<int?>(
                "SELECT COUNT(*)::int FROM acessos_prontuario WHERE criado_em >= NOW() - INTERVAL '30 days'") ?? 0;
            var cruzados30d = await db.Database.ExecuteScalarAsync<int?>(@"
                SELECT COUNT(*)::int FROM acessos_prontuario ap
                LEFT JOIN pacientes p ON p.cliente_id = ap.paciente_id
                WHERE ap.criado_em >= NOW() - INTERVAL '30 days'
                  AND p.medico_responsavel_id IS DISTINCT FROM ap.medico_id") ?? 0;
            var itens = await db.Database.SqlQueryRaw<AcessoRow>(@"
                SELECT ap.id, ap.criado_em, ap.recurso, m.nome AS medico_nome,
                       c.nome AS paciente_nome,
                       (p.medico_responsavel_id IS DISTINCT FROM ap.medico_id) AS acesso_cruzado
                FROM acessos_prontuario ap
                JOIN medicos m ON m.id = ap.medico_id
                JOIN clientes c ON c.id = ap.paciente_id
                LEFT JOIN pacientes p ON p.cliente_id = ap.paciente_id
                WHERE ({0} = '' OR m.nome ILIKE '%' || {0} || '%' OR c.nome ILIKE '%' || {0} || '%')
                ORDER BY ap.criado_em DESC
                LIMIT 200", filtro).ToListAsync();
            return Results.Ok(new { total30d, cruzados30d, itens });
        })
        .RequireAuthorization("owner"); // T0-6/ADR-068: trilha LGPD de acesso clínico → só owner

        // ── Solicitações de direitos do titular (LGPD) ───────────────────────────
        // Registro/acompanhamento das solicitações (acesso, portabilidade,
        // eliminação, oposição ao tratamento automatizado, correção). É o workflow
        // do DPO — NÃO executa a operação (export/eliminação são feitos à parte,
        // com cuidado). DELETE bloqueado no banco (registro de conformidade).
        g.MapGet("/solicitacoes", async (AppDbContext db, [FromQuery] string? status) =>
        {
            var f = status ?? "";
            var itens = await db.Database.SqlQueryRaw<SolicitacaoRow>(@"
                SELECT s.id, s.identificacao, s.tipo, s.status, s.notas,
                       s.criado_em, s.atendido_em,
                       cp.nome AS criado_por_nome, ap.nome AS atendido_por_nome,
                       c.nome AS paciente_nome
                FROM solicitacoes_titular s
                LEFT JOIN usuarios cp ON cp.id = s.criado_por
                LEFT JOIN usuarios ap ON ap.id = s.atendido_por
                LEFT JOIN clientes c ON c.id = s.paciente_id
                WHERE ({0} = '' OR s.status = {0})
                ORDER BY (s.status = 'aberta') DESC, s.criado_em DESC
                LIMIT 200", f).ToListAsync();
            var abertas = await db.Database.ExecuteScalarAsync<int?>(
                "SELECT COUNT(*)::int FROM solicitacoes_titular WHERE status = 'aberta'") ?? 0;
            return Results.Ok(new { abertas, itens });
        });

        g.MapPost("/solicitacoes", async (
            [FromBody] CriarSolicitacaoRequest req, AppDbContext db, ClaimsPrincipal user) =>
        {
            var tipos = new[] { "acesso", "portabilidade", "eliminacao", "oposicao_ia", "correcao" };
            if (string.IsNullOrWhiteSpace(req.Identificacao)) return Results.BadRequest(new { error = "identificacao_obrigatoria" });
            if (!tipos.Contains(req.Tipo)) return Results.BadRequest(new { error = "tipo_invalido" });

            var criadoPor = user.FindFirst("sub")?.Value;
            var id = Guid.NewGuid();
            await db.Database.ExecuteRawAsync(@"
                INSERT INTO solicitacoes_titular (id, identificacao, tipo, notas, criado_por)
                VALUES ({0}, {1}, {2}, {3}, {4}::uuid)",
                id, req.Identificacao.Trim(), req.Tipo,
                (object?)req.Notas ?? DBNull.Value, (object?)criadoPor ?? DBNull.Value);
            return Results.Created($"/api/v1/admin/solicitacoes/{id}", new { id });
        });

        g.MapPatch("/solicitacoes/{id:guid}", async (
            Guid id, [FromBody] AtualizarSolicitacaoRequest req, AppDbContext db, ClaimsPrincipal user) =>
        {
            var statuses = new[] { "aberta", "atendida", "recusada" };
            if (req.Status is not null && !statuses.Contains(req.Status)) return Results.BadRequest(new { error = "status_invalido" });

            var atendidoPor = user.FindFirst("sub")?.Value;
            var ok = await db.Database.ExecuteRawAsync(@"
                UPDATE solicitacoes_titular SET
                    status        = COALESCE({1}, status),
                    notas         = COALESCE({2}, notas),
                    atendido_por  = CASE WHEN {1} IN ('atendida','recusada') THEN {3}::uuid ELSE atendido_por END,
                    atendido_em   = CASE WHEN {1} IN ('atendida','recusada') THEN NOW() ELSE atendido_em END,
                    atualizado_em = NOW()
                WHERE id = {0}",
                id, (object?)req.Status ?? DBNull.Value,
                (object?)req.Notas ?? DBNull.Value, (object?)atendidoPor ?? DBNull.Value);
            return ok == 0 ? Results.NotFound() : Results.NoContent();
        });

        // Custo LLM por mês (histórico 12 meses)
        g.MapGet("/custos-llm", async (AppDbContext db) =>
        {
            var rows = await db.Database.SqlQueryRaw<CustoMes>(@"
                SELECT DATE_TRUNC('month', iniciado_em)::date AS mes,
                       agente,
                       COUNT(*)::int                          AS execucoes,
                       SUM(tokens_in)::int                   AS tokens_in_total,
                       SUM(tokens_out)::int                  AS tokens_out_total,
                       ROUND(SUM(custo_usd)::numeric, 6)     AS custo_total_usd
                FROM agente_execucoes
                WHERE iniciado_em >= NOW() - INTERVAL '12 months'
                  AND custo_usd IS NOT NULL
                GROUP BY 1, 2
                ORDER BY 1 DESC, 3 DESC").ToListAsync();
            return Results.Ok(rows);
        });

        // ─── Saúde / execução dos agentes analíticos (últimos 30 dias) ─────────
        // Read-only sobre agente_execucoes (append-only). Só metadados técnicos —
        // sem conteúdo clínico. paciente_id não é exposto aqui.
        g.MapGet("/agentes-saude", async (AppDbContext db) =>
        {
            var agentes = await db.Database.SqlQueryRaw<AgenteSaude>(@"
                SELECT
                    agente,
                    COUNT(*)::int                                     AS total,
                    COUNT(*) FILTER (WHERE sucesso IS TRUE)::int      AS sucessos,
                    COUNT(*) FILTER (WHERE sucesso IS FALSE)::int     AS falhas,
                    COUNT(*) FILTER (WHERE concluido_em IS NULL)::int AS em_aberto,
                    ROUND(AVG(EXTRACT(EPOCH FROM (concluido_em - iniciado_em)) * 1000)::numeric, 0) AS latencia_media_ms,
                    ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (
                        ORDER BY EXTRACT(EPOCH FROM (concluido_em - iniciado_em)) * 1000)::numeric, 0) AS latencia_p95ms,
                    ROUND(COALESCE(SUM(custo_usd), 0)::numeric, 4)    AS custo_usd_total,
                    MAX(iniciado_em)                                  AS ultimo_run
                FROM agente_execucoes
                WHERE iniciado_em >= NOW() - INTERVAL '30 days'
                GROUP BY agente
                ORDER BY total DESC").ToListAsync();

            // Erros técnicos recentes (exceções do runner — não conteúdo de paciente).
            var errosRecentes = await db.Database.SqlQueryRaw<AgenteErro>(@"
                SELECT agente, erro, iniciado_em
                FROM agente_execucoes
                WHERE sucesso IS FALSE AND erro IS NOT NULL
                  AND iniciado_em >= NOW() - INTERVAL '30 days'
                ORDER BY iniciado_em DESC
                LIMIT 20").ToListAsync();

            return Results.Ok(new { agentes, errosRecentes });
        });

        // ─── Usuários ─────────────────────────────────────────────────────────

        g.MapGet("/usuarios", async ([FromQuery] bool? desativados, AppDbContext db) =>
        {
            // ?desativados=true → lista desativados (p/ aba de reativação).
            var sql = desativados == true ? @"
                SELECT u.id, u.nome, u.email, u.role, u.ultimo_login,
                       m.id AS medico_id, m.crm, m.especialidade,
                       a.plano AS plano_assinatura, a.status AS status_assinatura,
                       u.desativado_em
                FROM usuarios u
                LEFT JOIN medicos m ON m.usuario_id = u.id
                LEFT JOIN assinaturas a ON a.medico_id = m.id
                WHERE u.desativado_em IS NOT NULL
                ORDER BY u.desativado_em DESC, u.nome" : @"
                SELECT u.id, u.nome, u.email, u.role, u.ultimo_login,
                       m.id AS medico_id, m.crm, m.especialidade,
                       a.plano AS plano_assinatura, a.status AS status_assinatura,
                       u.desativado_em
                FROM usuarios u
                LEFT JOIN medicos m ON m.usuario_id = u.id
                LEFT JOIN assinaturas a ON a.medico_id = m.id
                WHERE u.desativado_em IS NULL
                ORDER BY u.role DESC, u.nome";
            var rows = await db.Database.SqlQueryRaw<UsuarioAdmin>(sql).ToListAsync();
            return Results.Ok(rows);
        });

        // Reativar usuário desativado (desfaz soft delete).
        g.MapPost("/usuarios/{id:guid}/reativar", async (
            Guid id, AppDbContext db, ClaimsPrincipal caller) =>
        {
            var callerRole = caller.FindFirst("role")?.Value ?? "";
            if (callerRole != "owner" && callerRole != "admin")
                return Results.Forbid();

            var ok = await db.Database.ExecuteSqlRawAsync(
                "UPDATE usuarios SET desativado_em = NULL WHERE id = {0} AND desativado_em IS NOT NULL", id);
            return ok == 0 ? Results.NotFound() : Results.NoContent();
        });

        // Criar usuário (owner/admin cria médicos, admins, etc.)
        g.MapPost("/usuarios", async (
            [FromBody] CriarUsuarioAdminRequest req,
            AppDbContext db,
            IPasswordHasher hasher,
            ClaimsPrincipal caller) =>
        {
            // Só owner pode criar outros owners ou admins
            var callerRole = caller.FindFirst("role")?.Value ?? "";
            if ((req.Role == "owner" || req.Role == "admin") && callerRole != "owner")
                return Results.Forbid();

            var email = req.Email.Trim().ToLowerInvariant();
            var existe = await db.Database.ExistsAsync("SELECT 1 FROM usuarios WHERE email = {0}", email);
            if (existe) return Results.Conflict(new { error = "email_em_uso" });

            var usuarioId = Guid.NewGuid();
            var senhaHash = hasher.Hash(req.Senha);
            await db.Database.ExecuteSqlRawAsync(
                "INSERT INTO usuarios (id, email, senha_hash, nome, role) VALUES ({0},{1},{2},{3},{4})",
                usuarioId, email, senhaHash, req.Nome.Trim(), req.Role ?? "medico");

            return Results.Created($"/api/v1/admin/usuarios/{usuarioId}", new { id = usuarioId });
        });

        // Trocar senha de qualquer usuario (útil para reset manual)
        g.MapPatch("/usuarios/{id:guid}/senha", async (
            Guid id, [FromBody] TrocarSenhaAdminRequest req,
            AppDbContext db, IPasswordHasher hasher, ClaimsPrincipal caller) =>
        {
            if (string.IsNullOrWhiteSpace(req.NovaSenha) || req.NovaSenha.Length < 8)
                return Results.BadRequest(new { error = "senha minimo 8 caracteres" });

            // ADR-068: reset de conta privilegiada (owner/admin) só pelo owner.
            // Sem isto, um admin reseta a senha do owner e assume a conta (owner faz
            // tenant_bypass → leitura clínica cross-tenant). Espelha o guard do DELETE.
            var alvoRole = await db.Database.ExecuteScalarAsync<string?>(
                "SELECT role FROM usuarios WHERE id = {0}", id);
            if (alvoRole is null) return Results.NotFound();
            var callerRole = caller.FindFirst("role")?.Value ?? "";
            if ((string.Equals(alvoRole, "owner", StringComparison.OrdinalIgnoreCase) ||
                 string.Equals(alvoRole, "admin", StringComparison.OrdinalIgnoreCase)) &&
                callerRole != "owner")
                return Results.Forbid();

            var hash = hasher.Hash(req.NovaSenha);
            var ok = await db.Database.ExecuteSqlRawAsync(
                // T1-7: reset manual pelo admin revoga JWTs ativos do usuário (token_version++).
                "UPDATE usuarios SET senha_hash = {0}, token_version = token_version + 1 WHERE id = {1}", hash, id);
            return ok == 0 ? Results.NotFound() : Results.NoContent();
        });

        // Promover / rebaixar role (SOMENTE owner)
        g.MapPatch("/usuarios/{id:guid}/role", async (
            Guid id, [FromBody] MudarRoleRequest req,
            AppDbContext db, ClaimsPrincipal caller) =>
        {
            var callerRole = caller.FindFirst("role")?.Value ?? "";
            if (callerRole != "owner")
                return Results.Forbid();

            // Não deixa owner remover ele mesmo
            var callerSub = caller.FindFirst("sub")?.Value;
            var targetUsuarioId = await db.Database.ExecuteScalarAsync<Guid?>(
                "SELECT id FROM usuarios WHERE id = {0}", id);
            if (Guid.TryParse(callerSub, out var cId) && cId == id && req.Role != "owner")
                return Results.BadRequest(new { error = "nao pode rebaixar a propria conta owner" });

            var roles = new[] { "owner", "admin", "medico" };
            if (!roles.Contains(req.Role))
                return Results.BadRequest(new { error = "role invalida" });

            var ok = await db.Database.ExecuteSqlRawAsync(
                "UPDATE usuarios SET role = {0} WHERE id = {1}", req.Role, id);
            return ok == 0 ? Results.NotFound() : Results.NoContent();
        });

        // Editar dados básicos (nome + e-mail). Qualquer admin (policy do grupo).
        // Role tem rota própria (owner-only); senha idem.
        g.MapPatch("/usuarios/{id:guid}", async (
            Guid id, [FromBody] EditarUsuarioRequest req, AppDbContext db, ClaimsPrincipal caller) =>
        {
            var nome = (req.Nome ?? "").Trim();
            var email = (req.Email ?? "").Trim().ToLowerInvariant();
            if (nome.Length < 3) return Results.BadRequest(new { error = "nome invalido" });
            if (string.IsNullOrEmpty(email) || !email.Contains('@'))
                return Results.BadRequest(new { error = "email invalido" });

            // ADR-068: editar conta privilegiada (owner/admin) só pelo owner — senão
            // um admin troca o e-mail do owner e sequestra via fluxo "esqueci a senha".
            var alvoRole = await db.Database.ExecuteScalarAsync<string?>(
                "SELECT role FROM usuarios WHERE id = {0}", id);
            if (alvoRole is null) return Results.NotFound();
            var callerRole = caller.FindFirst("role")?.Value ?? "";
            if ((string.Equals(alvoRole, "owner", StringComparison.OrdinalIgnoreCase) ||
                 string.Equals(alvoRole, "admin", StringComparison.OrdinalIgnoreCase)) &&
                callerRole != "owner")
                return Results.Forbid();

            var emailEmUso = await db.Database.ExistsAsync(
                "SELECT 1 FROM usuarios WHERE email = {0} AND id <> {1}", email, id);
            if (emailEmUso) return Results.Conflict(new { error = "email_em_uso" });

            var ok = await db.Database.ExecuteSqlRawAsync(
                "UPDATE usuarios SET nome = {1}, email = {2} WHERE id = {0}", id, nome, email);
            if (ok == 0) return Results.NotFound();
            // Mantém medicos.nome (denormalizado) em sincronia.
            await db.Database.ExecuteSqlRawAsync(
                "UPDATE medicos SET nome = {1} WHERE usuario_id = {0}", id, nome);
            return Results.NoContent();
        });

        // Desativar usuário (SOFT delete). Qualquer admin (policy do grupo).
        // Não apaga: preserva dados clínicos + auditoria (FK RESTRICT). Bloqueia
        // login + some da lista. Reversível (limpar desativado_em).
        g.MapDelete("/usuarios/{id:guid}", async (
            Guid id, AppDbContext db, ClaimsPrincipal caller) =>
        {
            var callerSub = caller.FindFirst("sub")?.Value;
            if (Guid.TryParse(callerSub, out var cId) && cId == id)
                return Results.BadRequest(new { error = "nao_pode_desativar_propria_conta" });

            var alvoRole = await db.Database.ExecuteScalarAsync<string?>(
                "SELECT role FROM usuarios WHERE id = {0}", id);
            if (alvoRole is null) return Results.NotFound();
            if (string.Equals(alvoRole, "owner", StringComparison.OrdinalIgnoreCase))
                return Results.BadRequest(new { error = "nao_pode_desativar_owner" });

            var ok = await db.Database.ExecuteSqlRawAsync(
                "UPDATE usuarios SET desativado_em = NOW() WHERE id = {0} AND desativado_em IS NULL", id);
            return ok == 0 ? Results.NotFound() : Results.NoContent();
        });

        // ─── Onboarding de médico ──────────────────────────────────────────────
        // Cria usuario + medico + assinatura trial + token de convite + envia email.
        g.MapPost("/onboarding/medico", async (
            [FromBody] OnboardingMedicoRequest req,
            MedicoOnboardingService onboarding) =>
        {
            // Lógica extraída p/ MedicoOnboardingService (ADR-046), reusada pelo self-signup.
            // Admin: tolera CFM indisponível (soft-fail → PendenteVerificacao). origem = 'admin'.
            var r = await onboarding.OnboardAsync(new OnboardMedicoInput(
                Nome: req.Nome, Email: req.Email, Crm: req.Crm, CrmUf: req.CrmUf, Cpf: req.Cpf,
                Plano: req.Plano, ValorMensal: req.ValorMensal ?? 0m,
                SignupSource: "admin", CheckupRid: null, AllowCrmSoftFail: true));

            if (!r.Success)
                return Results.Json(new { error = r.Error, situacao = r.Situacao }, statusCode: r.StatusCode);

            return Results.Created($"/api/v1/admin/medicos/{r.MedicoId}", new
            {
                usuarioId = r.UsuarioId,
                medicoId = r.MedicoId,
                emailEnviado = r.EmailEnviado,
                emailErro = r.EmailErro,
                ativarContaUrl = r.AtivarContaUrl,
                crmPendente = r.CrmPendente,
            });
        });

        // ─── Perfil 360° do médico (drill-down) ───────────────────────────────
        // Visão de plataforma (owner/admin vê todos). Só metadados e contagens —
        // NUNCA conteúdo clínico (mensagem/sintoma/diário). clinical-safety regra 4.
        g.MapGet("/medicos/{id:guid}", async (Guid id, AppDbContext db) =>
        {
            var perfil = await db.Database.SqlQueryRaw<MedicoPerfil>(@"
                SELECT
                    m.id, m.nome, m.crm, m.crm_uf, m.cpf, m.especialidade, m.timezone,
                    m.crm_situacao, m.crm_validado_em, m.crm_nome_cfm, m.criado_em,
                    u.email, u.ultimo_login,
                    a.plano, a.valor_mensal, a.moeda, a.status AS status_assinatura, a.trial_ate, a.inicio_em,
                    (SELECT COUNT(*)::int FROM pacientes p WHERE p.medico_responsavel_id = m.id) AS total_pacientes,
                    (SELECT COUNT(*)::int FROM pacientes p
                        JOIN conversas c  ON c.cliente_id = p.cliente_id
                        JOIN mensagens ms ON ms.conversa_id = c.id
                        WHERE p.medico_responsavel_id = m.id
                          AND ms.criada_em >= NOW() - INTERVAL '30 days') AS mensagens_recentes,
                    (SELECT COUNT(*)::int FROM consultas co WHERE co.medico_id = m.id) AS total_consultas,
                    (SELECT COUNT(*)::int FROM protocolos_crise_acionados pc WHERE pc.medico_id = m.id) AS crises_total,
                    (SELECT COUNT(*)::int FROM checkins ck
                        JOIN pacientes p ON p.cliente_id = ck.paciente_id
                        WHERE p.medico_responsavel_id = m.id AND ck.respondido_em IS NOT NULL) AS checkins_respondidos,
                    COALESCE((SELECT SUM(ms.custo_usd) FROM pacientes p
                        JOIN conversas c  ON c.cliente_id = p.cliente_id
                        JOIN mensagens ms ON ms.conversa_id = c.id
                        WHERE p.medico_responsavel_id = m.id), 0)::numeric AS custo_conversa_usd,
                    COALESCE((SELECT SUM(ae.custo_usd) FROM pacientes p
                        JOIN agente_execucoes ae ON ae.paciente_id = p.cliente_id
                        WHERE p.medico_responsavel_id = m.id), 0)::numeric AS custo_agentes_usd
                FROM medicos m
                JOIN usuarios u ON u.id = m.usuario_id
                LEFT JOIN assinaturas a ON a.medico_id = m.id
                WHERE m.id = {0}", id).FirstOrDefaultAsync();

            return perfil is null ? Results.NotFound() : Results.Ok(perfil);
        })
        .RequireAuthorization("owner"); // T0-6/ADR-068: drill-down clínico do médico → só owner

        // ─── Assinaturas / Billing ────────────────────────────────────────────

        g.MapGet("/assinaturas", async (AppDbContext db) =>
        {
            var rows = await db.Database.SqlQueryRaw<AssinaturaAdmin>(@"
                SELECT a.id, a.plano, a.valor_mensal, a.moeda, a.status,
                       a.trial_ate, a.inicio_em, a.cancelado_em, a.notas,
                       m.id AS medico_id, m.nome AS medico_nome, m.crm,
                       u.email AS medico_email,
                       COALESCE(SUM(pm.valor) FILTER (WHERE pm.status='confirmado'), 0) AS total_pago,
                       COUNT(pm.id) FILTER (WHERE pm.status='confirmado') AS pagamentos_confirmados,
                       a.asaas_subscription_id,
                       m.cpf
                FROM assinaturas a
                JOIN medicos m ON m.id = a.medico_id
                JOIN usuarios u ON u.id = m.usuario_id
                LEFT JOIN pagamentos_manuais pm ON pm.assinatura_id = a.id
                GROUP BY a.id, m.id, u.email
                ORDER BY a.status, m.nome").ToListAsync();
            return Results.Ok(rows);
        });

        g.MapPost("/assinaturas", async (
            [FromBody] CriarAssinaturaRequest req, AppDbContext db) =>
        {
            var planos = new[] { "pendente", "trial", "starter", "pro", "master", "enterprise" };
            var statuses = new[] { "pendente", "trial", "ativa", "suspensa", "cancelada" };
            if (!planos.Contains(req.Plano)) return Results.BadRequest(new { error = "plano invalido" });
            if (!statuses.Contains(req.Status)) return Results.BadRequest(new { error = "status invalido" });

            var id = Guid.NewGuid();
            await db.Database.ExecuteRawAsync(@"
                INSERT INTO assinaturas (id, medico_id, plano, valor_mensal, status, trial_ate, notas)
                VALUES ({0}, {1}, {2}, {3}, {4}, {5}, {6})
                ON CONFLICT (medico_id) DO UPDATE SET
                    plano = EXCLUDED.plano, valor_mensal = EXCLUDED.valor_mensal,
                    status = EXCLUDED.status, trial_ate = EXCLUDED.trial_ate,
                    notas = EXCLUDED.notas, atualizado_em = NOW()",
                id, req.MedicoId, req.Plano, req.ValorMensal, req.Status,
                (object?)req.TrialAte ?? DBNull.Value,
                (object?)req.Notas ?? DBNull.Value);

            return Results.Created($"/api/v1/admin/assinaturas/{id}", new { id });
        });

        g.MapPatch("/assinaturas/{id:guid}", async (
            Guid id, [FromBody] AtualizarAssinaturaRequest req, AppDbContext db, AsaasClient asaas) =>
        {
            // O gateway é a fronteira de confiança: valida os enums também aqui (o
            // front valida via Zod, mas chamada direta/bug não pode gravar um
            // plano/status fora do conjunto e corromper o cálculo de MRR).
            var planos = new[] { "pendente", "trial", "starter", "pro", "master", "enterprise" };
            var statuses = new[] { "pendente", "trial", "ativa", "suspensa", "cancelada" };
            if (req.Plano is not null && !planos.Contains(req.Plano)) return Results.BadRequest(new { error = "plano invalido" });
            if (req.Status is not null && !statuses.Contains(req.Status)) return Results.BadRequest(new { error = "status invalido" });

            // CPF do médico (opcional) — necessário p/ cobrança Asaas. Valida e grava
            // na tabela medicos (não há outra UI p/ editar CPF pós-onboarding).
            if (!string.IsNullOrWhiteSpace(req.Cpf))
            {
                if (!CpfValido(req.Cpf)) return Results.BadRequest(new { error = "cpf_invalido" });
                var cpfDigits = new string(req.Cpf.Where(char.IsDigit).ToArray());
                await db.Database.ExecuteRawAsync(@"
                    UPDATE medicos SET cpf = {1}
                    WHERE id = (SELECT medico_id FROM assinaturas WHERE id = {0})", id, cpfDigits);
            }

            // Cancelar o plano (status='cancelada') tem de encerrar a cobrança
            // recorrente no Asaas — senão o médico segue sendo cobrado de um plano
            // que o admin acredita cancelado (Fluxo A, ADR-034). 'suspensa' NÃO
            // cancela: é o status que o webhook usa em pagamento vencido e a
            // recorrência deve continuar. Cancela ANTES do UPDATE; se o Asaas não
            // confirmar, aborta para o banco não dizer "cancelada" com cobrança viva.
            var cancelarAsaas = string.Equals(req.Status, "cancelada", StringComparison.OrdinalIgnoreCase);
            string? subIdCancelado = null;
            if (cancelarAsaas)
            {
                var subId = await db.Database.ExecuteScalarAsync<string?>(
                    "SELECT asaas_subscription_id FROM assinaturas WHERE id = {0}", id);
                if (!string.IsNullOrWhiteSpace(subId))
                {
                    if (!asaas.Configurado)
                        return Results.Json(new { error = "asaas_nao_configurado" }, statusCode: 503);
                    var cancelou = await asaas.CancelarAssinaturaAsync(subId);
                    if (!cancelou)
                        return Results.Json(new { error = "asaas_cancelar_falhou", detalhe = "Não foi possível confirmar o cancelamento da cobrança no Asaas. Tente novamente." }, statusCode: 502);
                    subIdCancelado = subId;
                }
            }

            var ok = await db.Database.ExecuteRawAsync(@"
                UPDATE assinaturas SET
                    plano        = COALESCE({2}, plano),
                    valor_mensal = COALESCE({3}, valor_mensal),
                    status       = COALESCE({4}, status),
                    trial_ate    = COALESCE({5}, trial_ate),
                    notas        = COALESCE({6}, notas),
                    atualizado_em = NOW()
                WHERE id = {0}",
                id, id,
                (object?)req.Plano ?? DBNull.Value,
                (object?)req.ValorMensal ?? DBNull.Value,
                (object?)req.Status ?? DBNull.Value,
                (object?)req.TrialAte ?? DBNull.Value,
                (object?)req.Notas ?? DBNull.Value);

            if (ok == 0) return Results.NotFound();

            // Recorrência cancelada no Asaas → limpa o vínculo no banco.
            if (subIdCancelado is not null)
                await db.Database.ExecuteRawAsync(
                    "UPDATE assinaturas SET asaas_subscription_id = NULL, atualizado_em = NOW() WHERE id = {0}", id);

            return Results.NoContent();
        });

        // Registrar pagamento manual
        g.MapPost("/assinaturas/{id:guid}/pagamento", async (
            Guid id, [FromBody] RegistrarPagamentoRequest req, AppDbContext db) =>
        {
            var plano = await db.Database.ExecuteScalarAsync<string?>(
                "SELECT plano FROM assinaturas WHERE id = {0}", id);
            if (plano is null) return Results.NotFound();

            // O pagamento ATIVA a assinatura; se o plano ainda for 'pendente'/'trial', o
            // médico ficaria 'ativa' mas sem plano real → o FeatureGate (ADR-059) bloqueia
            // TODA a camada de IA do pagante. Exige um plano real ANTES de ativar (o admin
            // define o plano via PATCH /assinaturas/{id} primeiro). Evita "pagou e sem IA".
            var planosReais = new[] { "starter", "pro", "master", "enterprise" };
            if (!planosReais.Contains(plano))
                return Results.BadRequest(new
                {
                    error = "plano_nao_definido",
                    detalhe = "Defina o plano (Essencial/Pro/Master) na assinatura antes de registrar o pagamento — senão o médico ativa sem as features do plano.",
                });

            // INSERT do pagamento + ativação ATÔMICOS numa ÚNICA instrução (CTE
            // data-modifying): se fossem 2 comandos e o UPDATE falhasse, o pagamento
            // ficaria registrado com a assinatura ainda 'pendente' (lockout do médico que
            // pagou). Uma instrução só = tudo-ou-nada pelo Postgres. (O helper
            // ExecuteRawAsync não enlista cmd.Transaction, então BeginTransaction não serve.)
            // Ativa no 1º pagamento: trial (legado) OU pendente (ADR-055, default dos
            // signups). 'ativa'/'suspensa'/'cancelada' não são tocados.
            var pagId = Guid.NewGuid();
            await db.Database.ExecuteRawAsync(@"
                WITH ins AS (
                    INSERT INTO pagamentos_manuais
                        (id, assinatura_id, valor, moeda, referencia, status, metodo, pago_em, notas)
                    VALUES ({0}, {1}, {2}, {3}, {4}, 'confirmado', {5}, {6}, {7})
                )
                UPDATE assinaturas SET status = 'ativa', atualizado_em = NOW()
                WHERE id = {1} AND status IN ('trial','pendente')",
                pagId, id, req.Valor, req.Moeda ?? "BRL",
                (object?)req.Referencia ?? DBNull.Value,
                (object?)req.Metodo ?? DBNull.Value,
                req.PagoEm ?? DateTime.UtcNow,
                (object?)req.Notas ?? DBNull.Value);

            return Results.Created($"/api/v1/admin/pagamentos/{pagId}", new { id = pagId });
        });

        // ── Cobrança recorrente do médico via Asaas (Fluxo A, ADR-034) ──────────
        // Plataforma cobra o médico (assinatura SaaS). Sem split, dinheiro direto.
        g.MapPost("/assinaturas/{id:guid}/cobranca-asaas", async (
            Guid id, AppDbContext db, AsaasClient asaas, ILoggerFactory loggerFactory) =>
        {
            var log = loggerFactory.CreateLogger("AdminEndpoints.CobrancaAsaas");
            if (!asaas.Configurado)
                return Results.Json(new { error = "asaas_nao_configurado" }, statusCode: 503);

            var row = await db.Database.SqlQueryRaw<AssinaturaAsaasRow>(@"
                SELECT a.id AS assinatura_id, a.valor_mensal, a.trial_ate,
                       a.asaas_customer_id, a.asaas_subscription_id,
                       m.id AS medico_id, m.nome AS medico_nome, m.cpf, m.wa_id AS telefone,
                       u.email AS medico_email, a.plano, a.status
                FROM assinaturas a
                JOIN medicos m ON m.id = a.medico_id
                JOIN usuarios u ON u.id = m.usuario_id
                WHERE a.id = {0}", id).FirstOrDefaultAsync();
            if (row is null) return Results.NotFound();
            if (!string.IsNullOrWhiteSpace(row.AsaasSubscriptionId))
                return Results.Conflict(new { error = "ja_ativa", subscriptionId = row.AsaasSubscriptionId });
            if (row.ValorMensal <= 0)
                return Results.BadRequest(new { error = "valor_mensal_zero" });
            if (string.IsNullOrWhiteSpace(row.Cpf))
                return Results.BadRequest(new { error = "medico_sem_cpf" });

            // 1) Customer do médico (cria só se ainda não tem).
            var customerId = row.AsaasCustomerId;
            if (string.IsNullOrWhiteSpace(customerId))
            {
                var cust = await asaas.CriarCustomerAsync(
                    row.MedicoId.ToString(), row.MedicoNome, row.Cpf, row.MedicoEmail, row.Telefone);
                if (!cust.Sucesso)
                {
                    // Log interno preserva o erro cru do Asaas p/ ops; o body NÃO o expõe
                    // (pode ecoar CPF/email do médico — LGPD categoria especial).
                    log.LogWarning("Falha ao criar customer Asaas (assinatura {AssinaturaId}): {Erro}", id, cust.Erro);
                    return Results.Json(new
                    {
                        error = "asaas_customer_falhou",
                        detalhe = "Não foi possível ativar a cobrança no Asaas agora. Confira os dados de cadastro do médico e tente novamente em instantes.",
                    }, statusCode: 502);
                }
                customerId = cust.CustomerId;
                await db.Database.ExecuteRawAsync(
                    "UPDATE assinaturas SET asaas_customer_id = {1}, atualizado_em = NOW() WHERE id = {0}", id, customerId!);
            }

            // 2) Assinatura recorrente. 1ª cobrança quando o trial acabar (ou hoje).
            var hoje = DateOnly.FromDateTime(DateTime.UtcNow);
            var proximo = row.TrialAte is { } t && DateOnly.FromDateTime(t) > hoje
                ? DateOnly.FromDateTime(t) : hoje;
            var desc = $"Assinatura Cérebro Amigo — {row.MedicoNome}";
            // Cadência + valor do CICLO pelo catálogo (ADR-059: Essencial/Pro/Master são
            // mensais → ValorCiclo == mensalidade). Fallback legado: MONTHLY com o
            // valor_mensal armazenado (planos fora do catálogo). O arg `cycle` segue
            // existindo p/ reativar cadência trimestral no futuro sem mudar a assinatura.
            var planoCat = PlanCatalog.TryGet(row.Plano);
            var valorCobranca = planoCat?.ValorCiclo ?? row.ValorMensal;
            var cycle = planoCat?.Cycle ?? "MONTHLY";
            var sub = await asaas.CriarAssinaturaAsync(customerId!, valorCobranca, proximo, desc, id.ToString(), cycle);
            if (!sub.Sucesso)
            {
                // Erro cru do Asaas fica só no log interno; o body devolve texto fixo pt-BR.
                log.LogWarning("Falha ao criar assinatura Asaas (assinatura {AssinaturaId}): {Erro}", id, sub.Erro);
                return Results.Json(new
                {
                    error = "asaas_assinatura_falhou",
                    detalhe = "Não foi possível ativar a assinatura no Asaas agora. Tente novamente em instantes.",
                }, statusCode: 502);
            }

            await db.Database.ExecuteRawAsync(
                "UPDATE assinaturas SET asaas_subscription_id = {1}, atualizado_em = NOW() WHERE id = {0}", id, sub.SubscriptionId!);

            return Results.Ok(new { subscriptionId = sub.SubscriptionId, invoiceUrl = sub.InvoiceUrl });
        });

        // Cancela a cobrança recorrente do médico no Asaas.
        g.MapDelete("/assinaturas/{id:guid}/cobranca-asaas", async (
            Guid id, AppDbContext db, AsaasClient asaas) =>
        {
            var subId = await db.Database.ExecuteScalarAsync<string?>(
                "SELECT asaas_subscription_id FROM assinaturas WHERE id = {0}", id);
            if (string.IsNullOrWhiteSpace(subId))
                return Results.NotFound(new { error = "sem_assinatura_asaas" });
            if (!asaas.Configurado)
                return Results.Json(new { error = "asaas_nao_configurado" }, statusCode: 503);
            // Só limpa o vínculo se o Asaas confirmar o cancelamento — senão o banco
            // diria "sem cobrança" enquanto a recorrência segue viva e cobrando.
            var cancelou = await asaas.CancelarAssinaturaAsync(subId);
            if (!cancelou)
                return Results.Json(new { error = "asaas_cancelar_falhou", detalhe = "Não foi possível confirmar o cancelamento da cobrança no Asaas. Tente novamente." }, statusCode: 502);
            await db.Database.ExecuteRawAsync(
                "UPDATE assinaturas SET asaas_subscription_id = NULL, atualizado_em = NOW() WHERE id = {0}", id);
            return Results.NoContent();
        });

        // Histórico de pagamentos de uma assinatura
        g.MapGet("/assinaturas/{id:guid}/pagamentos", async (Guid id, AppDbContext db) =>
        {
            var rows = await db.Database.SqlQueryRaw<PagamentoAdmin>(@"
                SELECT id, valor, moeda, referencia, status, metodo, pago_em, notas, criado_em
                FROM pagamentos_manuais
                WHERE assinatura_id = {0}
                ORDER BY pago_em DESC NULLS LAST", id).ToListAsync();
            return Results.Ok(rows);
        });

        // ─── Cockpit de Aquisição — Check-up Mental (ADR-046 / ADR-050) ─────────
        // Lado CLÍNICO da métrica norte ("médicos por 1.000 testes"). Lê só o schema
        // `public` (medicos/assinaturas). O funil do lado paciente vem do próprio
        // Check-up (endpoint /api/funnel-metrics) e o BFF junta as duas fontes —
        // o gateway NÃO lê o schema `checkup` (isolamento clínico ⇄ checkup, ADR-042/0036).
        g.MapGet("/aquisicao", async (AppDbContext db) =>
        {
            // Médicos por origem de cadastro (admin | self | checkup | legado)
            var porOrigem = await db.Database.SqlQueryRaw<OrigemRow>(@"
                SELECT COALESCE(signup_source, 'legado') AS origem, COUNT(*)::int AS n
                FROM medicos GROUP BY 1 ORDER BY 2 DESC").ToListAsync();

            // Médicos vindos do Check-up, por status de assinatura
            var porStatus = await db.Database.SqlQueryRaw<StatusRow>(@"
                SELECT COALESCE(a.status, 'sem_assinatura') AS status, COUNT(*)::int AS n
                FROM medicos m
                LEFT JOIN assinaturas a ON a.medico_id = m.id
                WHERE m.signup_source = 'checkup'
                GROUP BY 1 ORDER BY 2 DESC").ToListAsync();

            var total = await db.Database.ExecuteScalarAsync<int?>(
                "SELECT COUNT(*)::int FROM medicos WHERE signup_source = 'checkup'") ?? 0;
            var ativos = await db.Database.ExecuteScalarAsync<int?>(
                "SELECT COUNT(*)::int FROM medicos m JOIN assinaturas a ON a.medico_id = m.id " +
                "WHERE m.signup_source = 'checkup' AND a.status = 'ativa'") ?? 0;
            var emTrial = await db.Database.ExecuteScalarAsync<int?>(
                "SELECT COUNT(*)::int FROM medicos m JOIN assinaturas a ON a.medico_id = m.id " +
                "WHERE m.signup_source = 'checkup' AND a.status = 'trial'") ?? 0;
            var ridsAtribuidos = await db.Database.ExecuteScalarAsync<int?>(
                "SELECT COUNT(DISTINCT checkup_rid)::int FROM medicos " +
                "WHERE checkup_rid IS NOT NULL AND signup_source = 'checkup'") ?? 0;

            // Cadastros vindos do Check-up por mês (12m, fronteira no fuso de Brasília)
            var cadastrosPorMes = await db.Database.SqlQueryRaw<CadastroMesRow>(@"
                SELECT to_char(date_trunc('month', criado_em AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM') AS mes,
                       COUNT(*)::int AS n
                FROM medicos
                WHERE signup_source = 'checkup' AND criado_em >= (NOW() - INTERVAL '12 months')
                GROUP BY 1 ORDER BY 1").ToListAsync();

            // Drill-down: últimos médicos atribuídos ao Check-up (nome = dado profissional)
            var recentes = await db.Database.SqlQueryRaw<MedicoCheckupRow>(@"
                SELECT m.nome AS medico_nome, COALESCE(a.status, 'sem_assinatura') AS status,
                       m.checkup_rid AS rid, m.criado_em AS criado_em
                FROM medicos m
                LEFT JOIN assinaturas a ON a.medico_id = m.id
                WHERE m.signup_source = 'checkup'
                ORDER BY m.criado_em DESC
                LIMIT 50").ToListAsync();

            return Results.Ok(new
            {
                porOrigem,
                checkup = new
                {
                    total,
                    ativos,
                    emTrial,
                    ridsAtribuidos,
                    porStatus,
                    cadastrosPorMes,
                    recentes,
                },
            });
        });
    }

    // Validação de CPF (dígitos verificadores) — espelha lib/cpf do front.
    private static bool CpfValido(string? cpf)
    {
        if (string.IsNullOrWhiteSpace(cpf)) return false;
        var d = new string(cpf.Where(char.IsDigit).ToArray());
        if (d.Length != 11 || d.Distinct().Count() == 1) return false;
        int Soma(int len) { var s = 0; for (var i = 0; i < len; i++) s += (d[i] - '0') * (len + 1 - i); return s; }
        int Dig(int soma) { var r = soma % 11; return r < 2 ? 0 : 11 - r; }
        return Dig(Soma(9)) == d[9] - '0' && Dig(Soma(10)) == d[10] - '0';
    }

}

// ─── DTOs ──────────────────────────────────────────────────────────────────────

public record OnboardingMedicoRequest(
    string Nome, string Email, string Crm, string? Plano, decimal? ValorMensal,
    string? CrmUf, string? Cpf);

public record EditarUsuarioRequest(string? Nome, string? Email);

public record CustoMes(
    DateOnly Mes, string Agente,
    int Execucoes, int? TokensInTotal, int? TokensOutTotal, decimal CustoTotalUsd);

public record AgenteSaude(
    string Agente, int Total, int Sucessos, int Falhas, int EmAberto,
    decimal? LatenciaMediaMs, decimal? LatenciaP95Ms, decimal CustoUsdTotal, DateTime? UltimoRun);

public record AgenteErro(string Agente, string? Erro, DateTime IniciadoEm);

public record MedicoPerfil(
    Guid Id, string Nome, string? Crm, string? CrmUf, string? Cpf, string? Especialidade, string? Timezone,
    string? CrmSituacao, DateTime? CrmValidadoEm, string? CrmNomeCfm, DateTime CriadoEm,
    string Email, DateTime? UltimoLogin,
    string? Plano, decimal? ValorMensal, string? Moeda, string? StatusAssinatura, DateTime? TrialAte, DateTime? InicioEm,
    int TotalPacientes, int MensagensRecentes, int TotalConsultas, int CrisesTotal, int CheckinsRespondidos,
    decimal CustoConversaUsd, decimal CustoAgentesUsd);

public record UsuarioAdmin(
    Guid Id, string Nome, string Email, string Role, DateTime? UltimoLogin,
    Guid? MedicoId, string? Crm, string? Especialidade,
    string? PlanoAssinatura, string? StatusAssinatura, DateTime? DesativadoEm);

public record AssinaturaAdmin(
    Guid Id, string Plano, decimal ValorMensal, string Moeda, string Status,
    DateTime? TrialAte, DateTime InicioEm, DateTime? CanceladoEm, string? Notas,
    Guid MedicoId, string? MedicoNome, string? Crm, string? MedicoEmail,
    decimal TotalPago, long PagamentosConfirmados, string? AsaasSubscriptionId, string? Cpf);

public record PagamentoAdmin(
    Guid Id, decimal Valor, string Moeda, string? Referencia,
    string Status, string? Metodo, DateTime? PagoEm, string? Notas, DateTime CriadoEm);

public record CriarUsuarioAdminRequest(string Nome, string Email, string Senha, string? Role);
public record TrocarSenhaAdminRequest(string NovaSenha);
public record MudarRoleRequest(string Role);
public record CriarAssinaturaRequest(
    Guid MedicoId, string Plano, decimal ValorMensal, string Status,
    DateTime? TrialAte, string? Notas);
public record AtualizarAssinaturaRequest(
    string? Plano, decimal? ValorMensal, string? Status,
    DateTime? TrialAte, string? Notas, string? Cpf);
public record RegistrarPagamentoRequest(
    decimal Valor, string? Moeda, string? Referencia,
    string? Metodo, DateTime? PagoEm, string? Notas);

public record AssinaturaAsaasRow(
    Guid AssinaturaId, decimal ValorMensal, DateTime? TrialAte,
    string? AsaasCustomerId, string? AsaasSubscriptionId,
    Guid MedicoId, string MedicoNome, string? Cpf, string? Telefone, string MedicoEmail,
    string? Plano = null, string? Status = null);

// ── Cockpit de receita ──
public record MrrPlanoRow(string Plano, int Quantidade, decimal Valor);
public record ReceitaMesRow(string Mes, decimal Valor, int Pagamentos);
public record InadimplenteRow(
    Guid AssinaturaId, Guid MedicoId, string? MedicoNome, string? MedicoEmail,
    decimal ValorMensal, DateTime Desde);
public record TrialRow(Guid AssinaturaId, Guid MedicoId, string? MedicoNome, DateTime? TrialAte);
public record PendenteRow(
    Guid AssinaturaId, Guid MedicoId, string? MedicoNome, decimal ValorMensal, DateTime? PrazoPagamentoAte);
public record ReconAssinaturaRow(
    Guid AssinaturaId, Guid MedicoId, string? MedicoNome, string StatusLocal, string? AsaasSubscriptionId);
public record CobravelRow(
    Guid AssinaturaId, Guid MedicoId, string? MedicoNome, decimal ValorMensal, string? Cpf);

// ── Cockpit de aquisição (Check-up Mental — ADR-046/ADR-050) ──
public record OrigemRow(string Origem, int N);
public record StatusRow(string Status, int N);
public record CadastroMesRow(string Mes, int N);
public record MedicoCheckupRow(string? MedicoNome, string Status, string? Rid, DateTime CriadoEm);

// ── Sala de supervisão de crise (metadados, sem conteúdo clínico) ──
public record CriseEventoRow(
    Guid Id, DateTime CriadoEm, string? MedicoNome, string Origem, string Gatilho,
    double Confianca, bool MedicoNotificado, DateTime? MedicoNotificadoEm, bool AutomacaoPausada);

// ── Trilha de acesso (LGPD art.37) ──
public record AcessoRow(
    Guid Id, DateTime CriadoEm, string Recurso, string? MedicoNome,
    string? PacienteNome, bool AcessoCruzado);

// ── Solicitações de direitos do titular (LGPD) ──
public record SolicitacaoRow(
    Guid Id, string Identificacao, string Tipo, string Status, string? Notas,
    DateTime CriadoEm, DateTime? AtendidoEm, string? CriadoPorNome,
    string? AtendidoPorNome, string? PacienteNome);
public record CriarSolicitacaoRequest(string Identificacao, string Tipo, string? Notas);
public record AtualizarSolicitacaoRequest(string? Status, string? Notas);

