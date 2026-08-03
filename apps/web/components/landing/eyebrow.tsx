import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Eyebrow — label mono uppercase (estética Neural Noir).
 * Server-safe (sem hooks). Substitui os <p className="uppercase tracking-..."> da landing.
 */
export function Eyebrow({
  children,
  icon: Icon,
  className,
}: {
  children: React.ReactNode
  icon?: LucideIcon
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 font-mono text-[0.7rem] font-medium uppercase tracking-[0.2em] text-accent-on-dark",
        className,
      )}
    >
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {children}
    </span>
  )
}
