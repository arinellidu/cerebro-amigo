"use client"

import { useState } from "react"
import Link from "next/link"
import { Pill, Check, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"

export interface TomadaHoje {
  id: string
  horarioPrevisto: string
  status: string
  medicamento: string
  dose: string
  prescricaoId: string
}

function horaCurta(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
}

// Medicações de hoje na home — confirmação inline (Tier 1) sem ir à aba Medicações.
export function MedsHoje({ tomadas }: { tomadas: TomadaHoje[] }) {
  const [statusMap, setStatusMap] = useState<Record<string, string>>(() =>
    Object.fromEntries(tomadas.map((t) => [t.id, t.status])),
  )
  const [confirmando, setConfirmando] = useState<string | null>(null)
  const [erro, setErro] = useState<Record<string, boolean>>({})

  async function confirmar(t: TomadaHoje) {
    setConfirmando(t.id)
    setErro((e) => ({ ...e, [t.id]: false }))
    try {
      const r = await fetch(`/api/paciente/medicacoes/confirmar/${t.prescricaoId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "tomada" }),
      })
      if (r.ok) {
        setStatusMap((m) => ({ ...m, [t.id]: "tomada" }))
      } else {
        setErro((e) => ({ ...e, [t.id]: true }))
      }
    } catch {
      setErro((e) => ({ ...e, [t.id]: true }))
    } finally {
      setConfirmando(null)
    }
  }

  const pendentes = tomadas.filter((t) => statusMap[t.id] === "pendente")

  return (
    <section className="portal-card portal-hairline space-y-3.5 p-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/12 text-primary">
            <Pill className="h-4 w-4" />
          </span>
          Medicações de hoje
        </h2>
        <Link
          href="/p/medicacoes"
          className="portal-tap rounded-full px-2 py-1 text-xs text-primary hover:text-purple-light"
        >
          ver todas
        </Link>
      </div>

      {tomadas.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">Nenhuma medicação para hoje.</p>
      ) : (
        <ul className="space-y-2">
          {tomadas.slice(0, 4).map((t) => {
            const st = statusMap[t.id] ?? t.status
            const pendente = st === "pendente"
            return (
              <li
                key={t.id}
                className="flex items-center gap-3 rounded-xl border border-noir-line/50 bg-noir-surface-raised/50 px-3 py-2.5"
              >
                <span
                  className={`nums grid h-9 w-12 shrink-0 place-items-center rounded-lg text-[11px] font-semibold ${
                    pendente
                      ? "bg-warning/12 text-warning"
                      : "bg-success/12 text-success line-through opacity-70"
                  }`}
                >
                  {horaCurta(t.horarioPrevisto)}
                </span>
                <div className="min-w-0 flex-1 text-sm">
                  <span className="block truncate font-medium text-foreground">{t.medicamento}</span>
                  <span className="block truncate text-xs text-muted-foreground">{t.dose}</span>
                </div>
                {pendente ? (
                  <Button
                    size="sm"
                    variant="default"
                    className="portal-tap h-9 shrink-0 rounded-lg bg-primary px-3.5 text-xs font-medium hover:bg-purple-dark"
                    disabled={confirmando === t.id}
                    onClick={() => confirmar(t)}
                  >
                    {confirmando === t.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      "Tomei"
                    )}
                  </Button>
                ) : (
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-success">
                    <Check className="h-3.5 w-3.5" /> Tomada
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {pendentes.length > 0 && (
        <p className="nums text-xs text-warning">{pendentes.length} pendente(s) hoje</p>
      )}

      {Object.entries(erro).some(([, v]) => v) && (
        <p className="text-xs text-destructive">
          Não conseguimos registrar agora. Verifique sua conexão e tente de novo.
        </p>
      )}
    </section>
  )
}
