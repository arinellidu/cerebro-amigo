using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Serialization;

namespace ApiGateway.Services;

/// <summary>
/// Cliente HTTP tipado para a Resend API (envio de emails transacionais).
///
/// Substitui o wrapper que antes vivia no orchestrator Go. Como envio de
/// email é I/O simples sem LLM, faz sentido mover pro .NET — uma rota a
/// menos, menos dependência no Go que estamos descomissionando.
///
/// Configuração via env vars:
///   RESEND_API_KEY  (obrigatório)
///   EMAIL_FROM      (ex.: "Cérebro Amigo &lt;contato@cerebroamigo.com.br&gt;")
/// </summary>
public sealed class ResendClient
{
    private readonly HttpClient _http;
    private readonly ILogger<ResendClient> _logger;
    private readonly string _from;

    public ResendClient(HttpClient http, IConfiguration cfg, ILogger<ResendClient> logger)
    {
        _http = http;
        _logger = logger;

        var apiKey = cfg["RESEND_API_KEY"]
            ?? throw new InvalidOperationException(
                "RESEND_API_KEY não configurada. Defina via env var ou Key Vault.");

        _from = cfg["EMAIL_FROM"]
            ?? throw new InvalidOperationException(
                "EMAIL_FROM não configurada (ex.: 'Cérebro Amigo <contato@cerebroamigo.com.br>').");

        _http.BaseAddress ??= new Uri("https://api.resend.com/");
        _http.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", apiKey);
    }

    /// <summary>
    /// Envia email. Retorna sucesso + ID do envio (ou descrição do erro).
    /// </summary>
    public async Task<SendEmailResult> SendAsync(
        string to,
        string subject,
        string htmlBody,
        string textBody,
        string? replyTo = null,
        CancellationToken ct = default)
    {
        var payload = new ResendSendRequest(
            From: _from,
            To: new[] { to },
            Subject: subject,
            Html: htmlBody,
            Text: textBody,
            ReplyTo: replyTo);

        try
        {
            var resp = await _http.PostAsJsonAsync("emails", payload, ct);
            var bodyStr = await resp.Content.ReadAsStringAsync(ct);

            if (resp.IsSuccessStatusCode)
            {
                var data = System.Text.Json.JsonSerializer.Deserialize<ResendSendResponse>(
                    bodyStr,
                    new System.Text.Json.JsonSerializerOptions
                    {
                        PropertyNameCaseInsensitive = true,
                    });
                _logger.LogInformation(
                    "Email enviado para {To} via Resend (id {Id})", to, data?.Id);
                return new SendEmailResult(true, data?.Id, null);
            }

            // Tenta extrair mensagem clara de erro — Resend retorna { message, name }
            // ou apenas mensagem texto. Preserva ambos casos.
            string? detalhe = null;
            try
            {
                using var doc = System.Text.Json.JsonDocument.Parse(bodyStr);
                if (doc.RootElement.TryGetProperty("message", out var msg))
                    detalhe = msg.GetString();
                else if (doc.RootElement.TryGetProperty("error", out var err))
                    detalhe = err.GetString();
            }
            catch { /* não era JSON */ }

            var errorMsg = $"Resend {(int)resp.StatusCode}: {detalhe ?? bodyStr.Trim()}";
            _logger.LogWarning(
                "Falha enviando email para {To}: {Error}", to, errorMsg);
            return new SendEmailResult(false, null, errorMsg);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            _logger.LogError(ex, "Resend inalcançável ao enviar para {To}", to);
            return new SendEmailResult(false, null, $"resend inalcançável: {ex.Message}");
        }
    }

    // ─── DTOs ───────────────────────────────────────────────────────────

    private sealed record ResendSendRequest(
        [property: JsonPropertyName("from")] string From,
        [property: JsonPropertyName("to")] string[] To,
        [property: JsonPropertyName("subject")] string Subject,
        [property: JsonPropertyName("html")] string Html,
        [property: JsonPropertyName("text")] string Text,
        [property: JsonPropertyName("reply_to")] string? ReplyTo);

    private sealed record ResendSendResponse(
        [property: JsonPropertyName("id")] string? Id);
}

/// <summary>
/// Resultado de um envio de email. <c>Success</c> é o gatilho principal,
/// <c>Error</c> traz a descrição quando false.
/// </summary>
public sealed record SendEmailResult(bool Success, string? Id, string? Error);
