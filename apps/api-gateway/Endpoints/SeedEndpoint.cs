using ApiGateway.Auth;
using ApiGateway.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ApiGateway.Endpoints;

/// <summary>
/// Endpoint de seed — cria o primeiro médico no sistema.
///
/// Só aceita requisição se NÃO houver médico cadastrado ainda. Depois disso,
/// fica desativado automaticamente. Essa é a única forma de criar o primeiro
/// usuário sem ter outro usuário pra autenticar.
///
/// Após o primeiro médico, novos médicos são cadastrados via dashboard
/// (rota administrativa autenticada — fora do escopo desta versão MVP).
/// </summary>
public static class SeedEndpoint
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/seed").WithTags("seed");

        // POST /api/v1/seed/primeiro-medico — público, mas só funciona 1 vez
        g.MapPost("/primeiro-medico", async (
            [FromBody] PrimeiroMedicoRequest req,
            AppDbContext db, IPasswordHasher hasher) =>
        {
            // Bloqueio: só roda se NÃO houver médico ainda
            var jaExiste = await db.Database.ExecuteScalarAsync<int>(
                "SELECT COUNT(*)::int FROM medicos");
            if (jaExiste > 0)
                return Results.Conflict(new {
                    error = "seed_already_done",
                    message = "Já existe médico cadastrado. Use o login normal."
                });

            if (string.IsNullOrWhiteSpace(req.Email) ||
                string.IsNullOrWhiteSpace(req.Senha) ||
                string.IsNullOrWhiteSpace(req.Nome) ||
                string.IsNullOrWhiteSpace(req.Crm))
                return Results.BadRequest(new { error = "campos obrigatórios faltando" });

            if (req.Senha.Length < 8)
                return Results.BadRequest(new { error = "senha mínimo 8 caracteres" });

            var senhaHash = hasher.Hash(req.Senha);
            var usuarioId = Guid.NewGuid();
            var medicoId = Guid.NewGuid();

            // Cria usuário
            await db.Database.ExecuteSqlRawAsync(@"
                INSERT INTO usuarios (id, email, senha_hash, nome, role)
                VALUES ({0}, {1}, {2}, {3}, 'admin')",
                usuarioId, req.Email.ToLowerInvariant(), senhaHash, req.Nome);

            // Cria médico
            await db.Database.ExecuteSqlRawAsync(@"
                INSERT INTO medicos (id, usuario_id, nome, crm, wa_id, especialidade)
                VALUES ({0}, {1}, {2}, {3}, NULLIF({4}, ''), 'psiquiatria')",
                medicoId, usuarioId, req.Nome, req.Crm, req.WaId ?? "");

            // Cria assinatura ativa (dono do sistema — sem cobrança).
            await db.Database.ExecuteSqlRawAsync(@"
                INSERT INTO assinaturas (id, medico_id, plano, valor_mensal, status, notas)
                VALUES ({0}, {1}, 'master', 0, 'ativa', 'owner — seed endpoint')",
                Guid.NewGuid(), medicoId);

            return Results.Created("/login", new
            {
                usuarioId,
                medicoId,
                message = "Primeiro médico criado. Faça login na rota /login.",
            });
        });
    }
}

public record PrimeiroMedicoRequest(
    string Email,
    string Senha,
    string Nome,
    string Crm,
    string? WaId);
