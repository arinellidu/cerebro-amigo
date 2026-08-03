using ApiGateway.Data;
using ApiGateway.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace ApiGateway.Endpoints;

/// <summary>
/// Cobranças do médico ao paciente (Fluxo B, ADR-033) via Asaas (Pix). Transacional
/// puro — a IA não toca. Tenant: paciente sempre validado por JOIN pacientes
/// (medico_responsavel_id). A cobrança LEGAL vive no Asaas; aqui é espelho +
/// orquestração. Webhook do Asaas confirma o pagamento (idempotente por asaas id).
/// </summary>
public static class CobrancasEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/cobrancas").WithTags("cobrancas").RequireAuthorization();

        // Médico cria cobrança Pix para um paciente seu.
        g.MapPost("", async (
            [FromBody] CriarCobrancaRequest req, AppDbContext db, AsaasClient asaas, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();
            if (req.Valor <= 0) return Results.BadRequest(new { error = "valor_invalido" });
            if (!asaas.Configurado) return Results.Json(new { error = "asaas_nao_configurado" }, statusCode: 503);

            // Tenant: o paciente é do médico? (1ª cláusula)
            var pac = await db.Database.SqlQueryRaw<PacienteCobranca>(@"
                SELECT c.id AS paciente_id, c.nome, c.email, c.wa_id AS telefone, p.cpf
                FROM clientes c
                JOIN pacientes p ON p.cliente_id = c.id
                WHERE c.id = {0} AND p.medico_responsavel_id = {1}",
                req.PacienteId, medicoId.Value).FirstOrDefaultAsync();
            if (pac is null) return Results.NotFound(new { error = "paciente_nao_encontrado" });

            var cfg = await db.Database.SqlQueryRaw<AsaasMedicoCfg>(@"
                SELECT asaas_wallet_id AS wallet_id, split_percentual AS fee_pct
                FROM medico_asaas_config WHERE medico_id = {0}",
                medicoId.Value).FirstOrDefaultAsync();

            var cobrancaId = Guid.NewGuid();
            var venc = req.Vencimento ?? DateOnly.FromDateTime(DateTime.UtcNow).AddDays(3);
            var desc = string.IsNullOrWhiteSpace(req.Descricao) ? "Consulta" : req.Descricao!.Trim();

            await db.Database.ExecuteRawAsync(@"
                INSERT INTO cobrancas
                    (id, medico_id, paciente_id, consulta_id, descricao, valor, metodo, status, vencimento)
                VALUES ({0}, {1}, {2}, {3}, {4}, {5}, 'pix', 'pendente', {6})",
                cobrancaId, medicoId.Value, req.PacienteId,
                (object?)req.ConsultaId ?? DBNull.Value, desc, req.Valor, venc);

            var res = await asaas.CriarCobrancaPixAsync(new AsaasCobrancaInput(
                cobrancaId.ToString(), pac.PacienteId.ToString(), pac.Nome ?? "Paciente",
                pac.Cpf, pac.Email, pac.Telefone, req.Valor, venc, desc,
                cfg?.WalletId, cfg?.FeePct ?? 0m));

            if (!res.Sucesso)
            {
                await db.Database.ExecuteRawAsync(
                    "UPDATE cobrancas SET status = 'erro_gateway', atualizado_em = NOW() WHERE id = {0}", cobrancaId);
                return Results.Json(new { error = "asaas_falhou", detalhe = res.Erro }, statusCode: 502);
            }

            await db.Database.ExecuteRawAsync(@"
                UPDATE cobrancas SET
                    asaas_cobranca_id = {1}, asaas_invoice_url = {2},
                    pix_copia_cola = {3}, pix_qr_base64 = {4}, atualizado_em = NOW()
                WHERE id = {0}",
                cobrancaId, res.AsaasId, (object?)res.InvoiceUrl ?? DBNull.Value,
                (object?)res.PixCopiaCola ?? DBNull.Value, (object?)res.PixQrBase64 ?? DBNull.Value);

            return Results.Ok(new
            {
                id = cobrancaId, valor = req.Valor, vencimento = venc, status = "pendente",
                invoiceUrl = res.InvoiceUrl, pixCopiaCola = res.PixCopiaCola, pixQrBase64 = res.PixQrBase64,
            });
        });

        // Lista de cobranças do médico (default: todas, recentes primeiro).
        g.MapGet("", async ([FromQuery] string? status, AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            var rows = await db.Database.SqlQueryRaw<CobrancaItem>(@"
                SELECT co.id, co.descricao, co.valor, co.metodo, co.status, co.vencimento,
                       co.pago_em, co.asaas_invoice_url, co.nfse_status, co.nfse_url,
                       co.paciente_id, c.nome AS paciente_nome
                FROM cobrancas co
                JOIN clientes c ON c.id = co.paciente_id
                JOIN pacientes p ON p.cliente_id = co.paciente_id
                WHERE p.medico_responsavel_id = {0}
                  AND ({1} = '' OR co.status = {1})
                ORDER BY co.criado_em DESC
                LIMIT 200",
                medicoId.Value, status ?? "").ToListAsync();
            return Results.Ok(rows);
        });

        // Resumo financeiro + ROI (cockpit de monetização).
        app.MapGet("/api/v1/financeiro/resumo", async (AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            var r = await db.Database.SqlQueryRaw<FinanceiroResumo>(@"
                WITH cob AS (
                  SELECT co.* FROM cobrancas co
                  JOIN pacientes p ON p.cliente_id = co.paciente_id
                  WHERE p.medico_responsavel_id = {0}
                )
                SELECT
                  COALESCE((SELECT SUM(valor) FROM cob
                            WHERE status = 'pago'
                              AND date_trunc('month', pago_em) = date_trunc('month', NOW())), 0) AS recebido_mes,
                  COALESCE((SELECT SUM(valor) FROM cob WHERE status = 'pendente'), 0) AS pendente_total,
                  COALESCE((SELECT SUM(valor) FROM cob
                            WHERE status = 'pendente' AND vencimento < CURRENT_DATE), 0) AS vencido_total,
                  (SELECT COUNT(*) FROM cob WHERE status = 'pago'
                     AND date_trunc('month', pago_em) = date_trunc('month', NOW()))::int AS pagas_mes,
                  (SELECT COUNT(*) FROM cob
                     WHERE date_trunc('month', criado_em) = date_trunc('month', NOW()))::int AS emitidas_mes,
                  (SELECT COUNT(*) FROM pacientes p2
                     WHERE p2.medico_responsavel_id = {0}
                       AND NOT EXISTS (
                         SELECT 1 FROM consultas k
                         WHERE k.paciente_id = p2.cliente_id AND k.status = 'realizada'
                           AND k.inicia_em > NOW() - INTERVAL '90 days'))::int AS pacientes_inativos
                ",
                medicoId.Value).FirstAsync();
            return Results.Ok(r);
        }).WithTags("cobrancas").RequireAuthorization();

        // ── Médico: minha assinatura da plataforma (Fluxo A, ADR-034). ──
        // Status + valor + link p/ pagar (invoiceUrl do Asaas) + histórico.
        app.MapGet("/api/v1/minha-assinatura", async (AppDbContext db, AsaasClient asaas, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            var a = await db.Database.SqlQueryRaw<MinhaAssinatura>(@"
                SELECT plano, valor_mensal, moeda, status, trial_ate, prazo_pagamento_ate, asaas_subscription_id
                FROM assinaturas WHERE medico_id = {0}", medicoId.Value).FirstOrDefaultAsync();
            if (a is null) return Results.NotFound(new { error = "sem_assinatura" });

            // ADR-055: situação de acesso (liberado/bloqueado/prazo). Exposto p/ a UI;
            // o enforcement (gate) vem na Fase D. Não bloqueia nada aqui.
            var sit = AssinaturaGate.Avaliar(a.Status, a.PrazoPagamentoAte, a.TrialAte, DateTime.UtcNow);

            string? invoiceUrl = null;
            if (!string.IsNullOrWhiteSpace(a.AsaasSubscriptionId) && asaas.Configurado)
                invoiceUrl = await asaas.ObterLinkAtualAsync(a.AsaasSubscriptionId);

            var pagamentos = await db.Database.SqlQueryRaw<PagamentoMedico>(@"
                SELECT pm.valor, pm.referencia, pm.metodo, pm.pago_em
                FROM pagamentos_manuais pm
                JOIN assinaturas s ON s.id = pm.assinatura_id
                WHERE s.medico_id = {0} AND pm.status = 'confirmado'
                ORDER BY pm.pago_em DESC NULLS LAST LIMIT 24", medicoId.Value).ToListAsync();

            return Results.Ok(new
            {
                plano = a.Plano, valorMensal = a.ValorMensal, moeda = a.Moeda,
                status = a.Status, trialAte = a.TrialAte,
                prazoPagamentoAte = a.PrazoPagamentoAte,
                liberado = sit.Liberado, emPrazo = sit.EmPrazo,
                diasRestantes = sit.DiasRestantes, motivo = sit.Motivo,
                cobrancaAtiva = !string.IsNullOrWhiteSpace(a.AsaasSubscriptionId),
                invoiceUrl, pagamentos,
            });
        }).WithTags("cobrancas").RequireAuthorization();

        // ── Médico: self-checkout (ADR-055 Fase C). Escolhe plano → garante customer +
        // cria subscription Asaas p/ a PRÓPRIA assinatura → devolve invoiceUrl. Reusa o
        // motor do Fluxo A (ADR-034); aqui é o médico se cobrando, não o admin. NÃO é
        // gateado pelo paywall (médico bloqueado precisa poder pagar). Valor vem do
        // catálogo server-side — nunca do cliente.
        app.MapPost("/api/v1/minha-assinatura/cobranca", async (
            [FromBody] SelfCheckoutRequest req, AppDbContext db, AsaasClient asaas,
            ClaimsPrincipal user, ILoggerFactory lf) =>
        {
            var log = lf.CreateLogger("Cobrancas.SelfCheckout");
            if (!asaas.Configurado)
                return Results.Json(new { error = "asaas_nao_configurado" }, statusCode: 503);

            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            // Catálogo server-side (PlanCatalog, ADR-059). Self-checkout dos 2 planos
            // self-serve (Essencial + Pro). Clínica (futura, multi-médico) não é
            // self-checkout → "fale com a equipe".
            var plano = PlanCatalog.TryGet(req?.Plano);
            if (plano is null)
                return Results.BadRequest(new { error = "plano_invalido", planos = PlanCatalog.CodigosSelfCheckout });
            if (!plano.SelfCheckout)
                return Results.BadRequest(new { error = "plano_indisponivel_self_checkout" });

            var row = await db.Database.SqlQueryRaw<AssinaturaAsaasRow>(@"
                SELECT a.id AS assinatura_id, a.valor_mensal, a.trial_ate,
                       a.asaas_customer_id, a.asaas_subscription_id,
                       m.id AS medico_id, m.nome AS medico_nome, m.cpf, m.wa_id AS telefone,
                       u.email AS medico_email, a.plano, a.status
                FROM assinaturas a
                JOIN medicos m ON m.id = a.medico_id
                JOIN usuarios u ON u.id = m.usuario_id
                WHERE a.medico_id = {0}", medicoId.Value).FirstOrDefaultAsync();
            if (row is null) return Results.NotFound(new { error = "sem_assinatura" });
            // Já tem subscription OU já está ativa/suspensa → não cria 2ª cobrança.
            // "suspensa" = inadimplente com subscription ainda viva no Asaas;
            // criar nova aqui geraria duplicata. Deve reativar via painel Asaas.
            if (!string.IsNullOrWhiteSpace(row.AsaasSubscriptionId)
                || row.Status is "ativa" or "suspensa")
                return Results.Conflict(new { error = "ja_ativa", subscriptionId = row.AsaasSubscriptionId });
            if (string.IsNullOrWhiteSpace(row.Cpf))
                return Results.BadRequest(new { error = "cpf_obrigatorio" });

            // Plano + valor da escolha (catálogo). Server-side, não confia no cliente.
            // valor_mensal = mensalidade-equivalente (MRR coerente); o valor do ciclo
            // (igual à mensalidade no Inicial MONTHLY) vai pro Asaas abaixo.
            await db.Database.ExecuteRawAsync(
                "UPDATE assinaturas SET plano = {1}, valor_mensal = {2}, atualizado_em = NOW() WHERE id = {0}",
                row.AssinaturaId, plano.Codigo, plano.ValorMensalEquivalente);

            var customerId = row.AsaasCustomerId;
            if (string.IsNullOrWhiteSpace(customerId))
            {
                var cust = await asaas.CriarCustomerAsync(
                    row.MedicoId.ToString(), row.MedicoNome, row.Cpf, row.MedicoEmail, row.Telefone);
                if (!cust.Sucesso)
                {
                    log.LogWarning("Self-checkout: customer Asaas falhou (medico {MedicoId}): {Erro}", medicoId, cust.Erro);
                    return Results.Json(new { error = "asaas_customer_falhou", detalhe = "Não foi possível iniciar a cobrança agora. Confira seus dados e tente em instantes." }, statusCode: 502);
                }
                customerId = cust.CustomerId;
                await db.Database.ExecuteRawAsync(
                    "UPDATE assinaturas SET asaas_customer_id = {1}, atualizado_em = NOW() WHERE id = {0}", row.AssinaturaId, customerId!);
            }

            var hoje = DateOnly.FromDateTime(DateTime.UtcNow);
            var desc = $"Assinatura Cérebro Amigo — {row.MedicoNome}";
            var sub = await asaas.CriarAssinaturaAsync(customerId!, plano.ValorCiclo, hoje, desc, row.AssinaturaId.ToString(), plano.Cycle);
            if (!sub.Sucesso)
            {
                log.LogWarning("Self-checkout: assinatura Asaas falhou (medico {MedicoId}): {Erro}", medicoId, sub.Erro);
                return Results.Json(new { error = "asaas_assinatura_falhou", detalhe = "Não foi possível ativar a assinatura agora. Tente novamente em instantes." }, statusCode: 502);
            }
            await db.Database.ExecuteRawAsync(
                "UPDATE assinaturas SET asaas_subscription_id = {1}, atualizado_em = NOW() WHERE id = {0}", row.AssinaturaId, sub.SubscriptionId!);

            return Results.Ok(new { subscriptionId = sub.SubscriptionId, invoiceUrl = sub.InvoiceUrl });
        }).WithTags("cobrancas").RequireAuthorization();

        // ── Portal do paciente: vê as próprias cobranças (Pix p/ pagar). ──
        app.MapGet("/api/v1/portal/paciente/cobrancas", async (AppDbContext db, ClaimsPrincipal user) =>
        {
            var pid = PacienteAuthEndpoints.GetPacienteId(user);
            if (pid is null) return Results.Unauthorized();

            var rows = await db.Database.SqlQueryRaw<CobrancaPortal>(@"
                SELECT co.id, co.descricao, co.valor, co.status, co.vencimento,
                       co.asaas_invoice_url, co.pix_copia_cola, co.pix_qr_base64
                FROM cobrancas co
                WHERE co.paciente_id = {0} AND co.status IN ('pendente', 'vencido')
                ORDER BY co.vencimento",
                pid.Value).ToListAsync();
            return Results.Ok(rows);
        }).WithTags("portal-paciente").RequireAuthorization("paciente");

        // ── Webhook Asaas: confirma pagamento (sem JWT; valida token de header). ──
        app.MapPost("/api/v1/asaas/webhook", async (HttpRequest http, AppDbContext db, IConfiguration cfg) =>
        {
            var esperado = cfg["ASAAS_WEBHOOK_TOKEN"];
            if (string.IsNullOrWhiteSpace(esperado))
            {
                // Fail-closed (segurança): este endpoint é anônimo e altera estado
                // financeiro (confirma cobrança, ativa assinatura). Sem o token
                // configurado não opera. 503 faz o Asaas reenviar quando setado.
                return Results.Problem(
                    title: "Webhook indisponível: ASAAS_WEBHOOK_TOKEN não configurado",
                    statusCode: 503);
            }
            var recebido = http.Headers["asaas-access-token"].ToString();
            // Asaas NÃO assina o corpo (sem HMAC tipo Stripe; confirmado nos docs oficiais
            // 2026-06-20) — o access-token é a ÚNICA camada de auth deste endpoint anônimo
            // que altera estado financeiro. Comparação constante-time (timing-attack safe),
            // espelhando o INTERNAL_API_TOKEN (Program.cs). O token vem de env, nunca é logado.
            // Forja exige o token + um asaas_id válido; os UPDATE são escopados por asaas_id
            // (no-op se não casar) e o pagamento é idempotente (ON CONFLICT asaas_payment_id);
            // a reconciliação (/admin/asaas/reconciliacao) é o backstop contra divergência.
            if (!CryptographicOperations.FixedTimeEquals(
                    Encoding.UTF8.GetBytes(recebido), Encoding.UTF8.GetBytes(esperado)))
                return Results.Unauthorized();

            using var doc = await JsonDocument.ParseAsync(http.Body);
            var root = doc.RootElement;
            var evento = root.TryGetProperty("event", out var ev) ? ev.GetString() : null;

            // SUBSCRIPTION_DELETED: cancelamento direto via painel Asaas (sem payment payload).
            // Sem tratar, assinatura fica 'ativa' fantasma — paywall liberado sem cobrança.
            if (evento == "SUBSCRIPTION_DELETED" &&
                root.TryGetProperty("subscription", out var subObjDel) &&
                subObjDel.TryGetProperty("id", out var subIdDelEl))
            {
                var cancelSubId = subIdDelEl.GetString();
                if (!string.IsNullOrEmpty(cancelSubId))
                    await db.Database.ExecuteRawAsync(@"
                        UPDATE assinaturas SET status = 'cancelada', atualizado_em = NOW()
                        WHERE asaas_subscription_id = {0} AND status <> 'cancelada'", cancelSubId);
                return Results.Ok(new { ok = true });
            }

            if (!root.TryGetProperty("payment", out var pay) || !pay.TryGetProperty("id", out var idEl))
                return Results.Ok(new { ignored = true });
            var asaasId = idEl.GetString();

            string? novoStatus = evento switch
            {
                "PAYMENT_RECEIVED" or "PAYMENT_CONFIRMED" => "pago",
                "PAYMENT_OVERDUE" => "vencido",
                "PAYMENT_REFUNDED" => "estornado",
                "PAYMENT_DELETED" => "cancelado",
                _ => null,
            };
            if (novoStatus is null || string.IsNullOrEmpty(asaasId))
                return Results.Ok(new { ignored = true });

            // Fluxo B (legado): cobrança médico→paciente, casada por asaas_cobranca_id.
            if (novoStatus == "pago")
                await db.Database.ExecuteRawAsync(@"
                    UPDATE cobrancas SET status = 'pago', pago_em = COALESCE(pago_em, NOW()), atualizado_em = NOW()
                    WHERE asaas_cobranca_id = {0} AND status <> 'pago'", asaasId);
            else
                await db.Database.ExecuteRawAsync(@"
                    UPDATE cobrancas SET status = {1}, atualizado_em = NOW()
                    WHERE asaas_cobranca_id = {0} AND status NOT IN ('pago')", asaasId, novoStatus);

            // Fluxo A (ADR-034): pagamento de assinatura do médico, casado por subscription.
            var subId = pay.TryGetProperty("subscription", out var sb) ? sb.GetString() : null;
            if (!string.IsNullOrEmpty(subId))
            {
                if (novoStatus == "pago")
                {
                    var valor = pay.TryGetProperty("value", out var vv) && vv.TryGetDecimal(out var d) ? d : 0m;
                    var refMes = DateTime.UtcNow.ToString("yyyy-MM");
                    // Registra o pagamento (idempotente por asaas_payment_id) e ativa a assinatura.
                    await db.Database.ExecuteRawAsync(@"
                        INSERT INTO pagamentos_manuais
                            (id, assinatura_id, valor, moeda, referencia, status, metodo, pago_em, asaas_payment_id)
                        SELECT gen_random_uuid(), a.id, {2}, a.moeda, {3}, 'confirmado', 'asaas', NOW(), {1}
                        FROM assinaturas a WHERE a.asaas_subscription_id = {0}
                        ON CONFLICT (asaas_payment_id) DO NOTHING", subId, asaasId, valor, refMes);
                    await db.Database.ExecuteRawAsync(@"
                        UPDATE assinaturas SET status = 'ativa', atualizado_em = NOW()
                        WHERE asaas_subscription_id = {0} AND status <> 'cancelada'", subId);
                }
                else if (novoStatus == "vencido")
                {
                    await db.Database.ExecuteRawAsync(@"
                        UPDATE assinaturas SET status = 'suspensa', atualizado_em = NOW()
                        WHERE asaas_subscription_id = {0} AND status <> 'cancelada'", subId);
                }
                else if (novoStatus == "cancelado" || novoStatus == "estornado")
                {
                    // Sem isto, médico cancela/estorna no Asaas e a assinatura segue 'ativa'
                    // (fantasma): paywall liberado sem cobrança viva. Encerra o acesso.
                    await db.Database.ExecuteRawAsync(@"
                        UPDATE assinaturas SET status = 'cancelada', atualizado_em = NOW()
                        WHERE asaas_subscription_id = {0} AND status <> 'cancelada'", subId);
                }
            }

            return Results.Ok(new { ok = true });
        }).WithTags("cobrancas").AllowAnonymous();
    }

    private static async Task<Guid?> GetMedicoIdAsync(AppDbContext db, ClaimsPrincipal user)
    {
        var sub = user.FindFirst("sub")?.Value;
        if (!Guid.TryParse(sub, out var userId)) return null;
        return await db.Database.ExecuteScalarAsync<Guid?>(
            "SELECT id FROM medicos WHERE usuario_id = {0}", userId);
    }
}

public record CriarCobrancaRequest(Guid PacienteId, decimal Valor, string? Descricao, Guid? ConsultaId, DateOnly? Vencimento);

public record MinhaAssinatura(string Plano, decimal ValorMensal, string Moeda, string Status, DateTime? TrialAte, DateTime? PrazoPagamentoAte, string? AsaasSubscriptionId);
public record SelfCheckoutRequest(string? Plano);
public record PagamentoMedico(decimal Valor, string? Referencia, string? Metodo, DateTime? PagoEm);

public record CobrancaItem(
    Guid Id, string Descricao, decimal Valor, string Metodo, string Status, DateOnly? Vencimento,
    DateTime? PagoEm, string? AsaasInvoiceUrl, string NfseStatus, string? NfseUrl,
    Guid PacienteId, string? PacienteNome);

public record CobrancaPortal(
    Guid Id, string Descricao, decimal Valor, string Status, DateOnly? Vencimento,
    string? AsaasInvoiceUrl, string? PixCopiaCola, string? PixQrBase64);

public record FinanceiroResumo(
    decimal RecebidoMes, decimal PendenteTotal, decimal VencidoTotal,
    int PagasMes, int EmitidasMes, int PacientesInativos);

// `public` (não `file`): file-scoped quebra EF Core SqlQueryRaw<T> (efcore #30115/#32323).
public record PacienteCobranca(Guid PacienteId, string? Nome, string? Email, string? Telefone, string? Cpf);
public record AsaasMedicoCfg(string? WalletId, decimal FeePct);
