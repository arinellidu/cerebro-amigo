"use client"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"

interface BackButtonProps {
  label?: string
  className?: string
  /** Quando fornecido, navega diretamente para este destino sem usar router.back(). */
  href?: string
  /** Destino quando não há histórico interno para voltar (land direto, novo tab, pós-redirect). */
  fallbackHref?: string
}

export function BackButton({ label = "Voltar", className, href, fallbackHref = "/" }: BackButtonProps) {
  const router = useRouter()

  if (href) {
    return (
      <Button variant="ghost" size="sm" asChild className={className}>
        <a href={href}>
          <ArrowLeft className="h-4 w-4" />
          {label}
        </a>
      </Button>
    )
  }

  const handleBack = () => {
    // router.back() é no-op quando não há entrada anterior no histórico
    // (URL digitada, novo tab, vindo de redirect). Aí cai no fallback.
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back()
      return
    }
    router.push(fallbackHref)
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleBack}
      className={className}
    >
      <ArrowLeft className="h-4 w-4" />
      {label}
    </Button>
  )
}
