using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace ApiGateway.Services;

/// <summary>
/// Cliente HTTP tipado para a API REST do MEMED (Sinapse Prescrição).
///
/// Registra/obtém o prescritor (médico) e devolve o token usado pelo SDK do
/// frontend. O gateway NUNCA prescreve — só provisiona o médico no MEMED; a
/// prescrição e a assinatura acontecem no widget do MEMED, pelo médico.
///
/// Config (env):
///   MEMED_API_KEY     (obrigatório)
///   MEMED_SECRET_KEY  (obrigatório)
///   MEMED_API_BASE    (default sandbox: https://integrations.api.memed.com.br/v1)
///
/// Sem keys configuradas, o gateway sobe normalmente — só os endpoints MEMED
/// respondem erro claro (não derruba o serviço inteiro).
/// </summary>
public sealed class MemedClient
{
    private readonly HttpClient _http;
    private readonly IConfiguration _cfg;
    private readonly ILogger<MemedClient> _logger;

    public MemedClient(HttpClient http, IConfiguration cfg, ILogger<MemedClient> logger)
    {
        _http = http;
        _cfg = cfg;
        _logger = logger;
    }

    private (string apiKey, string secret, string baseUrl)? ResolveConfig()
    {
        var k = _cfg["MEMED_API_KEY"];
        var s = _cfg["MEMED_SECRET_KEY"];
        if (string.IsNullOrWhiteSpace(k) || string.IsNullOrWhiteSpace(s)) return null;
        var b = (_cfg["MEMED_API_BASE"] ?? "https://integrations.api.memed.com.br/v1").TrimEnd('/');
        return (k, s, b);
    }

    /// <summary>
    /// Registra o prescritor (POST) ou reobtém (GET por id) e devolve o token.
    /// </summary>
    public async Task<MemedPrescritorResult> RegistrarOuObterAsync(
        MemedMedicoDados d, string? memedUsuarioId, CancellationToken ct = default)
    {
        var cfg = ResolveConfig();
        if (cfg is null)
            return MemedPrescritorResult.Falha("MEMED_API_KEY/MEMED_SECRET_KEY não configuradas no gateway");
        var (apiKey, secret, baseUrl) = cfg.Value;
        var query = $"?api-key={Uri.EscapeDataString(apiKey)}&secret-key={Uri.EscapeDataString(secret)}";

        HttpRequestMessage req;
        if (!string.IsNullOrWhiteSpace(memedUsuarioId))
        {
            req = new HttpRequestMessage(
                HttpMethod.Get,
                $"{baseUrl}/sinapse-prescricao/usuarios/{Uri.EscapeDataString(memedUsuarioId)}{query}");
        }
        else
        {
            var payload = new
            {
                data = new
                {
                    type = "usuarios",
                    attributes = new
                    {
                        external_id = d.ExternalId,
                        nome = d.Nome,
                        sobrenome = d.Sobrenome,
                        cpf = d.Cpf,
                        board = new
                        {
                            board_code = "CRM",
                            board_number = d.CrmNumero,
                            board_state = d.CrmUf,
                        },
                        email = d.Email,
                    },
                },
            };
            req = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl}/sinapse-prescricao/usuarios{query}")
            {
                Content = JsonContent.Create(payload),
            };
        }
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.api+json"));

        try
        {
            var resp = await _http.SendAsync(req, ct);
            var body = await resp.Content.ReadAsStringAsync(ct);

            if (!resp.IsSuccessStatusCode)
            {
                _logger.LogWarning("MEMED {Status}: {Body}", (int)resp.StatusCode, Resumo(body));
                return MemedPrescritorResult.Falha($"MEMED {(int)resp.StatusCode}: {Resumo(body)}");
            }

            using var doc = JsonDocument.Parse(body);
            var data = doc.RootElement.GetProperty("data");
            var attrs = data.GetProperty("attributes");
            var token = attrs.TryGetProperty("token", out var t) ? t.GetString() : null;
            var id = data.TryGetProperty("id", out var idEl) ? idEl.ToString() : memedUsuarioId;

            if (string.IsNullOrEmpty(token))
                return MemedPrescritorResult.Falha("MEMED não retornou token");

            return MemedPrescritorResult.Ok(token!, id);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            _logger.LogError(ex, "MEMED inalcançável");
            return MemedPrescritorResult.Falha($"MEMED inalcançável: {ex.Message}");
        }
        catch (JsonException ex)
        {
            _logger.LogError(ex, "MEMED resposta inválida");
            return MemedPrescritorResult.Falha("MEMED retornou resposta inesperada");
        }
    }

    private static string Resumo(string body)
    {
        body = body.Trim();
        return body.Length > 300 ? body[..300] : body;
    }
}

public record MemedMedicoDados(
    string ExternalId, string Nome, string Sobrenome,
    string Cpf, string CrmNumero, string CrmUf, string? Email);

public sealed record MemedPrescritorResult(bool Sucesso, string? Token, string? UsuarioId, string? Erro)
{
    public static MemedPrescritorResult Ok(string token, string? usuarioId) => new(true, token, usuarioId, null);
    public static MemedPrescritorResult Falha(string erro) => new(false, null, null, erro);
}
