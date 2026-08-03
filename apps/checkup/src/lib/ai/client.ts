import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic | null {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  // timeout/maxRetries explícitos: defaults do SDK (~10min, 2 retries) somados ao retry
  // manual em devolutiva.ts amplificam custo/latência numa superfície pública.
  // maxRetries:0 — numa superfície pública anônima o SDK NÃO deve retentar erro de
  // rede/5xx (cada retry é uma chamada faturada a mais). O fallback estático já é a
  // rede de segurança; o único reenvio é o retry de PARSE em devolutiva.ts (teto 2
  // chamadas/request em vez de ~4). Anti denial-of-wallet (ADR de hardening do checkup).
  _client = new Anthropic({ apiKey, timeout: 15000, maxRetries: 0 });
  return _client;
}

export const HAIKU_MODEL = process.env.ANTHROPIC_MODEL_HAIKU ?? "claude-haiku-4-5";
