using System.Text.Json.Serialization;

namespace ApiGateway.Features.Portal.Conversation;

/// <summary>
/// Request que o PWA envia para <c>POST /api/portal/conversation/message</c>.
///
/// Importante: <c>paciente_id</c> NÃO vem no body — é extraído do JWT
/// validado pelo gateway. Isso fecha o vetor de impersonação onde
/// paciente A passaria <c>paciente_id</c> de paciente B.
/// </summary>
public sealed record PortalConversationRequest(
    string Mensagem,
    Guid IdempotencyKey
);

/// <summary>
/// Request que o gateway envia para o orchestrator-py. Os
/// <c>JsonPropertyName</c> em snake_case batem exatamente com o schema
/// que o FastAPI do orchestrator-py espera.
/// </summary>
public sealed record OrchestratorMessageRequest(
    [property: JsonPropertyName("paciente_id")] Guid PacienteId,
    [property: JsonPropertyName("mensagem")] string Mensagem,
    [property: JsonPropertyName("idempotency_key")] string IdempotencyKey,
    [property: JsonPropertyName("canal")] string Canal
);
