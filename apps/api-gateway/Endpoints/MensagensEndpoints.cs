using ApiGateway.Data;
using ApiGateway.Services;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace ApiGateway.Endpoints;

/// <summary>
/// Console de revisão de conversas para o médico. SOMENTE LEITURA.
///
/// O paciente conversa com o assistente (orchestrator-py); o médico revisa.
/// Não existe canal "médico → paciente" direto aqui — toda resposta ao
/// paciente passa pela automação/portal com auditoria (regra clínica:
/// médico no loop, sem atalho que entregue texto ao paciente sem auditoria).
///
/// Tenant: sempre via JOIN pacientes.medico_responsavel_id. O médico tem
/// acesso ao conteúdo clínico DO SEU paciente (controle de acesso por tenant);
/// isto NÃO é log de aplicação — é o médico exercendo o cuidado.
/// </summary>
public static class MensagensEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/mensagens")
            .WithTags("mensagens")
            .RequireAuthorization();

        // Inbox: um item por paciente com conversa, ordenado pela última mensagem.
        g.MapGet("/conversas", async (AppDbContext db, ClaimsPrincipal user, CryptoService crypto) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            var rows = await db.Database.SqlQueryRaw<ConversaInboxItem>(@"
                SELECT cl.id AS paciente_id, cl.nome AS paciente_nome,
                       ult.conteudo AS ultima_mensagem,
                       ult.criada_em AS ultima_em,
                       ult.papel AS ultimo_papel,
                       tot.total
                FROM pacientes p
                JOIN clientes cl ON cl.id = p.cliente_id
                JOIN LATERAL (
                    SELECT m.conteudo, m.criada_em, m.papel
                    FROM mensagens m
                    JOIN conversas cv ON cv.id = m.conversa_id
                    WHERE cv.cliente_id = cl.id
                    ORDER BY m.criada_em DESC
                    LIMIT 1
                ) ult ON TRUE
                JOIN LATERAL (
                    SELECT COUNT(*) AS total
                    FROM mensagens m2
                    JOIN conversas cv2 ON cv2.id = m2.conversa_id
                    WHERE cv2.cliente_id = cl.id
                ) tot ON TRUE
                WHERE p.medico_responsavel_id = {0}
                ORDER BY ult.criada_em DESC",
                medicoId.Value).ToListAsync();

            // Decifra conteúdo antes de devolver (ADR-018)
            var decryptedRows = rows.Select(r => r with {
                UltimaMensagem = crypto.Decrypt(r.UltimaMensagem) ?? r.UltimaMensagem
            }).ToList();

            return Results.Ok(decryptedRows);
        });

        // Thread completa de um paciente (todas as conversas), ordem cronológica.
        g.MapGet("/paciente/{pacienteId:guid}", async (
            Guid pacienteId, AppDbContext db, ClaimsPrincipal user, CryptoService crypto) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            var ehDoMedico = await db.Database.ExistsAsync(
                "SELECT 1 FROM pacientes WHERE cliente_id = {0} AND medico_responsavel_id = {1}",
                pacienteId, medicoId.Value);
            if (!ehDoMedico) return Results.Forbid();

            var msgs = await db.Database.SqlQueryRaw<MensagemItem>(@"
                SELECT m.id, m.papel, m.conteudo, m.criada_em
                FROM mensagens m
                JOIN conversas cv ON cv.id = m.conversa_id
                WHERE cv.cliente_id = {0}
                ORDER BY m.criada_em
                LIMIT 500",
                pacienteId).ToListAsync();

            // Decifra conteúdo antes de devolver (ADR-018)
            var decryptedMsgs = msgs.Select(m => m with {
                Conteudo = crypto.Decrypt(m.Conteudo) ?? m.Conteudo
            }).ToList();

            return Results.Ok(decryptedMsgs);
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

public record ConversaInboxItem(
    Guid PacienteId, string? PacienteNome,
    string UltimaMensagem, DateTime UltimaEm, string UltimoPapel, long Total);

public record MensagemItem(
    Guid Id, string Papel, string Conteudo, DateTime CriadaEm);
