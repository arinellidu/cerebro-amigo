"use client"

import { useEffect, useRef } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import styles from "@/components/access/signal-access.module.css"

// Banner exibido no /medico quando o médico chega pelo QR do PDF do Check-up
// (?src=checkup&rid=...). Lê o searchParams AQUI (client) — em Next 16 com
// cacheComponents/PPR, dado dinâmico tem que ficar sob <Suspense>, então a página
// /medico permanece estática e só este componente é dinâmico. Dispara `qr_scanned`
// (atribuição, ADR-046) e leva ao cadastro carregando src/rid. Isolamento: o evento
// vai pra API pública do checkup via BFF (/api/checkup-event); o web não escreve o schema.
export function CheckupQrBanner({ variant = "default" }: { variant?: "default" | "signal" }) {
  const params = useSearchParams()
  const src = params.get("src")
  const rid = params.get("rid")
  const fromCheckup = src === "checkup" && !!rid
  const fired = useRef(false)

  useEffect(() => {
    if (!fromCheckup || fired.current) return
    fired.current = true
    fetch("/api/checkup-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "qr_scanned", rid }),
    }).catch(() => {})
  }, [fromCheckup, rid])

  if (!fromCheckup) return null

  if (variant === "signal") {
    return (
      <div className={styles.qrBanner}>
        <div className={styles.qrBannerInner}>
          <p className={styles.qrBannerCopy}>
            <span>VERIFIED SOURCE · MENTAL HEALTH CHECK-UP</span>
            You received a Mental Health Check-Up report. Create your account to follow the patients who reach you.
          </p>
          <Link className={styles.qrBannerAction} href={`/medicos/cadastro?src=checkup&rid=${encodeURIComponent(rid!)}`}>
            Create account <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="border-b border-border/40 bg-primary/10">
      <div className="container mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-6 py-3 sm:flex-row">
        <p className="text-sm text-foreground">
          Você recebeu um relatório do Check-up Mental. Crie sua conta para acompanhar os pacientes que chegam até você.
        </p>
        <Button asChild size="sm" className="shrink-0">
          <Link href={`/medicos/cadastro?src=checkup&rid=${encodeURIComponent(rid!)}`}>
            Criar conta grátis
          </Link>
        </Button>
      </div>
    </div>
  )
}
