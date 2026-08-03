import Image from "next/image"
import Link from "next/link"

// Logo do Cérebro Amigo no checkup. Asset (brain-logo.png) copiado do app principal;
// o componente é recriado aqui (isolamento: checkup compartilha só tokens/asset, não
// importa código do web). Wordmark "Cérebro" (claro) + "Amigo" (roxo) em Playfair.
const SIZES = {
  sm: { px: 26, text: "text-base" },
  md: { px: 34, text: "text-xl" },
  lg: { px: 48, text: "text-2xl" },
} as const

export function Logo({
  size = "md",
  href = "/",
  showText = true,
}: {
  size?: keyof typeof SIZES
  href?: string | null
  showText?: boolean
}) {
  const { px, text } = SIZES[size]
  const inner = (
    <span className="inline-flex items-center gap-2.5">
      <Image
        src="/brain-logo.png"
        alt="Cérebro Amigo"
        width={px}
        height={px}
        priority
        className="flex-shrink-0 object-contain [filter:brightness(0)_invert(1)_drop-shadow(0_0_12px_rgba(148,134,201,0.55))]"
      />
      {showText && (
        <span className={`font-display tracking-tight ${text}`}>
          <span className="text-foreground font-normal">Cérebro</span>{" "}
          <span className="text-purple font-medium">Amigo</span>
        </span>
      )}
    </span>
  )

  return href ? (
    <Link href={href} className="inline-flex rounded-md focus-visible:outline-2 focus-visible:outline-purple">
      {inner}
    </Link>
  ) : (
    inner
  )
}
