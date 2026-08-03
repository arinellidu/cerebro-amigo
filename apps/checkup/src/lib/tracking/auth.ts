import { timingSafeEqual } from "crypto";

/**
 * Compara o header Authorization com `Bearer <token>` em tempo constante (ADR-050 Parte 2).
 * Evita timing oracle no CHECKUP_CRON_TOKEN dos endpoints de scheduler (cron/retention).
 */
export function bearerMatches(header: string | null, token: string): boolean {
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(header ?? "");
  // timingSafeEqual exige buffers de mesmo tamanho; o length-check vaza só o tamanho
  // (não o conteúdo) do header recebido, não do segredo.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
