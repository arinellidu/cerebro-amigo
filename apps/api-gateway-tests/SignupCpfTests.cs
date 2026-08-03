using System.Net;
using System.Text;
using Xunit;

namespace ApiGateway.Tests;

/// <summary>
/// CPF obrigatório no signup do médico (ADR-065). Os guards de CPF rodam ANTES da
/// consulta paga ao CFM, então estes testes não dependem de rede/Infosimples.
/// </summary>
[Collection("tenant")]
public sealed class SignupCpfTests
{
    private readonly TenantIsolationFixture _fx;
    public SignupCpfTests(TenantIsolationFixture fx) => _fx = fx;

    private static StringContent Json(string s) => new(s, Encoding.UTF8, "application/json");

    [Fact]
    public async Task Signup_SemCpf_400_CpfObrigatorio()
    {
        var anon = _fx.AnonClient();
        var r = await anon.PostAsync("/api/v1/auth/medico/signup",
            Json("{\"nome\":\"Dra Teste\",\"email\":\"sem.cpf@ex.com\",\"crm\":\"123456\",\"crmUf\":\"SP\"}"));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Contains("cpf_obrigatorio", await r.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Signup_CpfInvalido_400_CpfInvalido()
    {
        var anon = _fx.AnonClient();
        var r = await anon.PostAsync("/api/v1/auth/medico/signup",
            Json("{\"nome\":\"Dra Teste\",\"email\":\"cpf.ruim@ex.com\",\"crm\":\"123456\",\"crmUf\":\"SP\",\"cpf\":\"11111111111\"}"));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Contains("cpf_invalido", await r.Content.ReadAsStringAsync());
    }
}
