namespace ApiGateway.Features.Portal.Conversation;

/// <summary>
/// Configuração do client HTTP que fala com o orchestrator-py via SSE.
///
/// Populada a partir de env vars planas (estilo do Program.cs existente):
///   ORCHESTRATOR_PY_URL              (default: http://orchestrator-py:8081)
///   INTERNAL_API_TOKEN               (compartilhado entre serviços internos)
///   JWT_PACIENTE_ID_CLAIM            (default: paciente_id)
///   ORCHESTRATOR_PY_TIMEOUT_SECONDS  (default: 120)
///
/// Distinta da config <c>ORCHESTRATOR_URL</c> que o <c>OrchestratorClient</c>
/// legado usa (orchestrator Go, header <c>X-Internal-Token</c>). Quando o
/// Go for descomissionado, dá pra consolidar.
/// </summary>
public sealed class OrchestratorStreamOptions
{
    public string BaseUrl { get; set; } = "http://orchestrator-py:8081";
    public string InternalApiToken { get; set; } = string.Empty;
    public string PacienteIdClaim { get; set; } = "sub";
    public int TimeoutSeconds { get; set; } = 120;
}
