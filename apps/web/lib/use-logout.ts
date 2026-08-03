"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

/**
 * Logout do médico: limpa o cookie httpOnly via BFF e volta pro /login.
 * Trava duplo-clique (`isLoggingOut`) p/ evitar POST e evento de auditoria duplicados.
 * Compartilhado por sidebar e header (antes era copiado nos dois).
 */
export function useLogout() {
  const router = useRouter()
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  async function logout() {
    if (isLoggingOut) return
    setIsLoggingOut(true)
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" })
      // Cookie httpOnly só é limpo server-side: só navega se o logout confirmou (2xx).
      // Falha (403 origem inválida / rede) NÃO redireciona — senão a sessão segue
      // válida e o usuário pensaria que saiu (logout silencioso).
      if (res.ok) {
        router.push("/login")
        return
      }
    } catch {
      /* rede fora do ar: cai no reset abaixo, sem fingir logout */
    }
    setIsLoggingOut(false)
  }

  return { logout, isLoggingOut }
}
