"use client"

import { useEffect } from "react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * Error boundary do portal do paciente (/p/*). Captura erros não tratados
 * dos Server Components (ex.: gateway indisponível, timeout, 500) e mostra
 * uma tela acolhedora em pt-BR, no lugar da tela crua/em inglês do Next.
 *
 * IMPORTANTE (clinical-safety): isto é um erro técnico de carregamento, NÃO
 * um evento de crise. Não exibimos linha de crise (CVV/188) aqui — o rodapé
 * de crise é fixo e estático em outras telas do portal, nunca uma reação a
 * falha técnica. Também não expomos error.message/digest ao paciente fora de
 * desenvolvimento (pode conter detalhe interno/PII).
 */
export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("Portal paciente error:", error)
  }, [error])

  return (
    <div className="flex min-h-[70vh] items-center p-5 pt-9">
      <div className="portal-card portal-hairline w-full space-y-4 p-6 text-center">
        <div className="flex justify-center">
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-primary/12 text-primary ring-1 ring-primary/20">
            <RefreshCw className="h-7 w-7" />
          </div>
        </div>
        <h2 className="portal-display text-xl font-medium text-foreground">
          Não foi possível carregar agora
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Não conseguimos carregar suas informações neste momento. Isso costuma ser temporário —
          toque em &quot;Tentar de novo&quot; ou volte daqui a alguns instantes.
        </p>
        <Button
          onClick={reset}
          className="portal-tap h-11 w-full rounded-xl bg-primary text-primary-foreground hover:bg-purple-dark"
        >
          Tentar de novo
        </Button>
        {process.env.NODE_ENV === "development" && (
          <pre className="max-h-48 overflow-auto rounded-lg bg-muted p-3 text-left text-xs">
            {error.message}
            {error.digest && `\nDigest: ${error.digest}`}
          </pre>
        )}
      </div>
    </div>
  )
}
