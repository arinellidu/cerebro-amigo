using System.Net;
using Npgsql;
using Xunit;

namespace ApiGateway.Tests;

/// <summary>
/// T1-7 — revogação de JWT por `token_version`. Troca/reset de senha bumpa
/// usuarios/pacientes_credenciais.token_version; o `OnTokenValidated` (Program.cs)
/// rejeita (401) tokens com claim `tv` divergente. Token SEM `tv` (legado, emitido
/// antes do deploy) passa — transição graciosa, sem logout em massa.
///
/// Asserção em 401-vs-não-401 (não em 200): o que importa é a camada de auth aceitar
/// ou rejeitar o token; um eventual erro do handler (ex.: usuário sem registro de
/// médico) é != 401 e não confunde o sinal.
/// </summary>
[Collection("tenant")]
public class TokenVersionRevocationTests(TenantIsolationFixture fx)
{
    [Fact]
    public async Task Medico_TvAtualAceito_VersaoVelhaRejeitadaAposBump()
    {
        // Usuário descartável (token_version = 1, default da 0055) — isolado dos tenants.
        var uid = Guid.NewGuid();
        await Exec(@"INSERT INTO usuarios (id,email,senha_hash,nome,role)
                     VALUES (@id, @e, 'x', 'TV Throwaway', 'medico')",
            ("id", uid), ("e", $"tv-{uid}@example.com"));

        const string probe = "/api/v1/auth/me";

        // tv=1 casa com o banco → aceito (não 401).
        var c1 = fx.ClientForMedicoTv(uid, 1);
        Assert.NotEqual(HttpStatusCode.Unauthorized, (await c1.GetAsync(probe)).StatusCode);

        // Simula troca/reset de senha: bumpa a versão no banco.
        await Exec("UPDATE usuarios SET token_version = token_version + 1 WHERE id = @id", ("id", uid));

        // MESMO token (tv=1) agora diverge (DB=2) → 401 (sessão revogada).
        Assert.Equal(HttpStatusCode.Unauthorized, (await c1.GetAsync(probe)).StatusCode);

        // Token reemitido com tv=2 → aceito de novo.
        var c2 = fx.ClientForMedicoTv(uid, 2);
        Assert.NotEqual(HttpStatusCode.Unauthorized, (await c2.GetAsync(probe)).StatusCode);
    }

    [Fact]
    public async Task Medico_SemClaimTv_Passa_TransicaoGraciosa()
    {
        // Token legado (sem `tv`) → OnTokenValidated não tem o que comparar → passa.
        var c = fx.ClientForMedicoTv(fx.UsuarioA, null);
        Assert.NotEqual(HttpStatusCode.Unauthorized,
            (await c.GetAsync("/api/v1/auth/me")).StatusCode);
    }

    [Fact]
    public async Task Paciente_TvAtualAceito_VersaoVelhaRejeitadaAposBump()
    {
        // Credencial do PacienteB (seedado como cliente/paciente) com token_version=1.
        await Exec(@"INSERT INTO pacientes_credenciais (paciente_id, email, senha_hash, token_version)
                     VALUES (@id, 'pb-tv@example.com', 'x', 1)
                     ON CONFLICT (paciente_id) DO UPDATE SET token_version = 1, senha_hash = 'x'",
            ("id", fx.PacienteB));

        const string probe = "/api/v1/portal/paciente/perfil";

        var c1 = fx.ClientForPacienteTv(fx.PacienteB, 1);
        Assert.NotEqual(HttpStatusCode.Unauthorized, (await c1.GetAsync(probe)).StatusCode);

        await Exec("UPDATE pacientes_credenciais SET token_version = token_version + 1 WHERE paciente_id = @id",
            ("id", fx.PacienteB));

        Assert.Equal(HttpStatusCode.Unauthorized, (await c1.GetAsync(probe)).StatusCode);
    }

    private async Task Exec(string sql, params (string, object)[] ps)
    {
        await using var conn = await fx.OpenDbAsync();
        await using var cmd = new NpgsqlCommand(sql, conn);
        foreach (var (n, v) in ps) cmd.Parameters.AddWithValue(n, v);
        await cmd.ExecuteNonQueryAsync();
    }
}
