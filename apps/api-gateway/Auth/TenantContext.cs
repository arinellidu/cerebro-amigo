using ApiGateway.Data;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace ApiGateway.Auth;

/// <summary>
/// Resolve o tenant (médico) do JWT e expõe helpers de tenant check.
/// Injete como Scoped via DI.
/// </summary>
public interface ITenantContext
{
    /// <summary>
    /// Retorna o medico_id do usuário logado, ou null se não for médico.
    /// </summary>
    Task<Guid?> GetMedicoIdAsync();

    /// <summary>
    /// Retorna true se o paciente (cliente_id) pertence ao médico logado.
    /// </summary>
    Task<bool> PacienteEhDoMedicoAsync(Guid clienteId);
}

public sealed class TenantContext(AppDbContext db, IHttpContextAccessor http) : ITenantContext
{
    public async Task<Guid?> GetMedicoIdAsync()
    {
        var user = http.HttpContext?.User;
        var sub = user?.FindFirst("sub")?.Value;
        if (!Guid.TryParse(sub, out var userId)) return null;

        return await db.Database.ExecuteScalarAsync<Guid?>(
            "SELECT id FROM medicos WHERE usuario_id = {0}", userId);
    }

    public async Task<bool> PacienteEhDoMedicoAsync(Guid clienteId)
    {
        var medicoId = await GetMedicoIdAsync();
        if (medicoId is null) return false;

        return await db.Database.ExistsAsync(
            "SELECT 1 FROM pacientes WHERE cliente_id = {0} AND medico_responsavel_id = {1}",
            clienteId, medicoId.Value);
    }
}
