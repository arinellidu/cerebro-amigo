"use client"

import { useEffect, useState } from "react"
import { Download, Share, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import styles from "@/components/access/signal-access.module.css"

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

/**
 * Botão de instalação do PWA. Em navegadores que suportam `beforeinstallprompt`
 * (Android/Chrome/Edge), dispara o prompt nativo. No iOS (sem o evento), mostra
 * a instrução "Compartilhar → Adicionar à Tela de Início". Some quando já instalado.
 */
export function InstallPWA({ className, variant = "default" }: { className?: string; variant?: "default" | "signal" }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [instalado, setInstalado] = useState(false)
  const [iosHint, setIosHint] = useState(false)

  useEffect(() => {
    // Já rodando como app instalado?
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // @ts-expect-error — Safari iOS
      window.navigator.standalone === true
    if (standalone) {
      setInstalado(true)
      return
    }

    const onPrompt = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => setInstalado(true)
    window.addEventListener("beforeinstallprompt", onPrompt)
    window.addEventListener("appinstalled", onInstalled)

    // iOS Safari não dispara beforeinstallprompt.
    const ua = window.navigator.userAgent
    if (/iPhone|iPad|iPod/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS/.test(ua)) {
      setIosHint(true)
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt)
      window.removeEventListener("appinstalled", onInstalled)
    }
  }, [])

  if (instalado) {
    return (
      <span className={`${variant === "signal" ? styles.pwaStatus : "inline-flex items-center gap-1.5 text-sm text-success"} ${className ?? ""}`}>
        <Check className="h-4 w-4" /> {variant === "signal" ? "App installed" : "App instalado"}
      </span>
    )
  }

  if (deferred) {
    const install = async () => {
      await deferred.prompt()
      const { outcome } = await deferred.userChoice
      if (outcome === "accepted") setInstalado(true)
      setDeferred(null)
    }

    if (variant === "signal") {
      return (
        <button className={`${styles.pwaButton} ${className ?? ""}`} onClick={install} type="button">
          <Download aria-hidden="true" /> Install the app
        </button>
      )
    }

    return (
      <Button
        variant="glass"
        className={`gap-2 ${className ?? ""}`}
        onClick={install}
      >
        <Download className="h-4 w-4" /> Instalar o app
      </Button>
    )
  }

  if (iosHint) {
    return (
      <span className={`${variant === "signal" ? styles.pwaHint : "inline-flex items-center gap-1.5 text-xs text-muted-foreground"} ${className ?? ""}`}>
        <Share className="h-3.5 w-3.5" /> {variant === "signal" ? "Share → Add to Home Screen" : "Compartilhar → Adicionar à Tela de Início"}
      </span>
    )
  }

  return null
}
