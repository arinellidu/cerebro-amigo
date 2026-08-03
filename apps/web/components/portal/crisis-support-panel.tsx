"use client"

import { LifeBuoy, Phone } from "lucide-react"
import { Button } from "@/components/ui/button"

// Painel unificado de acolhimento em crise — texto fixo do backend (crisis_copy),
// nunca editável no front. Visual consistente (destructive) em humor, diário e conversa.
export function CrisisSupportPanel({
  texto,
  titulo = "Estamos com você",
  subtitulo = "Sua mensagem foi levada a sério",
  onVoltar,
  voltarLabel = "Voltar ao início",
  compacto = false,
}: {
  texto: string
  titulo?: string
  subtitulo?: string
  onVoltar?: () => void
  voltarLabel?: string
  /** Bolha inline na conversa (sem título de página). */
  compacto?: boolean
}) {
  return (
    <div
      className={
        compacto
          ? "space-y-3"
          : "space-y-5"
      }
    >
      {!compacto && (
        <h1 className="portal-display text-[1.5rem] font-medium text-foreground">{titulo}</h1>
      )}
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 space-y-3">
        <div className="flex items-center gap-2 text-destructive">
          <LifeBuoy className="h-4 w-4 shrink-0" />
          <span className="text-sm font-semibold">{compacto ? "Apoio imediato" : subtitulo}</span>
        </div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{texto}</p>
        <div className="flex flex-wrap gap-2">
          <a
            href="tel:188"
            className="inline-flex flex-1 min-w-[120px] flex-col items-center gap-0.5 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 transition-colors hover:bg-destructive/15"
          >
            <Phone className="h-4 w-4 text-destructive" />
            <span className="text-sm font-semibold text-destructive">CVV 188</span>
            <span className="text-[10px] text-muted-foreground">24h gratuito</span>
          </a>
          <a
            href="tel:192"
            className="inline-flex flex-1 min-w-[120px] flex-col items-center gap-0.5 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 transition-colors hover:bg-destructive/15"
          >
            <Phone className="h-4 w-4 text-destructive" />
            <span className="text-sm font-semibold text-destructive">SAMU 192</span>
            <span className="text-[10px] text-muted-foreground">emergência</span>
          </a>
        </div>
      </div>
      {onVoltar && (
        <Button variant="outline" onClick={onVoltar} className="w-full">
          {voltarLabel}
        </Button>
      )}
    </div>
  )
}
