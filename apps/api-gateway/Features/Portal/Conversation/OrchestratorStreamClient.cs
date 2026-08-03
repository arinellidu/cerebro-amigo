using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.Extensions.Options;

namespace ApiGateway.Features.Portal.Conversation;

/// <summary>
/// Typed <see cref="HttpClient"/> que fala com o orchestrator-py.
/// Nome <c>StreamClient</c> distingue do <c>OrchestratorClient</c> legado
/// (que ainda fala com o orchestrator Go via <c>X-Internal-Token</c> +
/// porta 8080). Quando o Go for descomissionado, esse vira o canônico.
/// </summary>
public sealed class OrchestratorStreamClient
{
    private readonly HttpClient _http;
    private readonly OrchestratorStreamOptions _options;

    public OrchestratorStreamClient(
        HttpClient http,
        IOptions<OrchestratorStreamOptions> options)
    {
        _http = http;
        _options = options.Value;
    }

    /// <summary>
    /// Envia mensagem ao orchestrator-py e devolve a response com SSE
    /// stream aberto. Caller é responsável por consumir o stream e por
    /// dispor o <see cref="HttpResponseMessage"/>.
    /// </summary>
    /// <remarks>
    /// <see cref="HttpCompletionOption.ResponseHeadersRead"/> é crítico:
    /// sem isso o HttpClient buferiza o body inteiro antes de retornar,
    /// e o paciente esperaria a conversa terminar antes de ver tokens.
    /// </remarks>
    public Task<HttpResponseMessage> SendMessageAsync(
        OrchestratorMessageRequest request,
        CancellationToken cancellationToken)
    {
        var msg = new HttpRequestMessage(HttpMethod.Post, "/internal/portal/conversation/message")
        {
            Content = JsonContent.Create(request),
        };
        msg.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _options.InternalApiToken);
        msg.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));

        return _http.SendAsync(msg, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
    }
}
