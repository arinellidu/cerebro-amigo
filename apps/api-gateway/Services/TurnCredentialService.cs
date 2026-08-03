using System.Security.Cryptography;
using System.Text;

namespace ApiGateway.Services;

/// <summary>
/// Monta a configuração de ICE (STUN + TURN) que o navegador usa no
/// <c>RTCPeerConnection</c> da teleconsulta P2P.
///
/// O TURN (coturn) usa o esquema <c>use-auth-secret</c> (TURN REST API):
/// nenhuma credencial é armazenada — geramos uma credencial EFÊMERA por
/// chamada, derivada de um segredo compartilhado com o coturn:
///
///   username   = "{expiraUnix}:{sala}"
///   credential = base64( HMAC-SHA1( TURN_SECRET, username ) )
///
/// O coturn valida a mesma HMAC e expira o acesso em <c>expiraUnix</c>.
/// Assim a credencial não vive no banco nem em log (minimização LGPD) e
/// caduca sozinha — sem endpoint para revogar.
///
/// Lembrando: o TURN só RELAYA mídia quando o P2P direto é bloqueado por
/// NAT. No caminho feliz a mídia vai browser↔browser e não toca o coturn.
/// </summary>
public sealed class TurnCredentialService(IConfiguration config, ILogger<TurnCredentialService> logger)
{
    /// <summary>ICE server no formato que o RTCPeerConnection espera (serializa camelCase).</summary>
    public sealed record IceServer(string[] Urls, string? Username = null, string? Credential = null);

    private string[] StunUrls => Split(config["STUN_URLS"]) is { Length: > 0 } s
        ? s
        : ["stun:stun.l.google.com:19302"];

    private string[] TurnUrls => Split(config["TURN_URLS"]);

    private string? Secret => config["TURN_SECRET"];

    private int TtlSeconds =>
        int.TryParse(config["TURN_TTL_SECONDS"], out var t) && t > 0 ? t : 3600;

    /// <summary>
    /// Lista de ICE servers para uma sala. Sempre inclui STUN; inclui TURN com
    /// credencial efêmera se <c>TURN_SECRET</c> + <c>TURN_URLS</c> estiverem
    /// configurados. Sem TURN, a chamada ainda funciona em redes sem NAT
    /// simétrico (a maioria), mas pode falhar atrás de CGNAT — por isso logamos.
    /// </summary>
    public IReadOnlyList<IceServer> BuildIceServers(string sala)
    {
        var servers = new List<IceServer> { new(StunUrls) };

        var secret = Secret;
        var turnUrls = TurnUrls;
        if (string.IsNullOrWhiteSpace(secret) || turnUrls.Length == 0)
        {
            logger.LogWarning(
                "TURN não configurado (TURN_SECRET/TURN_URLS ausentes); "
                + "teleconsulta usará apenas STUN — pode falhar atrás de CGNAT.");
            return servers;
        }

        var expira = DateTimeOffset.UtcNow.AddSeconds(TtlSeconds).ToUnixTimeSeconds();
        // userid curto e sem PII — a sala é o id da consulta (UUID).
        var username = $"{expira}:{sala}";
        var credential = ComputeHmacBase64(secret, username);

        servers.Add(new IceServer(turnUrls, username, credential));
        return servers;
    }

    private static string ComputeHmacBase64(string secret, string message)
    {
        using var hmac = new HMACSHA1(Encoding.UTF8.GetBytes(secret));
        var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(message));
        return Convert.ToBase64String(hash);
    }

    private static string[] Split(string? csv) =>
        string.IsNullOrWhiteSpace(csv)
            ? []
            : csv.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
}
