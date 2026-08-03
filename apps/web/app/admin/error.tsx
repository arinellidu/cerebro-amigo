"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { AlertTriangle } from "lucide-react"

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[admin-error]", error)
  }, [error])

  return (
    <div className="theme-noir min-h-screen flex items-center justify-center p-6">
      <div className="text-center space-y-4 max-w-md">
        <div className="flex justify-center">
          <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertTriangle className="h-8 w-8 text-destructive" />
          </div>
        </div>
        <h2 className="text-xl font-semibold text-foreground">
          Algo deu errado ao abrir esta tela do painel
        </h2>
        <p className="text-muted-foreground text-sm">
          Tente recarregar. Se o problema continuar, contate o suporte técnico.
        </p>
        <div className="flex gap-3 justify-center">
          <Button onClick={reset} variant="outline">
            Tentar novamente
          </Button>
          <Button asChild>
            <a href="/admin">Recarregar página</a>
          </Button>
        </div>
        {process.env.NODE_ENV === "development" && (
          <pre className="text-left text-xs bg-muted p-4 rounded-lg overflow-auto max-h-48">
            {error.message}
            {error.digest && `\nDigest: ${error.digest}`}
          </pre>
        )}
      </div>
    </div>
  )
}
