/**
 * Cliente tipado para o api-gateway .NET.
 * Lê o cookie auth_token e encaminha como Bearer.
 * Usado somente em Route Handlers (server-side) — nunca expõe a URL do gateway ao browser.
 */

import { cookies } from "next/headers"
import { gatewayFetch } from "@/lib/gateway-fetch"
import { NextResponse } from "next/server"
import { decodeJwtRole } from "@/lib/jwt"

const GATEWAY = process.env.API_GATEWAY_URL ?? "http://localhost:5050"

export class GatewayError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`Gateway ${status}`)
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<T> {
  const cookieStore = await cookies()
  const bearer = token ?? cookieStore.get("auth_token")?.value

  // Defesa em profundidade (T1-10): este cliente serve só médico/admin. Um token de
  // paciente injetado no cookie auth_token nunca deve ser repassado como Bearer médico.
  // O gateway .NET segue como autoridade (assinatura + policies por role); aqui só
  // barramos o caso explícito. role=null (token legado sem claim) passa — fail-open.
  if (token === undefined && bearer && decodeJwtRole(bearer) === "paciente") {
    throw new GatewayError(401, { error: "sessao_invalida" })
  }

  const res = await gatewayFetch(`${GATEWAY}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  })

  const texto = await res.text()

  if (!res.ok) {
    let body: unknown
    try { body = texto ? JSON.parse(texto) : null } catch { body = texto }
    throw new GatewayError(res.status, body)
  }

  // 204 / corpo vazio (ex.: PATCH) → null.
  return (texto ? JSON.parse(texto) : null) as T
}

/**
 * Mapeia um erro do gateway para uma resposta JSON do BFF.
 * Repassa status e corpo de erros de domínio (400/402/403/404/409/422) e
 * normaliza 401/403 de auth. Para erros de conexão, devolve 502.
 * 402 = gate de assinatura/feature (ADR-055/059): o corpo (`feature_requer_pro`)
 * precisa chegar intacto pra UI abrir o upsell — por isso passa direto.
 */
export function gatewayErrorResponse(err: unknown): Response {
  if (err instanceof GatewayError) {
    if (err.status === 401)
      return NextResponse.json({ error: "sessao_expirada" }, { status: 401 })
    if ([400, 402, 403, 404, 409, 422].includes(err.status))
      return NextResponse.json(err.body ?? { error: "erro" }, { status: err.status })
  }
  return NextResponse.json({ error: "erro_conexao" }, { status: 502 })
}

export const gateway = {
  post: <T>(path: string, body: unknown, token?: string) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }, token),
  put: <T>(path: string, body: unknown, token?: string) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }, token),
  patch: <T>(path: string, body: unknown, token?: string) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }, token),
  get: <T>(path: string) => request<T>(path, { method: "GET", cache: "no-store" }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
}
