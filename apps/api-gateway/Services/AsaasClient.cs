using System.Net.Http.Json;
using System.Text.Json;

namespace ApiGateway.Services;

/// <summary>
/// Cliente HTTP tipado para o Asaas (gateway de pagamento BR — Pix/boleto/cartão).
///
/// Fluxo B (ADR-033): o MÉDICO cobra o PACIENTE pela consulta. A cobrança é criada
/// pela CONTA-MÃE (plataforma) com SPLIT para a `walletId` da subconta do médico —
/// o líquido cai pro médico, a plataforma fica com a taxa. O gateway só orquestra;
/// a cobrança LEGAL e a NFS-e vivem no Asaas.
///
/// Config (env):
///   ASAAS_API_KEY        (obrigatório — conta-mãe)
///   ASAAS_ENV            (sandbox|prod; default sandbox)
///   ASAAS_API_BASE       (override opcional)
///
/// Sem key configurada o gateway sobe normal — só os endpoints de cobrança
/// respondem erro claro (não derruba o serviço).
/// </summary>
public sealed class AsaasClient
{
    private readonly HttpClient _http;
    private readonly IConfiguration _cfg;
    private readonly ILogger<AsaasClient> _logger;

    public AsaasClient(HttpClient http, IConfiguration cfg, ILogger<AsaasClient> logger)
    {
        _http = http;
        _cfg = cfg;
        _logger = logger;
    }

    public bool Configurado => !string.IsNullOrWhiteSpace(_cfg["ASAAS_API_KEY"]);

    private (string apiKey, string baseUrl)? ResolveConfig()
    {
        var k = _cfg["ASAAS_API_KEY"];
        if (string.IsNullOrWhiteSpace(k)) return null;
        var explicitBase = _cfg["ASAAS_API_BASE"];
        var baseUrl = !string.IsNullOrWhiteSpace(explicitBase)
            ? explicitBase!.TrimEnd('/')
            : (string.Equals(_cfg["ASAAS_ENV"], "prod", StringComparison.OrdinalIgnoreCase)
                ? "https://api.asaas.com/v3"
                : "https://sandbox.asaas.com/api/v3");
        return (k, baseUrl);
    }

    private HttpRequestMessage Req(HttpMethod m, string baseUrl, string apiKey, string path, object? body = null)
    {
        var r = new HttpRequestMessage(m, $"{baseUrl}{path}");
        r.Headers.Add("access_token", apiKey);
        // Asaas exige User-Agent; o HttpClient do .NET não envia por padrão
        // (sem isso: 400 user_agent_not_informed).
        r.Headers.UserAgent.ParseAdd("CerebroAmigo-Gateway/1.0");
        if (body is not null) r.Content = JsonContent.Create(body);
        return r;
    }

    /// <summary>
    /// Cria (customer + cobrança Pix) e busca o QR/copia-e-cola. Com walletId +
    /// taxa da plataforma, aplica split (médico recebe o líquido).
    /// </summary>
    public async Task<AsaasCobrancaResult> CriarCobrancaPixAsync(AsaasCobrancaInput inp, CancellationToken ct = default)
    {
        var cfg = ResolveConfig();
        if (cfg is null) return AsaasCobrancaResult.Falha("ASAAS_API_KEY não configurada no gateway");
        var (apiKey, baseUrl) = cfg.Value;

        try
        {
            // 1) Customer (idempotência simples por externalReference = paciente_id).
            var custBody = new
            {
                name = inp.PacienteNome,
                cpfCnpj = string.IsNullOrWhiteSpace(inp.PacienteCpf) ? null : inp.PacienteCpf,
                email = inp.PacienteEmail,
                mobilePhone = inp.PacienteTelefone,
                externalReference = inp.PacienteId,
            };
            var custResp = await _http.SendAsync(Req(HttpMethod.Post, baseUrl, apiKey, "/customers", custBody), ct);
            var custJson = await custResp.Content.ReadAsStringAsync(ct);
            if (!custResp.IsSuccessStatusCode)
                return AsaasCobrancaResult.Falha($"Asaas customer {(int)custResp.StatusCode}: {Resumo(custJson)}");
            using var custDoc = JsonDocument.Parse(custJson);
            var customerId = custDoc.RootElement.GetProperty("id").GetString();

            // 2) Pagamento Pix (+ split opcional p/ a subconta do médico).
            object? split = null;
            if (!string.IsNullOrWhiteSpace(inp.WalletId) && inp.PlataformaFeePct < 100)
            {
                var medicoPct = Math.Round(100m - inp.PlataformaFeePct, 2);
                split = new[] { new { walletId = inp.WalletId, percentualValue = medicoPct } };
            }
            var payBody = new
            {
                customer = customerId,
                billingType = "PIX",
                value = inp.Valor,
                dueDate = inp.Vencimento.ToString("yyyy-MM-dd"),
                description = inp.Descricao,
                externalReference = inp.CobrancaId,
                split,
            };
            var payResp = await _http.SendAsync(Req(HttpMethod.Post, baseUrl, apiKey, "/payments", payBody), ct);
            var payJson = await payResp.Content.ReadAsStringAsync(ct);
            if (!payResp.IsSuccessStatusCode)
                return AsaasCobrancaResult.Falha($"Asaas payment {(int)payResp.StatusCode}: {Resumo(payJson)}");
            using var payDoc = JsonDocument.Parse(payJson);
            var pe = payDoc.RootElement;
            var asaasId = pe.GetProperty("id").GetString()!;
            var invoiceUrl = pe.TryGetProperty("invoiceUrl", out var iu) ? iu.GetString() : null;
            var status = pe.TryGetProperty("status", out var st) ? st.GetString() : "PENDING";

            // 3) QR Pix (copia-e-cola + imagem).
            string? copiaCola = null, qrBase64 = null;
            try
            {
                var qrResp = await _http.SendAsync(Req(HttpMethod.Get, baseUrl, apiKey, $"/payments/{asaasId}/pixQrCode"), ct);
                if (qrResp.IsSuccessStatusCode)
                {
                    using var qrDoc = JsonDocument.Parse(await qrResp.Content.ReadAsStringAsync(ct));
                    copiaCola = qrDoc.RootElement.TryGetProperty("payload", out var pl) ? pl.GetString() : null;
                    qrBase64 = qrDoc.RootElement.TryGetProperty("encodedImage", out var ei) ? ei.GetString() : null;
                }
            }
            catch (Exception ex) { _logger.LogWarning(ex, "Asaas pixQrCode falhou (segue sem QR)"); }

            return AsaasCobrancaResult.Ok(asaasId, invoiceUrl, copiaCola, qrBase64, status);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            _logger.LogError(ex, "Asaas inalcançável");
            return AsaasCobrancaResult.Falha($"Asaas inalcançável: {ex.Message}");
        }
        catch (JsonException ex)
        {
            _logger.LogError(ex, "Asaas resposta inválida");
            return AsaasCobrancaResult.Falha("Asaas retornou resposta inesperada");
        }
    }

    // ─── Fluxo A: a plataforma cobra o MÉDICO (assinatura recorrente, sem split) ──

    /// <summary>
    /// Cria o customer do médico no Asaas. Idempotência fica no call-site (só cria
    /// se a assinatura ainda não tem asaas_customer_id).
    /// </summary>
    public async Task<AsaasCustomerResult> CriarCustomerAsync(
        string medicoId, string nome, string? cpfCnpj, string? email, string? telefone, CancellationToken ct = default)
    {
        var cfg = ResolveConfig();
        if (cfg is null) return AsaasCustomerResult.Falha("ASAAS_API_KEY não configurada no gateway");
        var (apiKey, baseUrl) = cfg.Value;
        try
        {
            var body = new
            {
                name = nome,
                cpfCnpj = string.IsNullOrWhiteSpace(cpfCnpj) ? null : cpfCnpj,
                email,
                mobilePhone = telefone,
                externalReference = medicoId,
            };
            var resp = await _http.SendAsync(Req(HttpMethod.Post, baseUrl, apiKey, "/customers", body), ct);
            var json = await resp.Content.ReadAsStringAsync(ct);
            if (!resp.IsSuccessStatusCode)
                return AsaasCustomerResult.Falha($"Asaas customer {(int)resp.StatusCode}: {Resumo(json)}");
            using var doc = JsonDocument.Parse(json);
            return AsaasCustomerResult.Ok(doc.RootElement.GetProperty("id").GetString()!);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            _logger.LogError(ex, "Asaas inalcançável (customer médico)");
            return AsaasCustomerResult.Falha($"Asaas inalcançável: {ex.Message}");
        }
        catch (JsonException) { return AsaasCustomerResult.Falha("Asaas retornou resposta inesperada"); }
    }

    /// <summary>
    /// Cria a assinatura recorrente mensal (billingType UNDEFINED → médico escolhe
    /// pix/boleto/cartão). SEM split. Devolve o id + o link da 1ª cobrança.
    /// </summary>
    public async Task<AsaasAssinaturaResult> CriarAssinaturaAsync(
        string customerId, decimal valor, DateOnly proximoVencimento, string descricao,
        string externalReference, string cycle = "MONTHLY", CancellationToken ct = default)
    {
        var cfg = ResolveConfig();
        if (cfg is null) return AsaasAssinaturaResult.Falha("ASAAS_API_KEY não configurada no gateway");
        var (apiKey, baseUrl) = cfg.Value;
        try
        {
            var body = new
            {
                customer = customerId,
                billingType = "UNDEFINED",
                value = valor,
                nextDueDate = proximoVencimento.ToString("yyyy-MM-dd"),
                cycle, // MONTHLY (Inicial) | QUARTERLY (Consultoria — contrato 3 meses), ADR-055 Fase 2
                description = descricao,
                externalReference,
            };
            var resp = await _http.SendAsync(Req(HttpMethod.Post, baseUrl, apiKey, "/subscriptions", body), ct);
            var json = await resp.Content.ReadAsStringAsync(ct);
            if (!resp.IsSuccessStatusCode)
                return AsaasAssinaturaResult.Falha($"Asaas subscription {(int)resp.StatusCode}: {Resumo(json)}");
            using var doc = JsonDocument.Parse(json);
            var subId = doc.RootElement.GetProperty("id").GetString()!;
            var link = await PrimeiroLinkAsync(baseUrl, apiKey, subId, ct);
            return AsaasAssinaturaResult.Ok(subId, link);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            _logger.LogError(ex, "Asaas inalcançável (assinatura médico)");
            return AsaasAssinaturaResult.Falha($"Asaas inalcançável: {ex.Message}");
        }
        catch (JsonException) { return AsaasAssinaturaResult.Falha("Asaas retornou resposta inesperada"); }
    }

    /// <summary>Cancela a assinatura recorrente no Asaas.</summary>
    public async Task<bool> CancelarAssinaturaAsync(string subscriptionId, CancellationToken ct = default)
    {
        var cfg = ResolveConfig();
        if (cfg is null) return false;
        var (apiKey, baseUrl) = cfg.Value;
        try
        {
            var resp = await _http.SendAsync(Req(HttpMethod.Delete, baseUrl, apiKey, $"/subscriptions/{subscriptionId}"), ct);
            // 404 = assinatura já inexistente no Asaas (cancelada/expirada por fora):
            // cancelar é idempotente — o objetivo (não cobrar mais) já está atingido,
            // então tratamos como sucesso para o vínculo poder ser limpo no banco.
            if (resp.StatusCode == System.Net.HttpStatusCode.NotFound) return true;
            return resp.IsSuccessStatusCode;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            _logger.LogError(ex, "Asaas inalcançável (cancelar assinatura)");
            return false;
        }
    }

    /// <summary>
    /// Status atual da assinatura no Asaas (ACTIVE/EXPIRED/INACTIVE) — p/ reconciliação
    /// contra o status local (ADR-055 Fase E: rede de segurança se um webhook se perder).
    /// Null se a assinatura não existe no Asaas ou o Asaas está inalcançável.
    /// </summary>
    public async Task<string?> ObterStatusAssinaturaAsync(string subscriptionId, CancellationToken ct = default)
    {
        var cfg = ResolveConfig();
        if (cfg is null) return null;
        var (apiKey, baseUrl) = cfg.Value;
        try
        {
            var resp = await _http.SendAsync(Req(HttpMethod.Get, baseUrl, apiKey, $"/subscriptions/{subscriptionId}"), ct);
            if (!resp.IsSuccessStatusCode) return null;
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct));
            return doc.RootElement.TryGetProperty("status", out var st) ? st.GetString() : null;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Asaas: falha ao obter status da assinatura {Sub}", subscriptionId);
            return null;
        }
    }

    /// <summary>Link da cobrança em aberto da assinatura (p/ o médico pagar na página "Minha assinatura").</summary>
    public async Task<string?> ObterLinkAtualAsync(string subscriptionId, CancellationToken ct = default)
    {
        var cfg = ResolveConfig();
        if (cfg is null) return null;
        var (apiKey, baseUrl) = cfg.Value;
        return await PrimeiroLinkAsync(baseUrl, apiKey, subscriptionId, ct);
    }

    // Link de pagamento da 1ª cobrança gerada pela assinatura (p/ enviar ao médico).
    private async Task<string?> PrimeiroLinkAsync(string baseUrl, string apiKey, string subscriptionId, CancellationToken ct)
    {
        try
        {
            var resp = await _http.SendAsync(Req(HttpMethod.Get, baseUrl, apiKey, $"/subscriptions/{subscriptionId}/payments"), ct);
            if (!resp.IsSuccessStatusCode) return null;
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct));
            if (doc.RootElement.TryGetProperty("data", out var data)
                && data.ValueKind == JsonValueKind.Array && data.GetArrayLength() > 0)
            {
                var first = data[0];
                return first.TryGetProperty("invoiceUrl", out var iu) ? iu.GetString() : null;
            }
            return null;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Asaas: falha ao obter link da assinatura (segue sem link)");
            return null;
        }
    }

    private static string Resumo(string body)
    {
        body = body.Trim();
        return body.Length > 300 ? body[..300] : body;
    }
}

public record AsaasCobrancaInput(
    string CobrancaId, string PacienteId, string PacienteNome,
    string? PacienteCpf, string? PacienteEmail, string? PacienteTelefone,
    decimal Valor, DateOnly Vencimento, string Descricao,
    string? WalletId, decimal PlataformaFeePct);

public sealed record AsaasCobrancaResult(
    bool Sucesso, string? AsaasId, string? InvoiceUrl, string? PixCopiaCola,
    string? PixQrBase64, string? Status, string? Erro)
{
    public static AsaasCobrancaResult Ok(string id, string? url, string? copia, string? qr, string? status) =>
        new(true, id, url, copia, qr, status, null);
    public static AsaasCobrancaResult Falha(string erro) => new(false, null, null, null, null, null, erro);
}

public sealed record AsaasCustomerResult(bool Sucesso, string? CustomerId, string? Erro)
{
    public static AsaasCustomerResult Ok(string id) => new(true, id, null);
    public static AsaasCustomerResult Falha(string erro) => new(false, null, erro);
}

public sealed record AsaasAssinaturaResult(bool Sucesso, string? SubscriptionId, string? InvoiceUrl, string? Erro)
{
    public static AsaasAssinaturaResult Ok(string id, string? url) => new(true, id, url, null);
    public static AsaasAssinaturaResult Falha(string erro) => new(false, null, null, erro);
}
