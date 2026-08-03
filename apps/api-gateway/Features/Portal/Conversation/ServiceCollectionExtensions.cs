namespace ApiGateway.Features.Portal.Conversation;

public static class ConversationServiceCollectionExtensions
{
    /// <summary>
    /// Registra <see cref="OrchestratorStreamClient"/> tipado e popula
    /// <see cref="OrchestratorStreamOptions"/> a partir de env vars
    /// planas (estilo do Program.cs existente).
    ///
    /// Uso em <c>Program.cs</c>:
    /// <code>
    /// builder.Services.AddOrchestratorStreamClient(builder.Configuration);
    /// </code>
    /// </summary>
    public static IServiceCollection AddOrchestratorStreamClient(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        // INTERNAL_API_TOKEN é compartilhado com outros internal calls,
        // mas é obrigatório aqui — falha fast se ausente.
        var token = configuration["INTERNAL_API_TOKEN"]
                    ?? throw new InvalidOperationException(
                        "INTERNAL_API_TOKEN é obrigatório para OrchestratorStreamClient. "
                        + "Defina via env var, appsettings, ou Key Vault.");

        var baseUrl = configuration["ORCHESTRATOR_PY_URL"]
                      ?? "http://orchestrator-py:8081";

        // O JWT do paciente carrega o paciente_id no claim `sub` (ver
        // GerarTokensSessao). Default "sub" — não "paciente_id" (claim inexistente).
        var claim = configuration["JWT_PACIENTE_ID_CLAIM"] ?? "sub";

        var timeout = int.TryParse(
            configuration["ORCHESTRATOR_PY_TIMEOUT_SECONDS"],
            out var t) ? t : 120;

        services.Configure<OrchestratorStreamOptions>(opts =>
        {
            opts.BaseUrl = baseUrl;
            opts.InternalApiToken = token;
            opts.PacienteIdClaim = claim;
            opts.TimeoutSeconds = timeout;
        });

        services.AddHttpClient<OrchestratorStreamClient>(http =>
        {
            http.BaseAddress = new Uri(baseUrl);
            http.Timeout = TimeSpan.FromSeconds(timeout);
        });

        return services;
    }
}
