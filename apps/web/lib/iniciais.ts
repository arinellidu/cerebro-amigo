/**
 * Iniciais (até 2) de um nome, p/ avatares/fallbacks.
 * `fallback` é o que retorna quando o nome é vazio/nulo (default "·").
 * Pura — serve em Server e Client Components.
 */
export function iniciais(nome?: string | null, fallback = "·"): string {
  if (!nome) return fallback
  const partes = nome.trim().split(/\s+/).filter(Boolean)
  const ini = (partes[0]?.[0] ?? "") + (partes.length > 1 ? partes[partes.length - 1][0] : "")
  return ini.toUpperCase() || fallback
}
