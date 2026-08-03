/**
 * Prompts travados para edição via UI — segurança clínica.
 *
 * `crisis_detection` (detecção de crise) e `audit` (auditoria da resposta ao
 * paciente) são salvaguardas — clinical-safety regras 2 e 3. Alterá-los exige
 * decisão clínica + validação SHADOW + ADR, não um clique no painel. Ficam
 * visíveis em modo somente-leitura.
 *
 * O texto de acolhimento de crise NÃO vive na tabela `prompts` (está fixo em
 * crisis_copy.py); por isso não aparece neste editor de forma alguma.
 */
export const PROMPTS_TRAVADOS = new Set<string>([
  "orchestrator:crisis_detection",
  "orchestrator:audit",
])

export function promptTravado(agente: string, nome: string): boolean {
  return PROMPTS_TRAVADOS.has(`${agente}:${nome}`)
}
