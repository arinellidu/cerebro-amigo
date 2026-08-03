using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using Npgsql;

namespace ApiGateway.Auth;

/// <summary>
/// Rate limiter de tentativas de login/signup/magic-link.
///
/// Política: até 5 tentativas falhas em 15 minutos por chave (e-mail
/// normalizado ou "signup:&lt;ip&gt;"). Na 5ª falha, a chave bloqueia por 15 min.
///
/// Estado no Postgres (tabela <c>login_rate_limits</c>, migration 0043) — a
/// política vale para N instâncias do gateway atrás de load balancer (T1-1).
/// A chave é armazenada como SHA-256 (minimização LGPD: e-mail/IP nunca crus).
///
/// Fail-soft: indisponibilidade do banco não derruba o login — cai para o
/// contador in-memory (por nó, comportamento pré-T1-1) e loga warning.
/// </summary>
public class LoginRateLimiter(NpgsqlDataSource? dataSource, ILogger<LoginRateLimiter> logger)
{
    private static readonly TimeSpan Janela = TimeSpan.FromMinutes(15);
    private const int MaxTentativas = 5;

    /// <summary>
    /// Registra uma tentativa falha. Retorna true se a chave ficou bloqueada.
    /// </summary>
    public async Task<bool> RecordFailureAsync(string chave)
    {
        var key = Hash(chave);
        if (dataSource is not null)
        {
            try
            {
                // UPSERT atômico: reinicia a janela se expirou; senão incrementa e,
                // ao cruzar o teto, marca blocked_until = agora + janela.
                await using var cmd = dataSource.CreateCommand("""
                    INSERT INTO login_rate_limits AS rl (chave, hits, window_start, blocked_until)
                    VALUES ($1, 1, now(), NULL)
                    ON CONFLICT (chave) DO UPDATE SET
                        hits = CASE WHEN now() - rl.window_start > $2
                                    THEN 1 ELSE rl.hits + 1 END,
                        blocked_until = CASE
                            WHEN now() - rl.window_start > $2 THEN NULL
                            WHEN rl.hits + 1 >= $3 THEN now() + $2
                            ELSE rl.blocked_until END,
                        window_start = CASE WHEN now() - rl.window_start > $2
                                            THEN now() ELSE rl.window_start END
                    RETURNING blocked_until IS NOT NULL AND blocked_until > now()
                    """);
                cmd.Parameters.Add(new() { Value = key });
                cmd.Parameters.Add(new() { Value = Janela });
                cmd.Parameters.Add(new() { Value = MaxTentativas });
                var bloqueado = (bool)(await cmd.ExecuteScalarAsync())!;

                // Limpeza oportunista (~2% das falhas) de janelas velhas.
                if (Random.Shared.Next(50) == 0)
                    await PruneAsync();

                return bloqueado;
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex,
                    "login_rate_limits indisponível; usando fallback in-memory (por nó)");
            }
        }

        return RecordFailureInMemory(key);
    }

    /// <summary>
    /// Registra um login bem-sucedido (limpa o contador).
    /// </summary>
    public async Task RecordSuccessAsync(string chave)
    {
        var key = Hash(chave);
        _fallback.TryRemove(key, out _);

        if (dataSource is null) return;
        try
        {
            await using var cmd = dataSource.CreateCommand(
                "DELETE FROM login_rate_limits WHERE chave = $1");
            cmd.Parameters.Add(new() { Value = key });
            await cmd.ExecuteNonQueryAsync();
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex,
                "login_rate_limits indisponível; usando fallback in-memory (por nó)");
        }
    }

    /// <summary>
    /// Verifica se a chave está bloqueada no momento.
    /// </summary>
    public async Task<bool> IsBlockedAsync(string chave)
    {
        var key = Hash(chave);

        // O fallback in-memory só acumula estado durante indisponibilidade do
        // banco; o OR mantém a proteção através de oscilações da conexão.
        if (IsBlockedInMemory(key))
            return true;

        if (dataSource is null) return false;
        try
        {
            await using var cmd = dataSource.CreateCommand("""
                SELECT blocked_until IS NOT NULL AND blocked_until > now()
                FROM login_rate_limits
                WHERE chave = $1 AND now() - window_start <= $2
                """);
            cmd.Parameters.Add(new() { Value = key });
            cmd.Parameters.Add(new() { Value = Janela });
            return await cmd.ExecuteScalarAsync() is true;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex,
                "login_rate_limits indisponível; usando fallback in-memory (por nó)");
            return false;
        }
    }

    /// <summary>Remove janelas expiradas (banco + fallback in-memory).</summary>
    public async Task PruneAsync()
    {
        var now = DateTime.UtcNow;
        foreach (var kv in _fallback)
        {
            if (now - kv.Value.WindowStart > Janela)
                _fallback.TryRemove(kv.Key, out _);
        }

        if (dataSource is null) return;
        await using var cmd = dataSource.CreateCommand(
            "DELETE FROM login_rate_limits WHERE window_start < now() - $1");
        cmd.Parameters.Add(new() { Value = Janela * 2 });
        await cmd.ExecuteNonQueryAsync();
    }

    private static string Hash(string chave) =>
        Convert.ToHexString(SHA256.HashData(
            Encoding.UTF8.GetBytes(chave.Trim().ToLowerInvariant())));

    // ── Fallback in-memory (por nó) — lógica pré-T1-1, usada só sem banco ──

    private readonly record struct AttemptState(int Count, DateTime WindowStart, DateTime? BlockedUntil);

    private readonly ConcurrentDictionary<string, AttemptState> _fallback = new();

    private bool RecordFailureInMemory(string key)
    {
        var now = DateTime.UtcNow;
        _fallback.AddOrUpdate(key,
            _ => new AttemptState(1, now, null),
            (_, existing) =>
            {
                // Janela expirou → reinicia contagem
                if (now - existing.WindowStart > Janela)
                    return new AttemptState(1, now, null);

                var newCount = existing.Count + 1;
                var blocked = newCount >= MaxTentativas ? now.Add(Janela) : existing.BlockedUntil;
                return new AttemptState(newCount, existing.WindowStart, blocked);
            });

        return IsBlockedInMemory(key);
    }

    private bool IsBlockedInMemory(string key)
    {
        if (!_fallback.TryGetValue(key, out var state))
            return false;

        var now = DateTime.UtcNow;
        if (now - state.WindowStart > Janela)
        {
            _fallback.TryRemove(key, out _);
            return false;
        }

        return state.BlockedUntil.HasValue && state.BlockedUntil.Value > now;
    }
}
