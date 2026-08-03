import Link from "next/link"
import { ArrowLeft } from "lucide-react"

/**
 * Cabeçalho editorial padrão das telas internas do portal.
 * Server-safe (sem "use client") — usável em RSC e Client Components.
 * Tipografia: eyebrow mono + título serif (Elevated Neural Noir).
 */
export function PortalPageHeader({
  eyebrow,
  titulo,
  subtitulo,
  backHref,
  acao,
}: {
  eyebrow?: string
  titulo: string
  subtitulo?: string
  backHref?: string
  acao?: React.ReactNode
}) {
  return (
    <header className="portal-rise-in space-y-4">
      {(backHref || acao) && (
        <div className="flex items-center justify-between gap-3">
          {backHref ? (
            <Link
              href={backHref}
              className="portal-tap inline-flex h-9 w-9 items-center justify-center rounded-full border border-noir-line/70 bg-noir-surface/70 text-muted-foreground hover:text-foreground"
              aria-label="Voltar"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
          ) : (
            <span aria-hidden />
          )}
          {acao}
        </div>
      )}
      <div>
        {eyebrow && <p className="portal-eyebrow">{eyebrow}</p>}
        <h1 className="portal-display mt-2.5 text-[1.75rem] font-medium leading-[1.1] text-foreground">
          {titulo}
        </h1>
        {subtitulo && (
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
            {subtitulo}
          </p>
        )}
      </div>
    </header>
  )
}
