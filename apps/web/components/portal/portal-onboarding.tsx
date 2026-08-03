"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Bell, MessageCircle, Smile, ChevronRight, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PushToggle } from "@/components/portal/push-toggle"

const PASSOS = [
  {
    icon: Bell,
    titulo: "Ative os lembretes",
    texto:
      "Medicações e check-ins chegam na hora certa. Você pode desligar quando quiser nas configurações.",
    extra: "push" as const,
  },
  {
    icon: Smile,
    titulo: "Registre seu humor",
    texto:
      "Um check-in rápido por dia ajuda sua psiquiatra a acompanhar como você está entre consultas.",
    extra: "humor" as const,
  },
  {
    icon: MessageCircle,
    titulo: "Conversa com limites claros",
    texto:
      "A conversa organiza e acolhe — não substitui sua psiquiatra. Não dá diagnóstico nem orienta dose de medicamento. Em risco, ela é avisada.",
    extra: null,
  },
] as const

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

// Onboarding pós-login (3 passos). Flag persiste em pacientes.config_lembretes.
export function PortalOnboarding() {
  const [passo, setPasso] = useState(0)
  const [visivel, setVisivel] = useState(false)
  const [concluindo, setConcluindo] = useState(false)

  useEffect(() => {
    let vivo = true
    fetch("/api/paciente/perfil")
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => {
        if (!vivo || !p) return
        if (!onboardingVisto(p.configLembretes ?? p.config_lembretes)) setVisivel(true)
      })
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [])

  async function concluir() {
    setConcluindo(true)
    try {
      await fetch("/api/paciente/onboarding/concluido", { method: "POST" })
    } catch {
      /* fecha mesmo se falhar — não bloqueia o portal */
    } finally {
      setConcluindo(false)
      setVisivel(false)
      window.dispatchEvent(new CustomEvent("ca-onboarding-closed"))
    }
  }

  if (!visivel) return null

  const cfg = PASSOS[passo]
  const Icon = cfg.icon
  const ultimo = passo === PASSOS.length - 1

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-background/80 backdrop-blur-sm p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-titulo"
    >
      <div className="portal-card portal-hairline relative w-full max-w-md overflow-hidden">
        <button
          type="button"
          aria-label="Fechar onboarding"
          className="portal-tap absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary/70"
          onClick={() => void concluir()}
        >
          <X className="h-4 w-4" />
        </button>

        <div className="space-y-5 p-6 pt-8">
          <div className="flex gap-2">
            {PASSOS.map((_, i) => (
              <span
                key={i}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  i <= passo ? "bg-primary" : "bg-noir-line"
                }`}
              />
            ))}
          </div>

          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/15 text-primary ring-1 ring-primary/20">
            <Icon className="h-6 w-6" />
          </div>

          <div className="space-y-2">
            <p className="portal-eyebrow">
              Passo {passo + 1} de {PASSOS.length}
            </p>
            <h2
              id="onboarding-titulo"
              className="portal-display text-[1.4rem] font-medium leading-tight text-foreground"
            >
              {cfg.titulo}
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">{cfg.texto}</p>
          </div>

          {cfg.extra === "push" && <PushToggle />}

          {cfg.extra === "humor" && (
            <Button asChild variant="outline" className="portal-tap w-full gap-2 rounded-xl">
              <Link href="/p/humor" onClick={() => setVisivel(false)}>
                <Smile className="h-4 w-4" /> Experimentar check-in de humor
              </Link>
            </Button>
          )}

          <div className="flex gap-2 pt-1">
            {passo > 0 && (
              <Button
                variant="ghost"
                className="portal-tap flex-1 rounded-xl"
                onClick={() => setPasso((p) => p - 1)}
              >
                Voltar
              </Button>
            )}
            {ultimo ? (
              <Button
                className="portal-tap flex-1 rounded-xl bg-primary text-primary-foreground hover:bg-purple-dark"
                disabled={concluindo}
                onClick={concluir}
              >
                Começar a usar
              </Button>
            ) : (
              <Button
                className="portal-tap flex-1 gap-1 rounded-xl bg-primary text-primary-foreground hover:bg-purple-dark"
                onClick={() => setPasso((p) => p + 1)}
              >
                Próximo <ChevronRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
