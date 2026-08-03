"use client"

// Popup (modal) de upsell de IA (ADR-059/ADR-065). Quando o médico tenta um recurso de
// IA sem plano que o inclua, o gateway responde 402 `feature_requer_pro`; a página chama
// `showUpsell(feature)` (via readFeatureGate) e este provider abre o diálogo explicando o
// porquê e levando ao /dashboard/financeiro. Provider montado no layout do dashboard →
// disponível em qualquer página. NUNCA usado em crise/núcleo clínico — só na IA paga.

import { createContext, useCallback, useContext, useState } from "react"
import Link from "next/link"
import { Sparkles, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { FEATURE_LABELS, PLANO_MINIMO } from "@/lib/feature-gate"

interface FeatureUpsellCtx {
  /** Abre o popup de upsell para a feature de IA bloqueada. */
  showUpsell: (feature: string) => void
}

const Ctx = createContext<FeatureUpsellCtx>({ showUpsell: () => {} })

/** Hook p/ as páginas dispararem o popup ao detectar 402 `feature_requer_pro`. */
export function useFeatureUpsell(): FeatureUpsellCtx {
  return useContext(Ctx)
}

// Subcomponentes extraídos p/ manter a profundidade da árvore JSX ≤ 4 (DeepSource).
function UpsellHeader({ label, plano }: { label: string; plano: string }) {
  return (
    <DialogHeader>
      <div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-primary/12 text-primary">
        <Sparkles className="h-5 w-5" />
      </div>
      <DialogTitle className="text-center">{label} usa a camada de IA</DialogTitle>
      <DialogDescription className="text-center">
        Este recurso faz parte da inteligência do Cérebro Amigo e fica disponível a partir do
        plano <span className="font-semibold text-foreground">{plano}</span>. Assine para liberar
        a IA e os registros clínicos do painel.
      </DialogDescription>
    </DialogHeader>
  )
}

function UpsellFooter() {
  return (
    <DialogFooter className="sm:justify-center">
      <Button asChild variant="coral" className="gap-1.5">
        <Link href="/dashboard/financeiro">Conhecer planos <ArrowRight className="h-4 w-4" /></Link>
      </Button>
    </DialogFooter>
  )
}

export function FeatureUpsellProvider({ children }: { children: React.ReactNode }) {
  const [feature, setFeature] = useState<string | null>(null)
  const showUpsell = useCallback((f: string) => setFeature(f), [])

  const open = feature != null
  const label = feature ? (FEATURE_LABELS[feature] ?? "Este recurso") : ""
  const plano = feature ? (PLANO_MINIMO[feature] ?? "Pro") : "Pro"

  return (
    <Ctx.Provider value={{ showUpsell }}>
      {children}
      <Dialog open={open} onOpenChange={(o) => { if (!o) setFeature(null) }}>
        <DialogContent className="sm:max-w-md">
          <UpsellHeader label={label} plano={plano} />
          <UpsellFooter />
        </DialogContent>
      </Dialog>
    </Ctx.Provider>
  )
}
