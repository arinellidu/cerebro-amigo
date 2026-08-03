using System.Net.Http.Json;
using System.Text.Json.Serialization;

namespace ApiGateway.Services;

/// <summary>
/// Verificador do Cloudflare Turnstile — anti-abuso do signup público de médico (ADR-055).
///
/// Protege a superfície anônima POST /api/v1/auth/medico/signup contra automação que
/// queimaria a validação de CRM (Infosimples é PAGO). Roda no GATEWAY, não só no BFF,
/// porque o endpoint é público e chamável direto; verificar apenas no front seria burlável.
///
/// Flag-gated pela presença da secret (mesmo espírito do CRM_VALIDATION_ENABLED do CfmClient):
/// sem TURNSTILE_SECRET_KEY o verificador fica DESLIGADO (VerifyAsync devolve true) — não
/// quebra dev/local nem ambientes ainda sem a chave. Em prod, definir a secret no gateway +
/// a NEXT_PUBLIC_TURNSTILE_SITE_KEY no web ATIVA a proteção (as duas chaves andam juntas).
///
/// Fail-closed: Turnstile inalcançável ou token inválido → false. Mesmo critério do
/// self-signup quando o CFM está fora: não cria conta sem validar; peça p/ tentar de novo.
///
/// LGPD: o token é opaco e efêmero; logamos só o resultado e os error-codes do Cloudflare,
/// nunca o token nem PII.
/// </summary>
public sealed class TurnstileVerifier
{
    private const string SiteVerifyUrl =
        "https://challenges.cloudflare.com/turnstile/v0/siteverify";

    private readonly HttpClient _http;
    private readonly ILogger<TurnstileVerifier> _logger;
    private readonly string _secret;

    public TurnstileVerifier(HttpClient http, IConfiguration cfg, ILogger<TurnstileVerifier> logger)
    {
        _http = http;
        _logger = logger;
        _secret = cfg["TURNSTILE_SECRET_KEY"] ?? "";
        _http.Timeout = TimeSpan.FromSeconds(10);
    }

    /// <summary>true = ativo (secret configurada); false = desligado (pula verificação).</summary>
    public bool Enabled => !string.IsNullOrWhiteSpace(_secret);

    /// <summary>
    /// Verifica o token do widget. Desligado → true (não bloqueia). Token vazio → false.
    /// Erro de comunicação/parse com o Cloudflare → false (fail-closed).
    /// </summary>
    public async Task<bool> VerifyAsync(string? token, string? remoteIp, CancellationToken ct = default)
    {
        if (!Enabled) return true; // captcha desligado (sem secret) — não bloqueia o signup

        if (string.IsNullOrWhiteSpace(token))
        {
            _logger.LogWarning("Turnstile: token ausente na requisição de signup");
            return false;
        }

        try
        {
            var form = new List<KeyValuePair<string, string>>
            {
                new("secret", _secret),
                new("response", token),
            };
            if (!string.IsNullOrWhiteSpace(remoteIp))
                form.Add(new("remoteip", remoteIp));

            var resp = await _http.PostAsync(SiteVerifyUrl, new FormUrlEncodedContent(form), ct);
            if (!resp.IsSuccessStatusCode)
            {
                _logger.LogWarning("Turnstile siteverify HTTP {Status} — fail-closed", (int)resp.StatusCode);
                return false;
            }

            var body = await resp.Content.ReadFromJsonAsync<TurnstileResponse>(cancellationToken: ct);
            if (body is null)
            {
                _logger.LogWarning("Turnstile siteverify: resposta não-parsável — fail-closed");
                return false;
            }

            if (!body.Success)
                _logger.LogWarning("Turnstile reprovou o token: {Errors}",
                    body.ErrorCodes is { Count: > 0 } ? string.Join(",", body.ErrorCodes) : "(sem códigos)");

            return body.Success;
        }
        catch (Exception ex) when (
            ex is HttpRequestException
            or TaskCanceledException
            or System.Text.Json.JsonException
            or NotSupportedException)
        {
            // Timeout/rede (HttpRequestException/TaskCanceledException) e resposta inesperada
            // (JSON malformado / content-type errado) → fail-closed em vez de 500.
            _logger.LogError(ex, "Turnstile inalcançável ou resposta inválida — fail-closed");
            return false;
        }
    }

    private sealed class TurnstileResponse
    {
        [JsonPropertyName("success")] public bool Success { get; set; }
        [JsonPropertyName("error-codes")] public List<string>? ErrorCodes { get; set; }
    }
}
