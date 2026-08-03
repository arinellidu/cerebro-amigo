"use client"

import Link from "next/link"
import { Eye, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * Banner do trial de aquisição read-only (ADR-065). Mostrado enquanto o médico está
 * em `me.readOnly` (pendente, em prazo, sem plano pago): pode navegar tudo e cadastrar
 * pacientes, mas a operação de escrita e a IA ficam bloqueadas até assinar um plano.
 */
// Subcomponentes extraídos p/ manter a profundidade da árvore JSX ≤ 4 (DeepSource).
function BannerMensagem({ dias }: { dias: number | null }) {
  return (
    <span className="flex items-center gap-2">
      <Eye className="h-4 w-4 shrink-0 text-primary" />
      <span>
        <span className="font-medium">Modo de demonstração</span> — você pode explorar o
        painel e cadastrar pacientes. A IA e os registros clínicos liberam ao assinar um plano
        {dias != null ? ` (${dias} dia${dias === 1 ? "" : "s"} restante${dias === 1 ? "" : "s"})` : ""}.
      </span>
    </span>
  )
}

function BannerCta() {
  return (
    <Button asChild size="sm" variant="coral" className="h-8 gap-1.5">
      <Link href="/dashboard/financeiro">Escolher plano <ArrowRight className="h-3.5 w-3.5" /></Link>
    </Button>
  )
}

export function ReadOnlyBanner({ dias }: { dias: number | null }) {
  return (
    <div className="sticky top-0 z-30 border-b border-primary/30 bg-primary/10 px-6 py-2.5 text-sm text-foreground">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <BannerMensagem dias={dias} />
        <BannerCta />
      </div>
    </div>
  )
}
