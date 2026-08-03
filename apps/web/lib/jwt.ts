/**
 * Decodifica o claim `role` de um JWT sem validar a assinatura.
 *
 * Uso exclusivo: roteamento e defesa em profundidade no BFF. A validação autoritativa
 * (assinatura, `token_version`/ADR-069, policies por role) mora no api-gateway .NET —
 * NUNCA confie nisto para autorização. Roles do projeto: "medico" | "owner" | "admin"
 * (cookie auth_token) e "paciente" (cookie paciente_token).
 */
export function decodeJwtRole(token: string): string | null {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")
    const data = JSON.parse(atob(payload))
    return (data?.role as string) ?? null
  } catch {
    return null
  }
}
