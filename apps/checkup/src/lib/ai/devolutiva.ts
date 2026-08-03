import { getAnthropicClient, HAIKU_MODEL } from "./client";
import { DevolutivaSchema, devolutivaHasProhibitedContent } from "./types";
import { getFallback } from "./fallbacks";
import { tryConsumeLlmBudget } from "./breaker";
import type { Devolutiva, DevolutivaInput } from "./types";

const SYSTEM_PROMPT = `Você escreve devolutivas de instrumentos de TRIAGEM de saúde mental.
Você recebe apenas: escala, escore total e faixa.
Você responde SOMENTE com um JSON válido no formato:
{
  "acolhimento": "1-2 frases calorosas, sem dramatizar",
  "leitura": ["frase 1 explicando o escore", "frase 2 sobre o que a escala mede"],
  "limites": "1 frase reforçando que é triagem, não diagnóstico",
  "proximos_passos": ["ação 1", "ação 2 — sempre incluir busca por profissional"]
}
Regras absolutas: nunca diagnostique; nunca cite medicamentos ou tratamentos específicos;
nunca minimize ("é só ansiedade") nem dramatize ("isso é muito grave");
sempre inclua busca por profissional de saúde nos próximos passos;
tom caloroso, direto e adulto; português do Brasil, segunda pessoa, sentence case.
Responda APENAS com o JSON — sem markdown, sem texto antes ou depois.`;

function buildUserMessage(input: DevolutivaInput): string {
  const scaleNames: Record<string, string> = {
    phq9: "PHQ-9 (depressão)",
    gad7: "GAD-7 (ansiedade generalizada)",
    asrs18: "ASRS-18 (TDAH adulto)",
    audit: "AUDIT (uso de álcool, OMS)",
    fagerstrom: "Teste de Fagerström (dependência de nicotina)",
  };
  const parts = [
    `Escala: ${scaleNames[input.scaleId] ?? input.scaleId}`,
    `Escore total: ${input.totalScore}`,
    `Faixa: ${input.bandLabel}`,
  ];
  if (input.partAPositives !== undefined) {
    parts.push(`Itens positivos Parte A: ${input.partAPositives}`);
  }
  return parts.join("\n");
}

export async function generateDevolutiva(input: DevolutivaInput): Promise<Devolutiva> {
  // Devolutiva fixa (sem LLM) para:
  //  - asrs18 e msi_bpd: sem verdict (sem cutoff validado p/ BR) — não enviar
  //    escore ao LLM evita que ele infira "triagem positiva" + minimização (LGPD);
  //  - mdq: bipolaridade é rótulo sensível — texto estático revisado à mão,
  //    nunca geração (decisão registrada no ADR-048; reabrir só com aprovação).
  if (
    input.scaleId === "asrs18" ||
    input.scaleId === "msi_bpd" ||
    input.scaleId === "mdq" ||
    input.scaleId === "assist"
  ) {
    return getFallback(input);
  }

  const client = getAnthropicClient();
  if (!client) return getFallback(input);

  // Circuit breaker global (anti denial-of-wallet): se o teto horário/diário de
  // chamadas estourou, degrada para o fallback estático em vez de chamar o LLM.
  // O usuário ainda recebe devolutiva; o gasto fica capped. Conferido AQUI (não na
  // rota) para que as escalas sem LLM (short-circuit acima) não consumam orçamento.
  const budget = await tryConsumeLlmBudget();
  if (!budget.allowed) return getFallback(input);

  try {
    const response = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 700,
      temperature: 0.3,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserMessage(input) }],
    });

    const raw = response.content[0];
    let devolutiva = raw?.type === "text" ? parseDevolutiva(raw.text) : null;

    if (!devolutiva) {
      // retry 1x em parse/estrutura inválida (desenho: parse falhou → retry → fallback)
      const retry = await client.messages.create({
        model: HAIKU_MODEL,
        max_tokens: 700,
        temperature: 0.3,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserMessage(input) }],
      });
      const raw2 = retry.content[0];
      devolutiva = raw2?.type === "text" ? parseDevolutiva(raw2.text) : null;
    }

    if (!devolutiva) return getFallback(input);
    if (devolutivaHasProhibitedContent(devolutiva)) return getFallback(input);
    return devolutiva;
  } catch {
    return getFallback(input);
  }
}

// O modelo às vezes embrulha o JSON em cerca markdown (```json ... ```) mesmo com a
// instrução "sem markdown" no system prompt — observado no claude-haiku-4-5 em
// 2026-07-15, quando TODA devolutiva LLM degradava para o fallback. Strip é
// transport-level apenas; conteúdo continua validado por Zod + prohibited-content.
export function extractJsonPayload(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

function parseDevolutiva(text: string): Devolutiva | null {
  let raw: unknown;
  try {
    raw = JSON.parse(extractJsonPayload(text));
  } catch {
    return null;
  }
  const parsed = DevolutivaSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
