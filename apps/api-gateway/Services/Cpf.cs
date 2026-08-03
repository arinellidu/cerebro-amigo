namespace ApiGateway.Services;

/// <summary>
/// Validação + normalização de CPF (dígitos verificadores). Fonte única — usada no
/// signup, no /me/config e no admin. Espelha lib/cpf do front. Armazenar SEMPRE o CPF
/// normalizado (só dígitos): o Asaas rejeita CPF formatado na criação de customer.
/// </summary>
public static class Cpf
{
    public static string Normalizar(string? cpf) =>
        new string((cpf ?? "").Where(char.IsDigit).ToArray());

    public static bool Valido(string? cpf)
    {
        var d = Normalizar(cpf);
        if (d.Length != 11 || d.Distinct().Count() == 1) return false;
        int Soma(int len) { var s = 0; for (var i = 0; i < len; i++) s += (d[i] - '0') * (len + 1 - i); return s; }
        int Dig(int soma) { var r = soma % 11; return r < 2 ? 0 : 11 - r; }
        return Dig(Soma(9)) == d[9] - '0' && Dig(Soma(10)) == d[10] - '0';
    }
}
