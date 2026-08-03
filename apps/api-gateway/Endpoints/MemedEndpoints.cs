using ApiGateway.Auth;
using ApiGateway.Data;
using ApiGateway.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace ApiGateway.Endpoints;

/// <summary>
/// Integração MEMED. O gateway só provisiona o médico no MEMED e devolve o token
/// para o SDK do frontend; a prescrição e a assinatura ocorrem no widget do MEMED
/// (clinical-safety #1: a IA nunca prescreve). O espelho em `prescricoes` serve só
/// ao motor de lembretes — a receita legal vive no MEMED.
///
/// Tenant = médico logado. Tudo escopado por medico_responsavel_id.
/// </summary>
public static class MemedEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/memed").WithTags("memed")
            .RequireAuthorization()
            .RequireAssinaturaAtiva()  // ADR-065: espelho de receita = escrita operacional
            .RequireWriteAccess();     // trial read-only bloqueia o POST; GET de token passa

        // Token do prescritor para o SDK do frontend (registra/reobtém no MEMED).
        g.MapGet("/prescritor-token", async (
            AppDbContext db, ClaimsPrincipal user, MemedClient memed, IConfiguration cfg) =>
        {
            var sub = user.FindFirst("sub")?.Value;
            if (!Guid.TryParse(sub, out var userId)) return Results.Forbid();

            var med = await db.Database.SqlQueryRaw<MedicoMemedRow>(@"
                SELECT m.id AS medico_id, m.nome, m.crm, m.crm_uf, m.cpf,
                       m.memed_usuario_id, u.email
                FROM medicos m
                JOIN usuarios u ON u.id = m.usuario_id
                WHERE m.usuario_id = {0}",
                userId).FirstOrDefaultAsync();
            if (med is null) return Results.Forbid();

            var crmNumero = new string((med.Crm ?? "").Where(char.IsDigit).ToArray());
            var cpf = new string((med.Cpf ?? "").Where(char.IsDigit).ToArray());
            if (string.IsNullOrWhiteSpace(med.CrmUf) || cpf.Length == 0 || crmNumero.Length == 0)
                return Results.BadRequest(new
                {
                    error = "cadastro_incompleto",
                    message = "Preencha CRM (número), UF do CRM e CPF nas Configurações antes de emitir receita.",
                });

            var partes = (med.Nome ?? "").Trim().Split(' ', 2, StringSplitOptions.RemoveEmptyEntries);
            var primeiro = partes.Length > 0 ? partes[0] : (med.Nome ?? "");
            var sobrenome = partes.Length > 1 ? partes[1] : "";

            var dados = new MemedMedicoDados(
                ExternalId: med.MedicoId.ToString(),
                Nome: primeiro,
                Sobrenome: sobrenome,
                Cpf: cpf,
                CrmNumero: crmNumero,
                CrmUf: med.CrmUf!.Trim().ToUpperInvariant(),
                Email: med.Email);

            var r = await memed.RegistrarOuObterAsync(dados, med.MemedUsuarioId);
            if (!r.Sucesso)
                return Results.Json(new { error = "memed_falha", detalhe = r.Erro }, statusCode: 502);

            // Persiste o id do prescritor na 1ª vez (para reobter token depois).
            if (string.IsNullOrEmpty(med.MemedUsuarioId) && !string.IsNullOrEmpty(r.UsuarioId))
                await db.Database.ExecuteSqlRawAsync(
                    "UPDATE medicos SET memed_usuario_id = {0} WHERE id = {1}", r.UsuarioId, med.MedicoId);

            var scriptUrl = cfg["MEMED_SCRIPT_URL"]
                ?? "https://integrations.memed.com.br/modulos/plataforma.sinapse-prescricao/build/sinapse-prescricao.min.js";

            return Results.Ok(new { token = r.Token, scriptUrl });
        });

        // Dados do paciente para o comando setPaciente do SDK.
        g.MapGet("/paciente/{pacienteId:guid}/dados", async (
            Guid pacienteId, AppDbContext db, ClaimsPrincipal user) =>
        {
            if (!await PacienteEhDoMedico(db, pacienteId, user)) return Results.Forbid();

            var row = await db.Database.SqlQueryRaw<PacienteMemedDto>(@"
                SELECT c.id AS paciente_id, c.nome, p.cpf, c.wa_id AS telefone
                FROM clientes c
                JOIN pacientes p ON p.cliente_id = c.id
                WHERE c.id = {0}",
                pacienteId).FirstOrDefaultAsync();

            return row is null ? Results.NotFound() : Results.Ok(row);
        });

        // Espelho: receita emitida no MEMED → registra + clona meds em prescricoes.
        // O espelho conhece só nome + posologia (texto livre), não horários nem
        // validade — então entra como RASCUNHO (ativa=FALSE, precisa_confirmar=TRUE)
        // e fica fora dos jobs de lembrete/renovação até o médico confirmar no
        // prontuário (clinical-safety #4: médico no loop; a IA não infere posologia).
        // Idempotente por memed_prescricao_id.
        g.MapPost("/receitas", async (
            [FromBody] MemedReceitaRequest req, AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();
            if (string.IsNullOrWhiteSpace(req.MemedPrescricaoId))
                return Results.BadRequest(new { error = "memedPrescricaoId obrigatório" });

            var ehDoMedico = await db.Database.ExistsAsync(
                "SELECT 1 FROM pacientes WHERE cliente_id = {0} AND medico_responsavel_id = {1}",
                req.PacienteId, medicoId.Value);
            if (!ehDoMedico) return Results.Forbid();

            var jaExiste = await db.Database.ExistsAsync(
                "SELECT 1 FROM receitas_memed WHERE memed_prescricao_id = {0}", req.MemedPrescricaoId);
            if (jaExiste) return Results.Ok(new { jaRegistrada = true, espelhadas = 0 });

            await db.Database.ExecuteSqlRawAsync(
                "INSERT INTO receitas_memed (paciente_id, medico_id, memed_prescricao_id) VALUES ({0},{1},{2})",
                req.PacienteId, medicoId.Value, req.MemedPrescricaoId);

            var espelhadas = 0;
            foreach (var m in req.Medicamentos ?? [])
            {
                if (string.IsNullOrWhiteSpace(m.Nome)) continue;
                // Rascunho: ativa=FALSE + precisa_confirmar=TRUE. Sem horarios/validade,
                // fica fora dos jobs (ambos filtram ativa=TRUE) até o médico confirmar.
                await db.Database.ExecuteSqlRawAsync(@"
                    INSERT INTO prescricoes (paciente_id, medico_id, medicamento, dose_descricao, receita_tipo, ativa, precisa_confirmar)
                    VALUES ({0}, {1}, {2}, {3}, 'memed', FALSE, TRUE)",
                    req.PacienteId, medicoId.Value, m.Nome, m.Posologia ?? "conforme receita");
                espelhadas++;
            }

            return Results.Created("/api/v1/memed/receitas", new { espelhadas });
        });
    }

    private static async Task<Guid?> GetMedicoIdAsync(AppDbContext db, ClaimsPrincipal user)
    {
        var sub = user.FindFirst("sub")?.Value;
        if (!Guid.TryParse(sub, out var userId)) return null;
        return await db.Database.ExecuteScalarAsync<Guid?>(
            "SELECT id FROM medicos WHERE usuario_id = {0}", userId);
    }

    private static async Task<bool> PacienteEhDoMedico(AppDbContext db, Guid pid, ClaimsPrincipal user)
    {
        var medicoId = await GetMedicoIdAsync(db, user);
        if (medicoId is null) return false;
        return await db.Database.ExistsAsync(
            "SELECT 1 FROM pacientes WHERE cliente_id = {0} AND medico_responsavel_id = {1}",
            pid, medicoId.Value);
    }
}

public record MedicoMemedRow(
    Guid MedicoId, string? Nome, string? Crm, string? CrmUf, string? Cpf,
    string? MemedUsuarioId, string? Email);

public record PacienteMemedDto(Guid PacienteId, string? Nome, string? Cpf, string? Telefone);

public record MemedReceitaRequest(
    Guid PacienteId, string MemedPrescricaoId, List<MemedMedicamentoDto>? Medicamentos);

public record MemedMedicamentoDto(string Nome, string? Posologia);
