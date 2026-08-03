import Image from "next/image"
import { BrandWordmark } from "@/components/brand-wordmark"
import { cn } from "@/lib/utils"

interface LogoProps {
  className?: string
  showText?: boolean
  size?: "sm" | "md" | "lg"
  /** Use light colors for dark backgrounds */
  variant?: "default" | "light"
}

export function Logo({ className, showText = true, size = "md", variant = "default" }: LogoProps) {
  const sizes = {
    sm: { icon: 32, wordmark: "sm" as const },
    md: { icon: 40, wordmark: "md" as const },
    lg: { icon: 56, wordmark: "lg" as const },
  }

  const { icon, wordmark } = sizes[size]

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <Image
        src="/brain-logo.png"
        alt="Cérebro Amigo"
        width={icon}
        height={icon}
        priority
        className={cn(
          "flex-shrink-0 object-contain",
          variant === "light" && "[filter:brightness(0)_invert(1)]",
        )}
      />

      {showText && (
        <BrandWordmark layout="inline" size={wordmark} variant={variant} />
      )}
    </div>
  )
}
