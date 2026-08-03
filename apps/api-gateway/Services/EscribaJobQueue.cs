using System.Threading.Channels;

namespace ApiGateway.Services;

/// <summary>
/// Um job de transcrição assíncrona do Escriba presencial (ADR-075). O áudio já está
/// no S3 (subido pelo browser via presigned); o worker chama o agents-py, cifra o
/// resultado e atualiza a linha de consulta_transcricoes.
///
/// MedicoId é carregado no job de propósito: o worker roda FORA do request scope
/// (sem GUC de tenant setado pelo TenantSessionMiddleware), então precisa setar
/// app.current_medico ele mesmo para o UPDATE passar na RLS (0037).
/// </summary>
public record EscribaJob(
    Guid TranscricaoId,
    Guid ConsultaId,
    Guid PacienteId,
    Guid MedicoId,
    string S3Key,
    string ContentType);

/// <summary>
/// Fila in-process (Channel) de jobs de transcrição do Escriba presencial. Simples e
/// suficiente para o piloto — NÃO é durável: se o gateway reiniciar com jobs na fila
/// ou em voo, eles se perdem, e o sweep de 15min (GET /escriba) marca a linha como
/// 'erro' para o médico regravar. Evoluir para fila durável (SQS/tabela) se o volume
/// justificar (ADR-075, limitações conhecidas).
/// </summary>
public class EscribaJobQueue
{
    private readonly Channel<EscribaJob> _channel =
        Channel.CreateUnbounded<EscribaJob>(new UnboundedChannelOptions { SingleReader = true });

    public ValueTask EnqueueAsync(EscribaJob job) => _channel.Writer.WriteAsync(job);

    public IAsyncEnumerable<EscribaJob> ReadAllAsync(CancellationToken ct) =>
        _channel.Reader.ReadAllAsync(ct);
}
