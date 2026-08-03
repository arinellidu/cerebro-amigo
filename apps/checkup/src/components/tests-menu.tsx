"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { TRIAGEM_GROUPS } from "@/lib/nav"

// "Todos os testes" — dropdown que expõe as 8 triagens sem entupir a navbar
// (header calmo, clinical-safety: público pode estar em sofrimento). Desktop-only
// (a nav é hidden md:flex); no mobile a descoberta vem do menu hambúrguer (MobileNav).
// Hand-rolled, sem dep nova: a11y por aria-expanded + Escape + click-outside.
// Grupos vêm de @/lib/nav (mesma fonte do MobileNav).

export function TestsMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointer(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false)
        btnRef.current?.focus()
      }
    }
    document.addEventListener("pointerdown", onPointer)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onPointer)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="tests-menu-panel"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        Todos os testes
        <ChevronDown
          aria-hidden
          className={cn(
            "size-4 transition-transform motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div
          id="tests-menu-panel"
          className="glass-noir absolute left-1/2 top-full z-50 mt-3 w-64 -translate-x-1/2 rounded-2xl border border-[var(--noir-glass-border)] p-3 shadow-xl"
        >
          <ul className="space-y-3">
            {TRIAGEM_GROUPS.map((group) => (
              <li key={group.label}>
                <p className="px-2 text-[0.65rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  {group.label}
                </p>
                <ul className="mt-1">
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setOpen(false)}
                        className="block rounded-lg px-2 py-1.5 text-sm text-foreground/80 transition-colors hover:bg-secondary/50 hover:text-foreground"
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
