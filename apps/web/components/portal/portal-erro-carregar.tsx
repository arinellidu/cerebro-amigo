"use client"

import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"

export function PortalErroCarregar({
  mensagem = "Não foi possível carregar. Verifique sua conexão.",
  onRetry,
}: {
  mensagem?: string
  onRetry: () => void
}) {
  return (
    <div className="portal-card space-y-3 border-destructive/30 p-6 text-center">
      <p className="text-sm text-foreground">{mensagem}</p>
      <Button
        variant="outline"
        size="sm"
        className="portal-tap gap-2 rounded-lg"
        onClick={onRetry}
      >
        <RefreshCw className="h-4 w-4" /> Tentar de novo
      </Button>
    </div>
  )
}
