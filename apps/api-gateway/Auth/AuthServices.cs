using ApiGateway.Models;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;

namespace ApiGateway.Auth;

public interface IPasswordHasher
{
    string Hash(string password);
    bool Verify(string password, string hash);
    /// <summary>
    /// True se o hash for do algoritmo legado (PBKDF2) e precisar ser
    /// re-hashed para bcrypt no próximo login bem-sucedido.
    /// </summary>
    bool NeedsRehash(string hash);
}

/// <summary>
/// Bcrypt com fallback PBKDF2 — migração gradual sem quebrar logins existentes.
///
/// Novos hashes: bcrypt (work factor 12).
/// Verificação: tenta bcrypt primeiro; se falhar, tenta PBKDF2 legado.
/// Rehash: <see cref="NeedsRehash"/> detecta hash legado; o caller (login)
/// pode re-hash após verificação OK e atualizar o banco.
/// </summary>
public class PasswordHasher : IPasswordHasher
{
    private const int BcryptWorkFactor = 12;

    // ─── Legacy PBKDF2 constants ───
    private const int SaltSize = 16;
    private const int HashSize = 32;
    private const int Iterations = 100_000;

    public string Hash(string password)
    {
        return BCrypt.Net.BCrypt.HashPassword(password, BcryptWorkFactor);
    }

    public bool Verify(string password, string hash)
    {
        // 1. Tentativa bcrypt (algoritmo novo, mais comum no futuro)
        // Só tenta bcrypt se o hash começar com '$2' (formato bcrypt)
        if (hash.StartsWith("$2"))
        {
            if (BCrypt.Net.BCrypt.Verify(password, hash))
                return true;
        }

        // 2. Fallback PBKDF2 (hash legado — dados antigos ainda não re-hashed)
        return _verifyLegacyPbkdf2(password, hash);
    }

    public bool NeedsRehash(string hash)
    {
        // Hash bcrypt começa com '$2'; hash PBKDF2 é base64 cru
        return !hash.StartsWith("$2");
    }

    private static bool _verifyLegacyPbkdf2(string password, string base64)
    {
        try
        {
            var bytes = Convert.FromBase64String(base64);
            if (bytes.Length != SaltSize + HashSize) return false;

            var salt = bytes[..SaltSize];
            var expected = bytes[SaltSize..];
            var actual = Rfc2898DeriveBytes.Pbkdf2(
                password, salt, Iterations, HashAlgorithmName.SHA256, HashSize);

            return CryptographicOperations.FixedTimeEquals(expected, actual);
        }
        catch
        {
            return false;
        }
    }
}

public class TokenService(IConfiguration config)
{
    public string GenerateForUser(Usuario user)
    {
        var secret = config["Jwt:Secret"] is { Length: > 0 } s ? s : config["JWT_SECRET"]
                     ?? throw new InvalidOperationException("Jwt:Secret / JWT_SECRET obrigatório");
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new Claim(JwtRegisteredClaimNames.Email, user.Email),
            new Claim("name", user.Nome),
            new Claim("role", user.Role),
            new Claim("tv", user.TokenVersion.ToString()),  // T1-7: versão de sessão (revogação)
            new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString())
        };

        var token = new JwtSecurityToken(
            issuer: config["Jwt:Issuer"] ?? "cerebro-amigo",
            audience: config["Jwt:Audience"] ?? "dashboard",
            claims: claims,
            expires: DateTime.UtcNow.AddHours(8),
            signingCredentials: creds);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
