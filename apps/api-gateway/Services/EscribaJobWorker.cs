using ApiGateway.Data;
using Microsoft.EntityFrameworkCore;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace ApiGateway.Services;

/// <summary>
/// Worker de transcrição assíncrona do Escriba presencial (ADR-075). Consome a
/// EscribaJobQueue: chama o agents-py (Azure AI Speech + rascunho factual; pode
/// levar minutos numa consulta longa), cifra transcrição + rascunho (ADR-018) e
/// atualiza consulta_transcricoes para 'rascunho'. Em falha → 'erro'.
///
/// RLS (0037): roda fora do request scope, então seta app.current_medico tx-local
/// antes dos UPDATEs (mesmo padrão do INSERT de mensagens_audio). O LLM/transcrição
/// vivem só no Python (ADR-044/081); o gateway só orquestra + persiste cifrado.
/// </summary>
public class EscribaJobWorker : BackgroundService
{
    private readonly EscribaJobQueue _queue;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IHttpClientFactory _httpFactory;
    private readonly IConfiguration _cfg;
    private readonly ILogger<EscribaJobWorker> _log;

    public EscribaJobWorker(
        EscribaJobQueue queue,
        IServiceScopeFactory scopeFactory,
        IHttpClientFactory httpFactory,
        IConfiguration cfg,
        ILogger<EscribaJobWorker> log)
    {
        _queue = queue;
        _scopeFactory = scopeFactory;
        _httpFactory = httpFactory;
        _cfg = cfg;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var job in _queue.ReadAllAsync(stoppingToken))
        {
            try
            {
                await ProcessAsync(job, stoppingToken);
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "escriba: job {Id} falhou", job.TranscricaoId);
                await MarcarErroAsync(job);
            }
        }
    }

    private async Task ProcessAsync(EscribaJob job, CancellationToken ct)
    {
        var internalToken = _cfg["INTERNAL_API_TOKEN"]
            ?? throw new InvalidOperationException("INTERNAL_API_TOKEN ausente");

        // agents-py: transcrição da chave no Blob (áudio efêmero, deletado lá após
        // transcrever). O campo segue chamado s3_key no wire (nome legado, ADR-082).
        var http = _httpFactory.CreateClient("agents-py-escriba");
        var payload = JsonSerializer.Serialize(new
        {
            s3_key = job.S3Key,
            content_type = job.ContentType,
            paciente_id = job.PacienteId,
        });
        using var msg = new HttpRequestMessage(HttpMethod.Post, "/internal/escriba/transcrever")
        {
            Content = new StringContent(payload, Encoding.UTF8, "application/json"),
        };
        msg.Headers.Authorization = new AuthenticationHeaderValue("Bearer", internalToken);

        using var resp = await http.SendAsync(msg, ct);
        resp.EnsureSuccessStatusCode();

        var json = await resp.Content.ReadAsStringAsync(ct);
        using var doc = JsonDocument.Parse(json);
        var transcricao = doc.RootElement.GetProperty("transcricao").GetString() ?? "";
        var rascunhoJson = doc.RootElement.GetProperty("rascunho").GetRawText();
        var mencaoRisco = doc.RootElement.TryGetProperty("mencao_risco", out var mr) && mr.GetBoolean();

        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var crypto = scope.ServiceProvider.GetRequiredService<CryptoService>();

        // set_config tx-local → RLS (app.current_medico) enxerga a linha do médico.
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.Database.ExecuteSqlRawAsync(
            "SELECT set_config('app.current_medico', {0}, true)", job.MedicoId.ToString());
        await db.Database.ExecuteSqlRawAsync(@"
            UPDATE consulta_transcricoes
            SET transcricao = {1}, rascunho = {2}, mencao_risco = {3}, status = 'rascunho'
            WHERE id = {0} AND status = 'processando'",
            job.TranscricaoId, crypto.Encrypt(transcricao) ?? "", crypto.Encrypt(rascunhoJson) ?? "", mencaoRisco);
        await db.Database.ExecuteSqlRawAsync(
            "UPDATE consultas SET escriba_status = 'rascunho' WHERE id = {0}", job.ConsultaId);
        await tx.CommitAsync(ct);

        _log.LogInformation("escriba: job {Id} concluído (mencaoRisco={Risco})",
            job.TranscricaoId, mencaoRisco);
    }

    private async Task MarcarErroAsync(EscribaJob job)
    {
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await using var tx = await db.Database.BeginTransactionAsync();
            await db.Database.ExecuteSqlRawAsync(
                "SELECT set_config('app.current_medico', {0}, true)", job.MedicoId.ToString());
            await db.Database.ExecuteSqlRawAsync(@"
                UPDATE consulta_transcricoes SET status = 'erro'
                WHERE id = {0} AND status = 'processando'", job.TranscricaoId);
            await db.Database.ExecuteSqlRawAsync(
                "UPDATE consultas SET escriba_status = 'erro' WHERE id = {0}", job.ConsultaId);
            await tx.CommitAsync();
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "escriba: falha ao marcar erro no job {Id}", job.TranscricaoId);
        }
    }
}
