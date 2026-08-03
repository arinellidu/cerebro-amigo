using ApiGateway.Auth;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using Xunit;

namespace ApiGateway.Tests;

/// <summary>
/// Fallback in-memory do LoginRateLimiter (T1-1) — sem banco, a política
/// 5 falhas/15min continua valendo por nó (comportamento pré-T1-1).
/// </summary>
public sealed class LoginRateLimiterFallbackTests
{
    private static LoginRateLimiter Build() =>
        new(null, NullLogger<LoginRateLimiter>.Instance);

    [Fact]
    public async Task QuatroFalhas_NaoBloqueia()
    {
        var rl = Build();
        for (var i = 0; i < 4; i++)
            await rl.RecordFailureAsync("a@example.com");

        Assert.False(await rl.IsBlockedAsync("a@example.com"));
    }

    [Fact]
    public async Task CincoFalhas_Bloqueia_E_SucessoLimpa()
    {
        var rl = Build();
        for (var i = 0; i < 5; i++)
            await rl.RecordFailureAsync("b@example.com");

        Assert.True(await rl.IsBlockedAsync("b@example.com"));
        Assert.False(await rl.IsBlockedAsync("outro@example.com"));

        await rl.RecordSuccessAsync("b@example.com");
        Assert.False(await rl.IsBlockedAsync("b@example.com"));
    }
}

/// <summary>
/// Caminho Postgres do LoginRateLimiter (T1-1): o bloqueio feito por uma
/// instância vale para OUTRA instância (estado compartilhado no banco) —
/// exatamente o cenário multi-node que o in-memory não cobria.
/// Usa a tabela login_rate_limits criada pela migration 0043 no fixture.
/// </summary>
[Collection("tenant")]
public sealed class LoginRateLimiterPostgresTests(TenantIsolationFixture fx) : IAsyncLifetime
{
    private NpgsqlDataSource _ds = default!;

    public Task InitializeAsync()
    {
        // Role restrito do gateway (espelha prod): grants do fixture cobrem a tabela.
        _ds = NpgsqlDataSource.Create(fx.GatewayConnectionString);
        return Task.CompletedTask;
    }

    public async Task DisposeAsync() => await _ds.DisposeAsync();

    private LoginRateLimiter Build() =>
        new(_ds, NullLogger<LoginRateLimiter>.Instance);

    [Fact]
    public async Task BloqueioFeitoNumaInstancia_ValeNaOutra()
    {
        var noA = Build();
        var noB = Build();
        var email = $"distribuido-{Guid.NewGuid():N}@example.com";

        for (var i = 0; i < 4; i++)
            Assert.False(await noA.RecordFailureAsync(email));

        // 5ª falha bloqueia — e o OUTRO nó enxerga o bloqueio.
        Assert.True(await noA.RecordFailureAsync(email));
        Assert.True(await noB.IsBlockedAsync(email));

        // Sucesso registrado num nó desbloqueia em todos.
        await noB.RecordSuccessAsync(email);
        Assert.False(await noA.IsBlockedAsync(email));
    }

    [Fact]
    public async Task ChaveNaoFicaCruaNoBanco()
    {
        var rl = Build();
        var email = $"lgpd-{Guid.NewGuid():N}@example.com";
        await rl.RecordFailureAsync(email);

        await using var conn = await fx.OpenDbAsync();
        await using var cmd = new NpgsqlCommand(
            "SELECT count(*) FROM login_rate_limits WHERE chave ILIKE '%@%'", conn);
        Assert.Equal(0L, await cmd.ExecuteScalarAsync());
    }
}
