namespace ApiGateway.Services;

/// <summary>
/// Validação server-side de prompts do editor (DEBT T4-2).
///
/// O orchestrator-py renderiza alguns prompts com <c>str.format(**kwargs)</c>
/// do Python: um placeholder desconhecido ou uma chave <c>{</c>/<c>}</c> solta
/// (ex.: exemplo JSON sem escape <c>{{ }}</c>) levanta KeyError/ValueError em
/// RUNTIME — e derruba o nó do grafo para TODOS os pacientes. Esta classe
/// rejeita o prompt na criação/ativação, antes de chegar lá.
///
/// Complementa a trava do ADR-035 (PromptsTravados): aquela protege as
/// salvaguardas clínicas; esta protege a disponibilidade do grafo.
/// O catálogo espelha os call sites em apps/orchestrator-py/app/conversation/
/// nodes/*.py — ao mudar um .format() lá, atualize aqui.
/// </summary>
public static class PromptValidation
{
    // (agente:nome) → placeholders que o nó passa no .format().
    // Lista vazia = prompt CRU (usado sem .format) → chaves livres, sem checagem.
    private static readonly Dictionary<string, string[]> Catalogo = new()
    {
        // response.py: .format(sintomas_resumo=…)
        // ADR-044/LGPD: `nome_paciente` foi REMOVIDO do prompt do gerador (não
        // se envia identificador direto do paciente junto de conteúdo clínico
        // ao LLM). Um prompt editado com {nome_paciente} agora é rejeitado.
        ["orchestrator:response_generation"] = ["sintomas_resumo"],
        // medication.py: .format(checkin_resumo=…, prescricoes_resumo=…)
        ["orchestrator:medication_classification"] = ["checkin_resumo", "prescricoes_resumo"],
        // symptoms.py: usado cru (sem .format)
        ["orchestrator:symptom_extraction"] = [],
        // agents-py (T4-1): os 5 agentes analíticos usam o prompt cru — o
        // contexto vai na HumanMessage, não há .format() no system.
        ["agents:adesao"] = [],
        ["agents:diario"] = [],
        ["agents:padroes"] = [],
        ["agents:resumidor"] = [],
        ["agents:risco_silencioso"] = [],
        // Travados pelo ADR-035 (nunca chegam aqui via painel), crus:
        ["orchestrator:crisis_detection"] = [],
        ["orchestrator:audit"] = [],
    };

    /// <summary>
    /// Valida o conteúdo para (agente, nome). Retorna lista de erros (pt-BR);
    /// vazia = válido.
    /// </summary>
    public static List<string> Validar(string? agente, string? nome, string? conteudo)
    {
        var erros = new List<string>();

        if (string.IsNullOrWhiteSpace(conteudo))
        {
            erros.Add("conteúdo vazio");
            return erros;
        }

        var chave = $"{agente}:{nome}";
        if (!Catalogo.TryGetValue(chave, out var esperados))
        {
            erros.Add(
                $"prompt desconhecido: '{chave}'. Válidos: {string.Join(", ", Catalogo.Keys)}. "
                + "(Um nome errado nunca seria carregado pelo orchestrator — o loader "
                + "cairia silenciosamente no builtin.)");
            return erros;
        }

        // Prompt cru: o orchestrator não chama .format() → chaves são literais, ok.
        if (esperados.Length == 0)
            return erros;

        var campos = ParseCamposFormat(conteudo, erros);
        if (erros.Count > 0)
            return erros;

        foreach (var campo in campos.Where(c => !esperados.Contains(c)).Distinct())
            erros.Add(
                $"placeholder desconhecido {{{campo}}} — o orchestrator passa apenas: "
                + string.Join(", ", esperados.Select(e => $"{{{e}}}")));

        foreach (var faltante in esperados.Where(e => !campos.Contains(e)))
            erros.Add(
                $"placeholder obrigatório {{{faltante}}} ausente — sem ele o modelo "
                + "perde o contexto que o nó injeta");

        return erros;
    }

    // Espelha o parsing de campos do str.format do Python: '{{' e '}}' são
    // escapes de chave literal; '{nome}', '{nome:spec}' e '{nome!conv}' são
    // campos; '{' sem fechar ou '}' solto quebram em runtime (ValueError).
    private static List<string> ParseCamposFormat(string s, List<string> erros)
    {
        var campos = new List<string>();
        var i = 0;
        while (i < s.Length)
        {
            var c = s[i];
            if (c == '{')
            {
                if (i + 1 < s.Length && s[i + 1] == '{') { i += 2; continue; }
                var fim = s.IndexOf('}', i + 1);
                if (fim < 0)
                {
                    erros.Add(
                        $"chave '{{' aberta sem fechar (posição {i + 1}) — para chave "
                        + "literal (ex.: exemplo JSON) use '{{' e '}}'");
                    return campos;
                }
                var campo = s[(i + 1)..fim];
                var corte = campo.IndexOfAny([':', '!']);
                if (corte >= 0) campo = campo[..corte];
                if (campo.Length == 0 || campo.All(char.IsDigit))
                {
                    erros.Add(
                        $"placeholder posicional '{{{campo}}}' não suportado — use os "
                        + "placeholders nomeados do catálogo");
                    return campos;
                }
                campos.Add(campo);
                i = fim + 1;
                continue;
            }
            if (c == '}')
            {
                if (i + 1 < s.Length && s[i + 1] == '}') { i += 2; continue; }
                erros.Add(
                    $"chave '}}' solta (posição {i + 1}) — para chave literal "
                    + "(ex.: exemplo JSON) use '{{' e '}}'");
                return campos;
            }
            i++;
        }
        return campos;
    }
}
