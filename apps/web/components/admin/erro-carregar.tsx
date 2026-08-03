import { AlertTriangle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * Banner de erro de carregamento para as telas read-only do /admin.
 *
 * Distingue "a chamada falhou" de "não há dados": sem isto, um 401/500/gateway
 * fora cai no mesmo empty-state e o admin lê zeros como se fossem reais.
 */
export function ErroCarregar({
  mensagem = "Não foi possível carregar os dados.",
  onRetry,
}: {
  mensagem?: string
  onRetry: () => void
}) {
  return (
    <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-12 text-center">
      <AlertTriangle className="mx-auto mb-3 h-6 w-6 text-destructive" />
      <p className="text-sm text-foreground">{mensagem}</p>
      <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
        A chamada ao servidor falhou — isto não significa "sem dados". Verifique a
        conexão / sessão e tente de novo.
      </p>
      <Button variant="glass" size="sm" onClick={onRetry} className="mt-4 gap-1.5">
        <RefreshCw className="h-4 w-4" /> Tentar de novo
      </Button>
    </div>
  )
}
