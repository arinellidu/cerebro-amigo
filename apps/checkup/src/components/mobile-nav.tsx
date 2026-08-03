"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { ArrowRight, Menu, X } from "lucide-react"
import { TRIAGEM_GROUPS } from "@/lib/nav"

// Menu hambúrguer do header (só mobile, < md). A nav desktop é hidden md:flex,
// então sem isto o celular só navegava pela home/footer. Painel ancora no
// <header> (sticky → containing block): absolute inset-x-0 top-full = largura
// cheia, logo abaixo do header, auto-altura. Header calmo (clinical-safety):
// sem drama, mesma fonte de grupos do TestsMenu (@/lib/nav).
// A11y: aria-expanded/controls, Escape fecha + devolve foco, overlay fecha,
// fecha ao navegar. Animação reusa .quiz-step-in (reduced-motion já zera global).
export function MobileNav() {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const pathname = usePathname()

  // Fecha ao trocar de rota (clique num link navega same-app).
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  // Escape fecha + devolve foco ao botão; trava scroll do fundo enquanto aberto.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false)
        btnRef.current?.focus()
      }
    }
    document.addEventListener("keydown", onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  return (
    <div className="md:hidden">
      <button
        ref={btnRef}
        type="button"
        aria-label={open ? "Fechar menu" : "Abrir menu"}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="mobile-nav-panel"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--noir-glass-border)] bg-secondary/50 text-foreground transition-colors hover:border-purple hover:text-foreground"
      >
        {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
      </button>

      {open && (
        <>
          {/* Overlay abaixo do header (z-30 < header z-40): toque fora fecha. */}
          <div
            aria-hidden
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm"
          />
          <div
            id="mobile-nav-panel"
            className="quiz-step-in absolute inset-x-0 top-full z-50 max-h-[80dvh] overflow-y-auto border-t border-[var(--noir-glass-border)] glass-noir"
          >
            <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6">
              <nav aria-label="Triagens">
                <ul className="space-y-5">
                  {TRIAGEM_GROUPS.map((group) => (
                    <li key={group.label}>
                      <p className="px-1 text-[0.65rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                        {group.label}
                      </p>
                      <ul className="mt-1.5">
                        {group.items.map((item) => (
                          <li key={item.href}>
                            <Link
                              href={item.href}
                              onClick={() => setOpen(false)}
                              className="flex min-h-[44px] items-center rounded-xl px-3 text-[0.95rem] text-foreground/90 transition-colors hover:bg-secondary/50 hover:text-foreground"
                            >
                              {item.label}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </nav>

              {/* "Conheça o Cérebro Amigo" mora aqui no mobile (sai do header
                  pra não competir com o hambúrguer em telas estreitas). */}
              <a
                href="https://www.cerebroamigo.com.br"
                className="mt-6 flex min-h-[44px] items-center justify-center gap-1.5 rounded-full border border-[var(--noir-glass-border)] bg-secondary/50 px-4 text-sm font-medium text-secondary-foreground transition-colors hover:border-purple hover:text-foreground"
              >
                Conheça o Cérebro Amigo
                <ArrowRight className="h-4 w-4" aria-hidden />
              </a>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
