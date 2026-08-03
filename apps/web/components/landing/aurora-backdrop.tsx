import { cn } from "@/lib/utils"
import { AuroraShader } from "@/components/landing/aurora-shader"

/**
 * AuroraBackdrop — camada de fundo decorativa (aurora + grid neural).
 * Server-safe, `pointer-events-none`. Reusada em Hero, Security, CTA.
 *
 * `shader` liga o aurora field WebGL (AuroraShader) como camada extra animada
 * por cima do `.aurora-field` CSS (sempre vivo via drift/breathe). Só na landing
 * pública — nunca em superfícies clínicas. Se o WebGL falhar, o CSS cobre.
 */
export function AuroraBackdrop({
  className,
  grid = false,
  shader = false,
  intensity,
}: {
  className?: string
  grid?: boolean
  shader?: boolean
  intensity?: number
}) {
  return (
    <div className={cn("pointer-events-none absolute inset-0 z-0 overflow-hidden", className)} aria-hidden>
      <div className="aurora-field absolute inset-0" />
      {shader && <AuroraShader className="absolute inset-0" intensity={intensity} />}
      {grid && <div className="grid-noir absolute inset-0" />}
    </div>
  )
}
