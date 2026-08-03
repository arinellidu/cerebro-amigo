import type { Scale } from "./types";

/**
 * Retorna true apenas quando a escala está pronta para ser servida ao público.
 * Critérios (ambos obrigatórios):
 *  - validated: true → texto conferido caractere a caractere contra a publicação
 *  - items.length > 0 → itens transcritos (não é stub)
 *
 * Use esta função em qualquer ponto que possa expor a escala ao usuário final.
 * Nunca bypassar sem aprovação explícita do responsável clínico.
 */
export function isScaleAvailable(scale: Scale): boolean {
  return scale.validated && scale.items.length > 0;
}
