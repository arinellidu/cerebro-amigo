"use client"

import Link from "next/link"
import { addDays, format, isSameDay } from "date-fns"
import { ptBR } from "date-fns/locale"

interface Consulta {
  id: string
  pacienteNome: string | null
  iniciaEm: string
  modalidade: string
  status: string
}

const STATUS_DOT: Record<string, string> = {
  agendada: "bg-muted-foreground",
  confirmada: "bg-success",
  realizada: "bg-primary",
  cancelada: "bg-destructive",
}

function hora(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
}

export function SemanaView({
  consultas,
  semanaInicio,
  onDiaClick,
}: {
  consultas: Consulta[]
  semanaInicio: Date // segunda-feira
  onDiaClick: (d: Date) => void
}) {
  const dias = Array.from({ length: 7 }, (_, i) => addDays(semanaInicio, i))

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-7">
      {dias.map((d) => {
        const doDia = consultas
          .filter((c) => isSameDay(new Date(c.iniciaEm), d))
          .sort((a, b) => a.iniciaEm.localeCompare(b.iniciaEm))
        const hoje = isSameDay(d, new Date())
        return (
          <div
            key={d.toISOString()}
            className={`rounded-lg border bg-card ${hoje ? "border-primary/40 ring-1 ring-primary/20" : "border-border/60"}`}
          >
            <button
              onClick={() => onDiaClick(d)}
              className="flex w-full items-center justify-between border-b border-border/60 px-2 py-1.5 text-left hover:bg-secondary/60"
            >
              <span className="text-[11px] font-medium capitalize text-muted-foreground">
                {format(d, "EEE", { locale: ptBR })}
              </span>
              <span className={`text-sm font-semibold ${hoje ? "text-primary" : "text-foreground"}`}>
                {format(d, "d")}
              </span>
            </button>
            <div className="space-y-1 p-2">
              {doDia.length === 0 ? (
                <p className="px-1 py-2 text-[11px] text-muted-foreground">—</p>
              ) : (
                doDia.map((c) => (
                  <Link
                    key={c.id}
                    href={`/dashboard/consultas/${c.id}/briefing`}
                    className={`block rounded-md bg-secondary/50 px-2 py-1 hover:bg-secondary ${c.status === "cancelada" ? "opacity-50" : ""}`}
                  >
                    <span className="flex items-center gap-1 text-[11px]">
                      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[c.status] ?? "bg-muted-foreground"}`} />
                      <span className="font-semibold text-foreground">{hora(c.iniciaEm)}</span>
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {c.pacienteNome ?? "Paciente"}
                    </span>
                  </Link>
                ))
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
