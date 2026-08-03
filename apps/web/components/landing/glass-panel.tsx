import { cn } from "@/lib/utils"

/**
 * GlassPanel — superfície de vidro Neural Noir. Server-safe.
 * `glow` adiciona halo roxo/coral; `as` permite trocar o elemento.
 */
export function GlassPanel({
  children,
  className,
  glow,
  as: Tag = "div",
}: {
  children?: React.ReactNode
  className?: string
  glow?: "purple" | "coral"
  as?: React.ElementType
}) {
  return (
    <Tag
      className={cn(
        "glass-noir rounded-2xl",
        glow === "purple" && "glow-purple-lg",
        glow === "coral" && "glow-coral-lg",
        className,
      )}
    >
      {children}
    </Tag>
  )
}
