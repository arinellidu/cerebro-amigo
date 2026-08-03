using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using System.Data.Common;

namespace ApiGateway.Data;

/// <summary>
/// Helpers para consultas escalares cruas no Postgres.
/// O <see cref="DatabaseFacade.SqlQueryRaw{T}"/> do EF Core exige uma coluna
/// chamada <c>Value</c> quando T é tipo primitivo (Guid, int, string),
/// o que torna queries simples como <c>SELECT id FROM ...</c> falhem.
/// Aqui usamos ADO.NET puro com placeholders <c>{0}, {1}</c> compatíveis
/// com o estilo do EF Core para minimizar mudanças no call-site.
/// </summary>
public static class DbExtensions
{
    /// <summary>
    /// Executa um SELECT que retorna um valor escalar único (1ª linha, 1ª coluna).
    /// Os placeholders posicionais <c>{0}, {1}, …</c> são convertidos para
    /// parâmetros nomeados <c>@p0, @p1, …</c>.
    /// </summary>
    public static async Task<T?> ExecuteScalarAsync<T>(
        this DatabaseFacade database,
        string sql,
        params object?[] parameters)
    {
        var conn = database.GetDbConnection();
        var jaAberta = conn.State == System.Data.ConnectionState.Open;
        if (!jaAberta) await conn.OpenAsync();

        try
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = ReplacePositionals(sql, parameters.Length);
            for (var i = 0; i < parameters.Length; i++)
            {
                var p = cmd.CreateParameter();
                p.ParameterName = $"p{i}";
                p.Value = parameters[i] ?? DBNull.Value;
                cmd.Parameters.Add(p);
            }

            var result = await cmd.ExecuteScalarAsync();
            if (result is null || result is DBNull) return default;

            var target = Nullable.GetUnderlyingType(typeof(T)) ?? typeof(T);
            if (target == typeof(Guid) && result is string s) return (T)(object)Guid.Parse(s);
            if (target.IsInstanceOfType(result)) return (T)result;
            return (T)Convert.ChangeType(result, target);
        }
        finally
        {
            if (!jaAberta) await conn.CloseAsync();
        }
    }

    /// <summary>
    /// True se a query retornar pelo menos uma linha.
    /// </summary>
    public static async Task<bool> ExistsAsync(
        this DatabaseFacade database,
        string sql,
        params object?[] parameters)
    {
        var conn = database.GetDbConnection();
        var jaAberta = conn.State == System.Data.ConnectionState.Open;
        if (!jaAberta) await conn.OpenAsync();

        try
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = ReplacePositionals(sql, parameters.Length);
            for (var i = 0; i < parameters.Length; i++)
            {
                var p = cmd.CreateParameter();
                p.ParameterName = $"p{i}";
                p.Value = parameters[i] ?? DBNull.Value;
                cmd.Parameters.Add(p);
            }
            using var reader = await cmd.ExecuteReaderAsync();
            return await reader.ReadAsync();
        }
        finally
        {
            if (!jaAberta) await conn.CloseAsync();
        }
    }

    /// <summary>
    /// Executa um comando que não retorna linhas (INSERT/UPDATE/DELETE) e
    /// devolve o número de linhas afetadas.
    /// <para>
    /// Use no lugar de <c>ExecuteSqlRawAsync</c> do EF Core quando algum
    /// parâmetro puder ser <c>DBNull.Value</c>: o EF tenta mapear o tipo CLR
    /// <c>DBNull</c> para um tipo de banco e estoura
    /// <c>"The current provider doesn't have a store type mapping for properties
    /// of type 'DBNull'"</c>. Aqui usamos ADO.NET puro — o NULL não-tipado é
    /// resolvido pelo Postgres a partir do contexto (coluna do INSERT / outro
    /// ramo do COALESCE).
    /// </para>
    /// </summary>
    public static async Task<int> ExecuteRawAsync(
        this DatabaseFacade database,
        string sql,
        params object?[] parameters)
    {
        var conn = database.GetDbConnection();
        var jaAberta = conn.State == System.Data.ConnectionState.Open;
        if (!jaAberta) await conn.OpenAsync();

        try
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = ReplacePositionals(sql, parameters.Length);
            for (var i = 0; i < parameters.Length; i++)
            {
                var p = cmd.CreateParameter();
                p.ParameterName = $"p{i}";
                p.Value = parameters[i] ?? DBNull.Value;
                cmd.Parameters.Add(p);
            }
            return await cmd.ExecuteNonQueryAsync();
        }
        finally
        {
            if (!jaAberta) await conn.CloseAsync();
        }
    }

    /// <summary>
    /// Registra um acesso a dado clínico de paciente na trilha append-only
    /// <c>acessos_prontuario</c> (LGPD art. 37 — registro das operações de
    /// tratamento). Best-effort: uma falha de log NUNCA quebra a leitura clínica
    /// (disponibilidade do dado &gt; completude do registro de acesso).
    /// </summary>
    public static async Task RegistrarAcessoProntuarioAsync(
        this DatabaseFacade database, Guid medicoId, Guid pacienteId, string recurso)
    {
        try
        {
            await database.ExecuteRawAsync(
                "INSERT INTO acessos_prontuario (medico_id, paciente_id, recurso) VALUES ({0}, {1}, {2})",
                medicoId, pacienteId, recurso);
        }
        catch
        {
            // best-effort — não bloqueia a resposta ao médico.
        }
    }

    private static string ReplacePositionals(string sql, int count)
    {
        // Substitui {0}, {1}, ... por @p0, @p1, ... (Npgsql aceita @ ou : prefixo).
        for (var i = count - 1; i >= 0; i--)
        {
            sql = sql.Replace("{" + i + "}", "@p" + i);
        }
        return sql;
    }
}
