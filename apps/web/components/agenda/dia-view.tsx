"use client"

import { isSameDay } from "date-fns"
import { Video, MapPin, AlertCircle, CalendarOff } from "lucide-react"

interface Consulta {
  id: string
  pacienteId: string
  pacienteNome: string | null
  iniciaEm: string
  duracaoMin: number
  modalidade: string
  status: string
  notas: string | null
}

const HORA_INI = 7
const HORA_FIM = 21
const PX_POR_MIN = 1.4   // 1 minuto = 1.4px → 14h = 1176px total

const STATUS_COR: Record<string, { fundo: string; borda: string; texto: string }> = {
  agendada:  { fundo: "bg-secondary",         borda: "border-l-muted-foreground/60", texto: "text-foreground"   },
  confirmada:{ fundo: "bg-success/10",         borda: "border-l-success",             texto: "text-success"      },
  realizada: { fundo: "bg-primary/10",         borda: "border-l-primary",             texto: "text-primary"      },
  cancelada: { fundo: "bg-destructive/5",      borda: "border-l-destructive/40",      texto: "text-destructive"  },
}

function ehNoShow(c: Consulta) {
  return c.status === "cancelada" && c.notas?.startsWith("[no-show]")
}

function minutosDosDia(iso: string, dia: Date) {
  const d = new Date(iso)
  if (!isSameDay(d, dia)) return null
  return d.getHours() * 60 + d.getMinutes()
}

function topo(mins: number) {
  return Math.max(0, (mins - HORA_INI * 60)) * PX_POR_MIN
}

function altura(duracaoMin: number) {
  return Math.max(28, duracaoMin * PX_POR_MIN)
}

// Detecta sobreposições e distribui em colunas
function distribuir(consultas: Consulta[], dia: Date) {
  const sorted = consultas
    .map((c) => ({ c, mins: minutosDosDia(c.iniciaEm, dia) }))
    .filter((x): x is { c: Consulta; mins: number } => x.mins !== null)
    .sort((a, b) => a.mins - b.mins)

  const colunas: Array<Array<{ c: Consulta; mins: number }>> = []

  for (const item of sorted) {
    let colocado = false
    for (const col of colunas) {
      const ultimo = col[col.length - 1]
      if (ultimo.mins + Math.max(item.c.duracaoMin, 15) <= item.mins) {
        col.push(item)
        colocado = true
        break
      }
    }
    if (!colocado) colunas.push([item])
  }

  return colunas
}

function hora(m: number) {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
}

export function DiaView({
  dia,
  consultas,
  onSelect,
}: {
  dia: Date
  consultas: Consulta[]
  onSelect: (c: Consulta) => void
}) {
  const horas = Array.from({ length: HORA_FIM - HORA_INI + 1 }, (_, i) => HORA_INI + i)
  const totalPx = (HORA_FIM - HORA_INI) * 60 * PX_POR_MIN
  const colunas = distribuir(consultas, dia)
  const nCols = Math.max(1, colunas.length)

  const agora = new Date()
  const ehHoje = isSameDay(dia, agora)
  const agoraMins = agora.getHours() * 60 + agora.getMinutes()
  const mostrarAgora = ehHoje && agoraMins >= HORA_INI * 60 && agoraMins <= HORA_FIM * 60

  if (consultas.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/60 bg-card/40 py-20 text-center">
        <CalendarOff className="h-8 w-8 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">Nenhuma consulta neste dia.</p>
      </div>
    )
  }

  return (
    <div className="relative flex gap-0 overflow-auto rounded-xl border border-border/60 bg-card">
      {/* Eixo de horas */}
      <div className="relative shrink-0 w-14 border-r border-border/40">
        <div style={{ height: totalPx }}>
          {horas.map((h) => (
            <div
              key={h}
              className="absolute right-0 flex items-center pr-2"
              style={{ top: (h - HORA_INI) * 60 * PX_POR_MIN - 9 }}
            >
              <span className="text-[10px] text-muted-foreground">{h}:00</span>
            </div>
          ))}
        </div>
      </div>

      {/* Grade + cards */}
      <div className="relative flex-1">
        {/* Linhas de hora */}
        <div className="absolute inset-0 pointer-events-none" style={{ height: totalPx }}>
          {horas.map((h) => (
            <div
              key={h}
              className="absolute left-0 right-0 border-t border-border/30"
              style={{ top: (h - HORA_INI) * 60 * PX_POR_MIN }}
            />
          ))}
        </div>

        {/* Indicador "agora" — só quando vendo o dia de hoje */}
        {mostrarAgora && (
          <div
            className="pointer-events-none absolute left-0 right-0 z-10"
            style={{ top: topo(agoraMins) }}
            aria-hidden
          >
            <span className="absolute -left-[3px] -top-[3px] h-1.5 w-1.5 rounded-full bg-coral shadow-[0_0_8px_var(--coral)]" />
            <div className="border-t border-coral/70" />
          </div>
        )}

        {/* Cards posicionados */}
        <div className="relative" style={{ height: totalPx }}>
          {colunas.map((col, ci) =>
            col.map(({ c, mins }) => {
              const st = STATUS_COR[c.status] ?? STATUS_COR.agendada
              const noShow = ehNoShow(c)
              const w = `calc(${100 / nCols}% - 6px)`
              const left = `calc(${(ci / nCols) * 100}% + 3px)`
              const alt = altura(c.duracaoMin)
              const mostrarNome = alt >= 40
              const mostrarHora = alt >= 28

              return (
                <button
                  key={c.id}
                  onClick={() => onSelect(c)}
                  className={`absolute rounded-md border-l-2 px-2 py-1 text-left shadow-sm transition-all hover:brightness-95 active:scale-[0.98] overflow-hidden ${st.fundo} ${st.borda} ${c.status === "cancelada" ? "opacity-60" : ""}`}
                  style={{
                    top: topo(mins),
                    height: alt,
                    width: w,
                    left,
                  }}
                >
                  {noShow && (
                    <span className="absolute right-1 top-1">
                      <AlertCircle className="h-3 w-3 text-warning" />
                    </span>
                  )}
                  {mostrarHora && (
                    <p className={`text-[10px] font-semibold ${st.texto}`}>
                      {hora(mins)}
                      {c.duracaoMin > 0 && ` · ${c.duracaoMin}min`}
                    </p>
                  )}
                  {mostrarNome && (
                    <p className="truncate text-xs text-foreground font-medium leading-tight">
                      {c.pacienteNome ?? "Paciente"}
                    </p>
                  )}
                  {alt >= 56 && (
                    <p className="text-[10px] text-muted-foreground flex items-center gap-0.5 mt-0.5">
                      {c.modalidade === "teleconsulta"
                        ? <><Video className="h-2.5 w-2.5" /> Teleconsulta</>
                        : <><MapPin className="h-2.5 w-2.5" /> Presencial</>}
                    </p>
                  )}
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
