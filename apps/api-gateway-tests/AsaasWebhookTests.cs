using System.Net;
using System.Text;
using System.Text.Json;
using Xunit;

namespace ApiGateway.Tests;

/// <summary>
/// Webhook do Asaas (`POST /api/v1/asaas/webhook`) — endpoint ANÔNIMO que altera estado
/// financeiro (confirma cobrança, ativa/suspende/cancela assinatura). Asaas NÃO assina o
/// corpo (sem HMAC; confirmado nos docs 2026-06-20) → o header `asaas-access-token` é a
/// ÚNICA camada de auth. A comparação é constante-time (timing-attack safe), espelhando o
/// INTERNAL_API_TOKEN. Estes testes travam a regressão: token errado/ausente é barrado;
/// token correto passa e um evento sem alvo conhecido é no-op seguro.
/// </summary>
[Collection("tenant")]
public class AsaasWebhookTests(TenantIsolationFixture fx)
{
    private const string Url = "/api/v1/asaas/webhook";

    private static StringContent Body() => new(
        JsonSerializer.Serialize(new { @event = "PAYMENT_CONFIRMED", payment = new { id = "pay_smoke_inexistente" } }),
        Encoding.UTF8, "application/json");

    [Fact]
    public async Task TokenErrado_401()
    {
        var c = fx.AnonClient();
        c.DefaultRequestHeaders.Add("asaas-access-token", "token-errado");
        Assert.Equal(HttpStatusCode.Unauthorized, (await c.PostAsync(Url, Body())).StatusCode);
    }

    [Fact]
    public async Task SemToken_401()
    {
        var c = fx.AnonClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await c.PostAsync(Url, Body())).StatusCode);
    }

    [Fact]
    public async Task TokenCorreto_Aceita_NoOpSeguro_200()
    {
        var c = fx.AnonClient();
        c.DefaultRequestHeaders.Add("asaas-access-token", TenantIsolationFixture.AsaasWebhookToken);
        // payment.id sem casar nenhuma cobrança/assinatura → processa e ignora (200), sem tocar dado.
        Assert.Equal(HttpStatusCode.OK, (await c.PostAsync(Url, Body())).StatusCode);
    }
}
