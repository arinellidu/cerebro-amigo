"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Check, Copy } from "lucide-react"

/** Campo read-only com botão de copiar. Usado em URLs de magic link / convite. */
export function CampoCopiavel({ valor }: { valor: string }) {
  const [copiado, setCopiado] = useState(false)
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-2">
      <code className="flex-1 truncate text-xs text-foreground">{valor}</code>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={() => {
          navigator.clipboard?.writeText(valor)
          setCopiado(true)
          setTimeout(() => setCopiado(false), 1500)
        }}
      >
        {copiado ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  )
}
