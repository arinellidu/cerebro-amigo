using ApiGateway.Auth;
using ApiGateway.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace ApiGateway.Endpoints;

/// <summary>
/// Monitoramento de exames laboratoriais (S2, ADR-029). A AGENDA é gerada pelo
/// job determinístico do agents-py (gerador_exames) a partir das prescrições
/// ativas; o gateway só LISTA e registra resultado.
///
/// O resultado é comparado com a FAIXA DE REFERÊNCIA já gravada na linha (cópia
/// factual do protocolo) — comparação aritmética, sem LLM. Fora da faixa →
/// notifica o médico (factual, sem conduta). A leitura clínica é do médico.
/// Tenant: JOIN pacientes.medico_responsavel_id (1ª cláusula).
/// </summary>
public static class ExamesEndpoints
{
    public static void Map(WebApplication app)
    {
        // Agenda de exames de um paciente (pendentes primeiro, depois realizados).
        app.MapGet("/api/v1/pacientes/{id:guid}/exames", async (
            Guid id, AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            var rows = await db.Database.SqlQueryRaw<ExameItem>(@"
                SELECT ea.id, ea.tipo_exame, ea.motivo, ea.devido_em, ea.status,
                       ea.ref_label, ea.ref_unidade, ea.ref_min, ea.ref_max,
                       ea.resultado_valor, ea.resultado_em, ea.fora_faixa,
                       (ea.status = 'agendado' AND ea.devido_em < CURRENT_DATE) AS atrasado
                FROM exames_agenda ea
                JOIN pacientes p ON p.cliente_id = ea.paciente_id
                WHERE ea.paciente_id = {0} AND p.medico_responsavel_id = {1}
                ORDER BY (ea.status = 'agendado') DESC, ea.devido_em",
                id, medicoId.Value).ToListAsync();

            // Trilha de acesso (LGPD art.37) — best-effort.
            await db.Database.RegistrarAcessoProntuarioAsync(medicoId.Value, id, "exames");

            return Results.Ok(rows);
        })
        .WithTags("exames")
        .RequireAuthorization();

        var g = app.MapGroup("/api/v1/exames/{id:guid}")
            .WithTags("exames")
            .RequireAuthorization()
            .RequireAssinaturaAtiva()  // ADR-065: registrar/cancelar resultado = escrita operacional
            .RequireWriteAccess();     // trial read-only bloqueia; vencido cai no paywall

        // Registrar resultado: compara com a faixa armazenada → fora_faixa.
        g.MapPost("/resultado", async (
            Guid id, [FromBody] RegistrarResultadoRequest req,
            AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            var ex = await db.Database.SqlQueryRaw<ExameFaixa>(@"
                SELECT ea.paciente_id, ea.tipo_exame, ea.ref_label, ea.ref_unidade,
                       ea.ref_min, ea.ref_max
                FROM exames_agenda ea
                JOIN pacientes p ON p.cliente_id = ea.paciente_id
                WHERE ea.id = {0} AND p.medico_responsavel_id = {1} AND ea.status = 'agendado'",
                id, medicoId.Value).FirstOrDefaultAsync();
            if (ex is null) return Results.NotFound();

            // Comparação factual com a faixa (quando há faixa definida).
            bool? foraFaixa = (ex.RefMin is null && ex.RefMax is null)
                ? null
                : (ex.RefMin is not null && req.Valor < ex.RefMin)
                  || (ex.RefMax is not null && req.Valor > ex.RefMax);

            var coletadoEm = req.ColetadoEm ?? DateOnly.FromDateTime(DateTime.UtcNow);

            await db.Database.ExecuteRawAsync(@"
                UPDATE exames_agenda SET
                    status = 'realizado',
                    resultado_valor = {2},
                    resultado_em = {3},
                    fora_faixa = {4},
                    registrado_por = {1},
                    notas = COALESCE(NULLIF({5}, ''), notas),
                    atualizado_em = NOW()
                WHERE id = {0}
                  AND paciente_id IN (
                      SELECT cliente_id FROM pacientes WHERE medico_responsavel_id = {1}
                  )",
                id, medicoId.Value, req.Valor, coletadoEm,
                (object?)foraFaixa ?? DBNull.Value, req.Notas ?? "");

            // Alerta factual ao médico quando fora da faixa (sem conduta sugerida).
            if (foraFaixa == true)
            {
                var nome = ex.RefLabel ?? ex.TipoExame;
                var unid = ex.RefUnidade is null ? "" : " " + ex.RefUnidade;
                await db.Database.ExecuteRawAsync(@"
                    INSERT INTO notificacoes_medico
                        (medico_id, paciente_id, severidade, tipo, titulo, mensagem)
                    VALUES ({0}, {1}, 'atencao', 'exame_fora_faixa', {2}, {3})",
                    medicoId.Value, ex.PacienteId,
                    $"Exame fora da faixa: {nome}",
                    $"{nome}: {req.Valor}{unid} (referência "
                    + $"{ex.RefMin?.ToString() ?? "—"}–{ex.RefMax?.ToString() ?? "—"}).");
            }

            return Results.Ok(new { foraFaixa });
        });

        // Cancelar um exame agendado (ex.: prescrição suspensa).
        g.MapPost("/cancelar", async (Guid id, AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            var afetadas = await db.Database.ExecuteRawAsync(@"
                UPDATE exames_agenda SET status = 'cancelado', atualizado_em = NOW()
                WHERE id = {0} AND status = 'agendado'
                  AND paciente_id IN (
                      SELECT cliente_id FROM pacientes WHERE medico_responsavel_id = {1}
                  )",
                id, medicoId.Value);
            return afetadas == 0 ? Results.NotFound() : Results.NoContent();
        });
    }

    private static async Task<Guid?> GetMedicoIdAsync(AppDbContext db, ClaimsPrincipal user)
    {
        var sub = user.FindFirst("sub")?.Value;
        if (!Guid.TryParse(sub, out var userId)) return null;
        return await db.Database.ExecuteScalarAsync<Guid?>(
            "SELECT id FROM medicos WHERE usuario_id = {0}", userId);
    }
}

public record ExameItem(
    Guid Id, string TipoExame, string Motivo, DateOnly DevidoEm, string Status,
    string? RefLabel, string? RefUnidade, decimal? RefMin, decimal? RefMax,
    decimal? ResultadoValor, DateOnly? ResultadoEm, bool? ForaFaixa, bool Atrasado);

public record ExameFaixa(
    Guid PacienteId, string TipoExame, string? RefLabel, string? RefUnidade,
    decimal? RefMin, decimal? RefMax);

public record RegistrarResultadoRequest(decimal Valor, DateOnly? ColetadoEm, string? Notas);
