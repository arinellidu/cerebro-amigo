"use client"

import Script from "next/script"
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react"

// Tipos mínimos da API global injetada por challenges.cloudflare.com/turnstile/v0/api.js.
interface TurnstileOptions {
  sitekey: string
  callback?: (token: string) => void
  "error-callback"?: () => void
  "expired-callback"?: () => void
  theme?: "light" | "dark" | "auto"
  language?: string
}

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: TurnstileOptions) => string
      remove: (id: string) => void
      reset: (id?: string) => void
    }
  }
}

export interface TurnstileHandle {
  /** Limpa o desafio e rearma o widget (tokens do Turnstile são single-use). */
  reset: () => void
}

/**
 * Widget Cloudflare Turnstile — anti-abuso do signup de médico (ADR-055).
 *
 * Só coleta o token; a verificação real é server-side no gateway. Renderize apenas
 * quando houver site key (NEXT_PUBLIC_TURNSTILE_SITE_KEY) — sem ela o captcha está
 * desligado e este componente nem é montado pela página.
 *
 * onToken recebe o token quando resolvido, ou null quando expira / dá erro. Como o token
 * é single-use, o pai deve chamar `reset()` (via ref) após um submit que falhou — senão o
 * reenvio mandaria um token já consumido e o gateway responderia captcha_invalido.
 */
export const Turnstile = forwardRef<TurnstileHandle, {
  siteKey: string
  onToken: (token: string | null) => void
}>(function Turnstile({ siteKey, onToken }, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetId = useRef<string | null>(null)
  // Ref ao callback p/ não re-renderizar o widget quando o pai passa função inline.
  const onTokenRef = useRef(onToken)
  onTokenRef.current = onToken

  const render = useCallback(() => {
    if (!window.turnstile || !containerRef.current || widgetId.current) return
    widgetId.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      theme: "auto",
      language: "pt-BR",
      callback: (token) => onTokenRef.current(token),
      "error-callback": () => onTokenRef.current(null),
      "expired-callback": () => onTokenRef.current(null),
    })
  }, [siteKey])

  // Expõe reset() ao pai: rearma o widget (o state do token fica a cargo do pai).
  useImperativeHandle(ref, () => ({
    reset: () => {
      if (window.turnstile && widgetId.current) {
        try {
          window.turnstile.reset(widgetId.current)
        } catch {
          /* widget ainda não montado — ignora */
        }
      }
    },
  }), [])

  useEffect(() => {
    render()
    return () => {
      if (widgetId.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetId.current)
        } catch {
          /* widget já removido — ignora */
        }
        widgetId.current = null
      }
    }
  }, [render])

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onLoad={render}
      />
      <div ref={containerRef} className="flex justify-center" />
    </>
  )
})
