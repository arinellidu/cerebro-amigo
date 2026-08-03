"use client"

import { useEffect, useState } from "react"
import { X, Smartphone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { InstallPWA } from "@/components/portal/install-pwa"

const DISMISS_KEY = "ca_pwa_banner_dismissed"
const ONBOARDING_EVENT = "ca-onboarding-closed"

function onboardingVisto(configLembretes: unknown): boolean {
  if (!configLembretes) return false
  try {
    const cfg =
      typeof configLembretes === "string" ? JSON.parse(configLembretes) : configLembretes
    return cfg?.onboarding_visto === true
  } catch {
    return false
  }
}

// Banner pós-login: só depois do onboarding (Tier 3) — push depende do PWA instalado.
export function InstallPwaBanner() {
  const [podeMostrar, setPodeMostrar] = useState(false)
  const [visivel, setVisivel] = useState(false)

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // @ts-expect-error Safari iOS
      window.navigator.standalone === true
    if (standalone || localStorage.getItem(DISMISS_KEY) === "1") return

    let vivo = true

    function liberar() {
      if (vivo) setPodeMostrar(true)
    }

    fetch("/api/paciente/perfil")
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => {
        if (!vivo || !p) {
          liberar()
          return
        }
        if (onboardingVisto(p.configLembretes ?? p.config_lembretes)) {
          liberar()
        }
      })
      .catch(liberar)

    window.addEventListener(ONBOARDING_EVENT, liberar)
    return () => {
      vivo = false
      window.removeEventListener(ONBOARDING_EVENT, liberar)
    }
  }, [])

  useEffect(() => {
    if (podeMostrar) setVisivel(true)
  }, [podeMostrar])

  if (!visivel) return null

  function dispensar() {
    localStorage.setItem(DISMISS_KEY, "1")
    setVisivel(false)
  }

  return (
    <section className="portal-card portal-hairline relative overflow-hidden border-primary/25 p-4">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_120%_at_85%_-10%,rgba(148,134,201,0.14),transparent_60%)]"
      />
      <div className="relative flex items-start gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/20">
          <Smartphone className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-foreground">Instale o app no celular</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Receba lembretes de medicação e check-ins na hora certa.
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted-foreground"
              aria-label="Fechar"
              onClick={dispensar}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <InstallPWA className="w-full sm:w-auto" />
        </div>
      </div>
    </section>
  )
}
