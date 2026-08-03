using ApiGateway.Services;
using Xunit;

namespace ApiGateway.Tests;

/// <summary>
/// Validação de prompts do editor (DEBT T4-2) — espelha o parsing do
/// str.format do Python usado pelo orchestrator. Um prompt que passe aqui
/// não pode levantar KeyError/ValueError no .format() do nó.
/// </summary>
public sealed class PromptValidationTests
{
    private const string Agente = "orchestrator";
    private const string Nome = "response_generation";

    [Fact]
    public void PromptValido_ComTodosPlaceholders_Passa()
    {
        // ADR-044/LGPD: o gerador NÃO recebe mais {nome_paciente} — fala em 2ª
        // pessoa ("você"). O único placeholder aceito é {sintomas_resumo}.
        var erros = PromptValidation.Validar(Agente, Nome,
            "Responda a você com acolhimento. Sintomas (referência): {sintomas_resumo}.");
        Assert.Empty(erros);
    }

    [Fact]
    public void JsonLiteralEscapado_Passa()
    {
        var erros = PromptValidation.Validar(Agente, Nome,
            "Sintomas: {sintomas_resumo}. " +
            "Responda APENAS JSON: {{\"humor\": 1, \"flags\": []}}");
        Assert.Empty(erros);
    }

    [Fact]
    public void JsonLiteralSemEscape_Reprova()
    {
        // O caso clássico que derruba o nó: exemplo JSON com { } cru.
        var erros = PromptValidation.Validar(Agente, Nome,
            "Sintomas: {sintomas_resumo}. " +
            "Responda JSON: {\"humor\": 1}");
        Assert.NotEmpty(erros);
    }

    [Fact]
    public void PlaceholderDesconhecido_Reprova()
    {
        // {nome_paciente} agora é DESCONHECIDO neste prompt (removido por ADR-044).
        var erros = PromptValidation.Validar(Agente, Nome,
            "Olá {sintomas_resumo} {nome_paciente}");
        Assert.Contains(erros, e => e.Contains("nome_paciente"));
    }

    [Fact]
    public void PlaceholderObrigatorioAusente_Reprova()
    {
        var erros = PromptValidation.Validar(Agente, Nome, "Olá, tudo bem?");
        Assert.Contains(erros, e => e.Contains("sintomas_resumo"));
    }

    [Fact]
    public void ChaveAbertaSemFechar_Reprova()
    {
        var erros = PromptValidation.Validar(Agente, Nome,
            "{sintomas_resumo} e um { perdido");
        Assert.NotEmpty(erros);
    }

    [Fact]
    public void ChaveFechadaSolta_Reprova()
    {
        var erros = PromptValidation.Validar(Agente, Nome,
            "{sintomas_resumo} e um } perdido");
        Assert.NotEmpty(erros);
    }

    [Fact]
    public void PlaceholderPosicional_Reprova()
    {
        Assert.NotEmpty(PromptValidation.Validar(Agente, Nome,
            "{} {sintomas_resumo}"));
        Assert.NotEmpty(PromptValidation.Validar(Agente, Nome,
            "{0} {sintomas_resumo}"));
    }

    [Fact]
    public void FormatSpecEConversao_NaoQuebramOParser()
    {
        var erros = PromptValidation.Validar(Agente, Nome,
            "{sintomas_resumo:>10}");
        Assert.Empty(erros);
    }

    [Fact]
    public void PromptCru_ChavesLivres_Passa()
    {
        // symptom_extraction é usado sem .format → JSON cru é permitido.
        var erros = PromptValidation.Validar(Agente, "symptom_extraction",
            "Extraia sintomas e devolva JSON: {\"sintomas\": [{\"nome\": \"...\"}]}");
        Assert.Empty(erros);
    }

    [Fact]
    public void AgenteNomeDesconhecido_Reprova()
    {
        // Typo no nome nunca seria carregado (loader cai no builtin em silêncio).
        var erros = PromptValidation.Validar(Agente, "response_generaton",
            "{sintomas_resumo}");
        Assert.Contains(erros, e => e.Contains("desconhecido"));
    }

    [Fact]
    public void MedicationClassification_ExigeSeusPlaceholders()
    {
        Assert.Empty(PromptValidation.Validar(Agente, "medication_classification",
            "Check-in: {checkin_resumo}. Prescrições: {prescricoes_resumo}."));
        Assert.NotEmpty(PromptValidation.Validar(Agente, "medication_classification",
            "Check-in: {checkin_resumo}. Nome: {nome_paciente}."));
    }

    [Fact]
    public void ConteudoVazio_Reprova()
    {
        Assert.NotEmpty(PromptValidation.Validar(Agente, Nome, ""));
        Assert.NotEmpty(PromptValidation.Validar(Agente, Nome, null));
    }
}
