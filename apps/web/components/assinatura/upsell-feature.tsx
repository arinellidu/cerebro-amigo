"use client"

// Upsell de feature de IA (ADR-059). Mostrado quando o plano do médico não inclui o
// recurso (proativo via me.features, ou reativo via 402 `feature_requer_pro`). Leva ao
// /dashboard/financeiro p/ upgrade. NUNCA usado em crise/núcleo clínico — só na IA paga.

import Link from "next/link"
import { Lock, ArrowRight, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { FEATURE_LABELS, PLANO_MINIMO } from "@/lib/feature-gate"

export function UpsellFeature({
  feature,
  variant = "card",
  className,
}: {
  feature: string
  variant?: "card" | "inline"
  className?: string
}) {
  const label = FEATURE_LABELS[feature] ?? "Este recurso"
  const plano = PLANO_MINIMO[feature] ?? "Pro"

  if (variant === "inline") {
    return (
      <div className={`flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 ${className ?? ""}`}>
        <Lock className="h-4 w-4 shrink-0 text-primary" />
        <p className="flex-1 text-sm text-foreground">
          <span className="font-medium">{label}</span> está no plano <span className="font-semibold">{plano}</span>.
        </p>
        <Button asChild variant="coral" size="sm" className="gap-1.5">
          <Link href="/dashboard/financeiro">Fazer upgrade <ArrowRight className="h-3.5 w-3.5" /></Link>
        </Button>
      </div>
    )
  }

  return (
    <Card className={`border-primary/30 bg-primary/[0.04] ${className ?? ""}`}>
      <CardContent className="flex flex-col items-center gap-3 px-6 py-8 text-center">
        <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/12 text-primary">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">{label}</p>
          <p className="text-xs text-muted-foreground">
            Disponível a partir do plano <span className="font-medium text-foreground">{plano}</span>.
          </p>
        </div>
        <Button asChild variant="coral" size="sm" className="gap-1.5">
          <Link href="/dashboard/financeiro">Conhecer o plano {plano} <ArrowRight className="h-3.5 w-3.5" /></Link>
        </Button>
      </CardContent>
    </Card>
  )
}
