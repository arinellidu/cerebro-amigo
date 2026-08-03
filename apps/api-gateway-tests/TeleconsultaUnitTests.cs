using System.Security.Cryptography;
using System.Text;
using ApiGateway.Services;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace ApiGateway.Tests;

/// <summary>
/// Testes de unidade da teleconsulta (ADR-026) — sem banco, sem Testcontainers.
/// Cobrem as duas peças puras: credencial TURN efêmera e o hub de sinalização.
/// </summary>
public sealed class TurnCredentialServiceTests
{
    private static TurnCredentialService Build(Dictionary<string, string?> cfg) =>
        new(
            new ConfigurationBuilder().AddInMemoryCollection(cfg).Build(),
            NullLogger<TurnCredentialService>.Instance);

    [Fact]
    public void SemTurnConfigurado_RetornaSoStun_ComFallbackGoogle()
    {
        var servers = Build(new Dictionary<string, string?>()).BuildIceServers("sala-1");

        var unico = Assert.Single(servers);
        Assert.Equal(new[] { "stun:stun.l.google.com:19302" }, unico.Urls);
        Assert.Null(unico.Username);
        Assert.Null(unico.Credential);
    }

    [Fact]
    public void StunUrlsCustomizadas_SaoRespeitadas()
    {
        var servers = Build(new Dictionary<string, string?>
        {
            ["STUN_URLS"] = "stun:a.example:3478, stun:b.example:3478",
        }).BuildIceServers("sala-1");

        Assert.Equal(
            new[] { "stun:a.example:3478", "stun:b.example:3478" },
            Assert.Single(servers).Urls);
    }

    [Fact]
    public void TurnSecretSemUrls_NaoGeraServidorTurn()
    {
        var servers = Build(new Dictionary<string, string?>
        {
            ["TURN_SECRET"] = "segredo",
        }).BuildIceServers("sala-1");

        Assert.Single(servers); // só STUN
    }

    [Fact]
    public void TurnConfigurado_GeraCredencialEfemeraValidaPeloCoturn()
    {
        const string secret = "segredo-compartilhado";
        const string sala = "0b9c6a1e-consulta";
        var antes = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

        var servers = Build(new Dictionary<string, string?>
        {
            ["TURN_SECRET"] = secret,
            ["TURN_URLS"] = "turn:1.2.3.4:3478?transport=udp",
            ["TURN_TTL_SECONDS"] = "600",
        }).BuildIceServers(sala);

        Assert.Equal(2, servers.Count);
        var turn = servers[1];
        Assert.Equal(new[] { "turn:1.2.3.4:3478?transport=udp" }, turn.Urls);

        // username = "{expiraUnix}:{sala}" com expiração ≈ agora + TTL
        var partes = turn.Username!.Split(':', 2);
        var expira = long.Parse(partes[0]);
        Assert.Equal(sala, partes[1]);
        Assert.InRange(expira, antes + 600, antes + 605);

        // credential = base64(HMAC-SHA1(secret, username)) — mesma conta do coturn
        using var hmac = new HMACSHA1(Encoding.UTF8.GetBytes(secret));
        var esperado = Convert.ToBase64String(
            hmac.ComputeHash(Encoding.UTF8.GetBytes(turn.Username!)));
        Assert.Equal(esperado, turn.Credential);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("0")]
    [InlineData("abc")]
    public void TtlInvalidoOuAusente_CaiParaDefault3600(string? ttl)
    {
        var antes = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var servers = Build(new Dictionary<string, string?>
        {
            ["TURN_SECRET"] = "s",
            ["TURN_URLS"] = "turn:1.2.3.4:3478",
            ["TURN_TTL_SECONDS"] = ttl,
        }).BuildIceServers("sala");

        var expira = long.Parse(servers[1].Username!.Split(':', 2)[0]);
        Assert.InRange(expira, antes + 3600, antes + 3605);
    }
}

/// <summary>
/// Hub de sinalização: pareamento médico↔paciente, presença, reconexão e
/// limpeza de sala. Tudo síncrono e em RAM — TryRead é determinístico aqui.
/// </summary>
public sealed class TeleconsultaSignalingHubTests
{
    private static readonly string PresencaOnline = "{\"tipo\":\"presenca\",\"online\":true}";
    private static readonly string PresencaOffline = "{\"tipo\":\"presenca\",\"online\":false}";

    private static string Lida(TeleconsultaSignalingHub.Subscription sub)
    {
        Assert.True(sub.Reader.TryRead(out var msg));
        return msg!;
    }

    [Fact]
    public void PrimeiroPeer_RecebeOutroOffline()
    {
        var hub = new TeleconsultaSignalingHub();
        using var medico = hub.Subscribe(Guid.NewGuid(), TeleconsultaSignalingHub.PapelMedico);

        Assert.Equal(PresencaOffline, Lida(medico));
    }

    [Fact]
    public void SegundoPeer_AmbosFicamOnline()
    {
        var hub = new TeleconsultaSignalingHub();
        var sala = Guid.NewGuid();
        using var medico = hub.Subscribe(sala, TeleconsultaSignalingHub.PapelMedico);
        Lida(medico); // descarta presença inicial (offline)

        using var paciente = hub.Subscribe(sala, TeleconsultaSignalingHub.PapelPaciente);

        Assert.Equal(PresencaOnline, Lida(paciente)); // médico já estava lá
        Assert.Equal(PresencaOnline, Lida(medico));   // avisado da entrada
    }

    [Fact]
    public void Publish_EntregaApenasAoOutroPeer()
    {
        var hub = new TeleconsultaSignalingHub();
        var sala = Guid.NewGuid();
        using var medico = hub.Subscribe(sala, TeleconsultaSignalingHub.PapelMedico);
        using var paciente = hub.Subscribe(sala, TeleconsultaSignalingHub.PapelPaciente);
        Lida(medico); Lida(medico); Lida(paciente); // drena presenças

        Assert.True(hub.Publish(sala, TeleconsultaSignalingHub.PapelMedico, "{\"sdp\":\"offer\"}"));

        Assert.Equal("{\"sdp\":\"offer\"}", Lida(paciente));
        Assert.False(medico.Reader.TryRead(out _)); // não ecoa pro remetente
    }

    [Fact]
    public void PublishSemDestinatario_RetornaFalse()
    {
        var hub = new TeleconsultaSignalingHub();
        var sala = Guid.NewGuid();
        using var medico = hub.Subscribe(sala, TeleconsultaSignalingHub.PapelMedico);

        Assert.False(hub.Publish(sala, TeleconsultaSignalingHub.PapelMedico, "x"));
        Assert.False(hub.Publish(Guid.NewGuid(), TeleconsultaSignalingHub.PapelMedico, "x"));
    }

    [Fact]
    public void Dispose_AvisaOutroPeerQueSaiu()
    {
        var hub = new TeleconsultaSignalingHub();
        var sala = Guid.NewGuid();
        using var medico = hub.Subscribe(sala, TeleconsultaSignalingHub.PapelMedico);
        var paciente = hub.Subscribe(sala, TeleconsultaSignalingHub.PapelPaciente);
        Lida(medico); Lida(medico); Lida(paciente); // drena presenças

        paciente.Dispose();

        Assert.Equal(PresencaOffline, Lida(medico));
        Assert.False(hub.Publish(sala, TeleconsultaSignalingHub.PapelMedico, "x"));
    }

    [Fact]
    public void Reconexao_DoMesmoPapel_RedirecionaParaNovoCanal()
    {
        var hub = new TeleconsultaSignalingHub();
        var sala = Guid.NewGuid();
        using var medico = hub.Subscribe(sala, TeleconsultaSignalingHub.PapelMedico);
        var pacienteAntigo = hub.Subscribe(sala, TeleconsultaSignalingHub.PapelPaciente);
        Lida(pacienteAntigo); // drena a presença inicial (médico online)

        using var pacienteNovo = hub.Subscribe(sala, TeleconsultaSignalingHub.PapelPaciente);

        // Canal antigo foi encerrado pela reconexão (vazio + completo)…
        Assert.False(pacienteAntigo.Reader.TryRead(out _));
        Assert.True(pacienteAntigo.Reader.Completion.IsCompleted);
        // …e o Dispose tardio do antigo (fim do SSE velho) não derruba o novo.
        pacienteAntigo.Dispose();
        Assert.True(hub.Publish(sala, TeleconsultaSignalingHub.PapelMedico, "pro-novo"));

        // Drena a presença inicial do novo canal e lê a mensagem relayada.
        Assert.Equal(PresencaOnline, Lida(pacienteNovo));
        Assert.Equal("pro-novo", Lida(pacienteNovo));
    }

    [Fact]
    public void SalaEsvaziada_EhRemovida_PublishVoltaFalse()
    {
        var hub = new TeleconsultaSignalingHub();
        var sala = Guid.NewGuid();
        var medico = hub.Subscribe(sala, TeleconsultaSignalingHub.PapelMedico);
        var paciente = hub.Subscribe(sala, TeleconsultaSignalingHub.PapelPaciente);

        medico.Dispose();
        paciente.Dispose();

        Assert.False(hub.Publish(sala, TeleconsultaSignalingHub.PapelMedico, "x"));
        Assert.False(hub.Publish(sala, TeleconsultaSignalingHub.PapelPaciente, "x"));
    }
}
