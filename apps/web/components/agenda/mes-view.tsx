"use client"

import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns"

interface Consulta {
  id: string
  pacienteNome?: string | null
  iniciaEm: string
  status: string
}

const STATUS_DOT: Record<string, string> = {
  agendada:  "bg-muted-foreground/60",
  confirmada:"bg-success",
  realizada: "bg-primary",
  cancelada: "bg-destructive/40",
}

const CAB = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"]

export function MesView({
  consultas,
  mesAnchor,
  onDiaClick,
}: {
  consultas: Consulta[]
  mesAnchor: Date
  onDiaClick: (d: Date) => void
}) {
  const inicio = startOfWeek(startOfMonth(mesAnchor), { weekStartsOn: 1 })
  const fim = endOfWeek(endOfMonth(mesAnchor), { weekStartsOn: 1 })
  const dias = eachDayOfInterval({ start: inicio, end: fim })
  const hoje = new Date()

  function doDia(d: Date) {
    return consultas
      .filter((c) => isSameDay(new Date(c.iniciaEm), d))
      .sort((a, b) => a.iniciaEm.localeCompare(b.iniciaEm))
  }

  return (
    <div>
      <div className="mb-1 grid grid-cols-7 gap-1">
        {CAB.map((c) => (
          <div key={c} className="text-center text-[11px] font-medium text-muted-foreground py-1">
            {c}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {dias.map((d) => {
          const cs = doDia(d)
          const ativas = cs.filter((c) => c.status !== "cancelada")
          const noMes = isSameMonth(d, mesAnchor)
          const isHoje = isSameDay(d, hoje)
          return (
            <button
              key={d.toISOString()}
              onClick={() => onDiaClick(d)}
              className={`flex flex-col rounded-lg border text-left transition-colors hover:bg-secondary/60 min-h-[80px] p-1.5
                ${noMes ? "border-border/60 bg-card" : "border-transparent bg-transparent opacity-35"}
                ${isHoje ? "ring-1 ring-primary" : ""}
              `}
            >
              <span className={`text-xs mb-1 font-medium ${isHoje ? "text-primary font-bold" : "text-foreground"}`}>
                {format(d, "d")}
              </span>
              <div className="flex flex-col gap-0.5 flex-1">
                {ativas.slice(0, 3).map((c) => (
                  <div key={c.id} className="flex items-center gap-1">
                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${STATUS_DOT[c.status] ?? "bg-muted-foreground"}`} />
                    <span className="truncate text-[10px] text-foreground leading-tight">
                      {new Date(c.iniciaEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      {c.pacienteNome ? ` ${c.pacienteNome.split(" ")[0]}` : ""}
                    </span>
                  </div>
                ))}
                {ativas.length > 3 && (
                  <p className="text-[10px] text-muted-foreground pl-2.5">+{ativas.length - 3}</p>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
