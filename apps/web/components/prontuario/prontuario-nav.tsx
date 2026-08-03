"use client"

// Navegação entre as seções unitárias do prontuário. Cada seção é uma rota
// própria sob /dashboard/prontuarios/<id>/<secao>; a ativa vem do pathname.
// Barra fixa (sticky) sob o Header: acompanha o scroll de timelines longas.

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import {
  Activity,
  Pill,
  Tablets,
  BarChart3,
  Search,
  ClipboardList,
  FlaskConical,
  Mic,
  type LucideIcon,
} from "lucide-react"

// `count` mapeia a seção a uma chave do /api/.../resumo-secoes (badge factual).
const SECOES: { slug: string; label: string; icon: LucideIcon; count?: keyof ResumoSecoes }[] = [
  { slug: "timeline", label: "Timeline", icon: Activity },
  { slug: "prescricoes", label: "Prescrições", icon: Pill },
  { slug: "medicacoes", label: "Medicações em uso", icon: Tablets, count: "medicacoes" },
  { slug: "escalas", label: "Escalas", icon: BarChart3, count: "escalas" },
  { slug: "busca", label: "Busca", icon: Search },
  { slug: "conduta", label: "Conduta", icon: ClipboardList },
  { slug: "exames", label: "Exames", icon: FlaskConical, count: "exames" },
  { slug: "audio", label: "Áudios", icon: Mic },
]

interface ResumoSecoes {
  medicacoes: number | null
  escalas: number | null
  exames: number | null
}

export function ProntuarioNav({ pacienteId }: { pacienteId: string }) {
  const pathname = usePathname()
  const [resumo, setResumo] = useState<ResumoSecoes | null>(null)

  useEffect(() => {
    let vivo = true
    fetch(`/api/pacientes/${pacienteId}/resumo-secoes`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ResumoSecoes | null) => { if (vivo) setResumo(d) })
      .catch(() => {})
    return () => { vivo = false }
  }, [pacienteId])

  return (
    <nav className="sticky top-[72px] z-20 -mx-6 border-b border-border/50 bg-background/80 px-6 py-2 backdrop-blur-md">
      <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {SECOES.map((s) => {
          const href = `/dashboard/prontuarios/${pacienteId}/${s.slug}`
          const ativo = pathname === href
          const Icon = s.icon
          const n = s.count && resumo ? resumo[s.count] : null
          return (
            <Link
              key={s.slug}
              href={href}
              aria-current={ativo ? "page" : undefined}
              className={cn(
                "group relative flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium outline-none transition-all duration-200",
                "focus-visible:ring-2 focus-visible:ring-primary/30",
                ativo
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground",
              )}
            >
              <Icon
                className={cn(
                  "h-4 w-4 shrink-0 transition-colors",
                  ativo ? "text-primary" : "text-muted-foreground/60 group-hover:text-primary",
                )}
              />
              <span className="whitespace-nowrap">{s.label}</span>
              {typeof n === "number" && n > 0 && (
                <span
                  className={cn(
                    "ml-0.5 grid h-4 min-w-4 shrink-0 place-items-center rounded-full px-1 text-[10px] font-semibold tabular-nums",
                    ativo ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground group-hover:text-foreground",
                  )}
                >
                  {n}
                </span>
              )}
              {ativo && (
                <span className="absolute inset-x-3 -bottom-2 h-0.5 rounded-full bg-primary" />
              )}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
