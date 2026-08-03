using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Caching.Memory;

namespace ApiGateway.Services;

/// <summary>
/// Cliente HTTP tipado para a API Infosimples — consulta cadastro CFM.
///
/// Comportamento:
///   1. Cache em memória 30 dias — CRM já validado não bate Infosimples de novo.
///   2. Retry 3× com 1s entre tentativas — cobre hiccups do portal CFM.
///   3. Soft-fail via Erro != null — o endpoint decide se bloqueia (503) ou
///      cria com PendenteVerificacao (admin) / bloqueia (rede signup).
///
/// Configuração:
///   INFOSIMPLES_TOKEN       (obrigatório) — token da API Infosimples
///   INFOSIMPLES_CFM_URL     (opcional)    — override de URL (default abaixo)
///   CRM_VALIDATION_ENABLED  (opcional)    — false = bypass dev/emergência
///
/// LGPD: logar só CRM+UF+situação/status HTTP. Nunca logar resposta crua.
/// </summary>
public sealed class CfmClient
{
    private readonly HttpClient _http;
    private readonly ILogger<CfmClient> _logger;
    private readonly IMemoryCache _cache;
    private readonly string _token;
    private readonly bool _enabled;

    public CfmClient(HttpClient http, IConfiguration cfg, ILogger<CfmClient> logger, IMemoryCache cache)
    {
        _http = http;
        _logger = logger;
        _cache = cache;

        _token = cfg["INFOSIMPLES_TOKEN"] ?? "";
        _enabled = !string.Equals(cfg["CRM_VALIDATION_ENABLED"], "false",
            StringComparison.OrdinalIgnoreCase);

        var baseUrl = cfg["INFOSIMPLES_CFM_URL"]
            ?? "https://api.infosimples.com/api/v2/consultas/cfm/cadastro";

        _http.BaseAddress ??= new Uri(baseUrl);
        // O scrape do portal CFM pela Infosimples é lento (até ~60s). Timeout folgado.
        _http.Timeout = TimeSpan.FromSeconds(100);
    }

    /// <summary>
    /// Consulta o CFM via Infosimples com cache (30 dias) e retry (3×, 1s).
    /// </summary>
    /// <returns>
    ///   <c>Erro != null</c> → serviço indisponível após todas as tentativas.<br/>
    ///   <c>Encontrado = false, Erro = null</c> → CRM não existe ou nome não confere.<br/>
    ///   <c>Situacao != "Regular"</c> → médico suspenso/cancelado.
    /// </returns>
    public async Task<CrmValidationResult> ValidarAsync(
        string crm, string uf, string? nome = null, CancellationToken ct = default)
    {
        if (!_enabled)
        {
            _logger.LogWarning(
                "CRM_VALIDATION_ENABLED=false: CRM {Crm}/{Uf} não validado contra CFM", crm, uf);
            return new CrmValidationResult(
                Encontrado: true, Situacao: "NaoValidado",
                Nome: null, Especialidade: null, Erro: null);
        }

        if (string.IsNullOrEmpty(_token))
        {
            _logger.LogError("INFOSIMPLES_TOKEN não configurado — validação CRM impossível");
            return new CrmValidationResult(
                Encontrado: false, Situacao: null,
                Nome: null, Especialidade: null, Erro: "INFOSIMPLES_TOKEN ausente");
        }

        if (string.IsNullOrWhiteSpace(nome))
        {
            _logger.LogWarning("CRM {Crm}/{Uf}: nome ausente — CFM só consulta por nome", crm, uf);
            return new CrmValidationResult(false, null, null, null, "nome ausente");
        }

        var crmDigits = SoDigitos(crm).TrimStart('0');
        var ufUpper = uf.ToUpperInvariant();

        // Cache: CRM validado com sucesso fica 30 dias sem bater Infosimples.
        var cacheKey = $"cfm:{crmDigits}:{ufUpper}";
        if (_cache.TryGetValue(cacheKey, out CrmValidationResult? cached))
        {
            _logger.LogInformation("CRM {Crm}/{Uf} — cache hit (situação: {Sit})", crm, uf, cached!.Situacao);
            return cached!;
        }

        // Retry 3×: cobre hiccups do portal CFM (code 612 = origem instável).
        // Cada tentativa recria o FormUrlEncodedContent (stream não é reutilizável).
        CrmValidationResult result = default!;
        for (int attempt = 1; attempt <= 3; attempt++)
        {
            result = await TentarConsultaAsync(crmDigits, crm, uf, ufUpper, nome, ct);

            if (result.Erro is null)
            {
                // Resposta definitiva (sucesso ou não-encontrado) — não retentar.
                if (result.Encontrado)
                    _cache.Set(cacheKey, result, TimeSpan.FromDays(30));
                return result;
            }

            // Erro de config não melhora com retry.
            if (result.Erro.StartsWith("INFOSIMPLES_TOKEN") || result.Erro == "nome ausente")
                return result;

            if (attempt < 3)
            {
                _logger.LogWarning(
                    "CRM {Crm}/{Uf} — tentativa {Attempt}/3 falhou ({Erro}). Aguardando 1s.",
                    crm, uf, attempt, result.Erro);
                await Task.Delay(TimeSpan.FromSeconds(1), ct);
            }
        }

        _logger.LogError("CRM {Crm}/{Uf} — 3 tentativas esgotadas: {Erro}", crm, uf, result.Erro);
        return result;
    }

    private async Task<CrmValidationResult> TentarConsultaAsync(
        string crmDigits, string crm, string uf, string ufUpper,
        string nome, CancellationToken ct)
    {
        try
        {
            // Busca por nome+uf — inscrição é casada localmente nos resultados.
            // Busca por inscrição direta devolve code 612 (scrape CFM só suporta nome).
            var content = new FormUrlEncodedContent(new[]
            {
                new KeyValuePair<string, string>("token", _token),
                new KeyValuePair<string, string>("nome",  nome.Trim()),
                new KeyValuePair<string, string>("uf",    ufUpper),
            });

            var resp = await _http.PostAsync("", content, ct);
            var statusCode = (int)resp.StatusCode;
            if (!resp.IsSuccessStatusCode)
            {
                _logger.LogWarning(
                    "Infosimples HTTP {Status} ao consultar CRM {Crm}/{Uf}", statusCode, crm, uf);
                return new CrmValidationResult(false, null, null, null, $"Infosimples HTTP {statusCode}");
            }

            InfosimplesResponse? body;
            try
            {
                body = await resp.Content.ReadFromJsonAsync<InfosimplesResponse>(cancellationToken: ct);
            }
            catch
            {
                _logger.LogWarning("Infosimples: resposta não-parsável para CRM {Crm}/{Uf}", crm, uf);
                return new CrmValidationResult(false, null, null, null, "resposta inválida");
            }

            if (body is null)
                return new CrmValidationResult(false, null, null, null, "resposta inválida");

            // Semântica Infosimples:
            //   600 = nome não encontrado → definitivo (→ 422, não retenta).
            //   612 / outro != 200 = portal CFM instável → retriável.
            if (body.Code == 600)
            {
                _logger.LogInformation(
                    "CFM: nome não encontrado p/ CRM {Crm}/{Uf} (code 600)", crm, uf);
                return new CrmValidationResult(false, null, null, null, Erro: null);
            }

            if (body.Code != 200 || body.Data is null || body.Data.Count == 0)
            {
                _logger.LogWarning(
                    "Infosimples não confirmou CRM {Crm}/{Uf} (code {Code}: {Msg}) — retriável",
                    crm, uf, body.Code, body.CodeMessage);
                return new CrmValidationResult(false, null, null, null, $"Infosimples code {body.Code}");
            }

            var match = body.Data.FirstOrDefault(d =>
                crmDigits.Length > 0 &&
                SoDigitos(d.Inscricao ?? "").TrimStart('0') == crmDigits);

            if (match is null)
            {
                _logger.LogInformation(
                    "CFM: nome encontrado mas CRM {Crm}/{Uf} não confere ({Count} registro(s))",
                    crm, uf, body.Data.Count);
                return new CrmValidationResult(false, null, null, null, Erro: null);
            }

            var situacao = match.Situacao ?? "";
            _logger.LogInformation(
                "CRM {Crm}/{Uf} consultado — situação: {Situacao}", crm, uf, situacao);
            return new CrmValidationResult(true, situacao, match.Nome, match.Especialidade, null);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            _logger.LogError(ex, "Infosimples inalcançável ao consultar CRM {Crm}/{Uf}", crm, uf);
            return new CrmValidationResult(
                Encontrado: false, Situacao: null,
                Nome: null, Especialidade: null,
                Erro: $"infosimples inalcançável: {ex.Message}");
        }
    }

    private static string SoDigitos(string s) => new(s.Where(char.IsDigit).ToArray());

    // ─── DTOs ────────────────────────────────────────────────────────────────

    private sealed class InfosimplesResponse
    {
        [JsonPropertyName("code")]
        public int Code { get; set; }

        [JsonPropertyName("code_message")]
        public string? CodeMessage { get; set; }

        [JsonPropertyName("data")]
        public List<InfosimplesMedicoData>? Data { get; set; }
    }

    private sealed class InfosimplesMedicoData
    {
        [JsonPropertyName("nome")]
        public string? Nome { get; set; }

        [JsonPropertyName("situacao")]
        public string? Situacao { get; set; }

        [JsonPropertyName("especialidade")]
        public string? Especialidade { get; set; }

        [JsonPropertyName("inscricao")]
        public string? Inscricao { get; set; }
    }
}

/// <summary>Resultado da consulta CRM no CFM via Infosimples.</summary>
/// <param name="Encontrado">CRM existe na base do CFM.</param>
/// <param name="Situacao">Regular | Cancelado | Suspenso | NaoValidado | PendenteVerificacao | null.</param>
/// <param name="Nome">Nome retornado pelo CFM (p/ cross-check, pode ser null).</param>
/// <param name="Especialidade">Especialidade registrada no CFM.</param>
/// <param name="Erro">
///   Descrição de erro de comunicação/serviço. null = consulta executou
///   (mesmo que não tenha encontrado). Erro != null ⇒ CFM indisponível após retries.
/// </param>
public sealed record CrmValidationResult(
    bool Encontrado,
    string? Situacao,
    string? Nome,
    string? Especialidade,
    string? Erro);
