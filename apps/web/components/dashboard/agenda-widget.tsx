"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react"

interface Consulta {
  id: string
  pacienteNome: string | null
  iniciaEm: string
  modalidade: string
  status: string
}

const weekDays = ["D", "S", "T", "Q", "Q", "S", "S"]
const delayClass = ["delay-100", "delay-200", "delay-300"]

const STATUS_DOT: Record<string, string> = {
  confirmada: "bg-success",
  agendada: "bg-warning",
  realizada: "bg-primary",
  cancelada: "bg-destructive",
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
function hora(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
}

export function AgendaWidget() {
  const [currentDate] = useState(new Date())
  const [consultas, setConsultas] = useState<Consulta[]>([])
  const [loading, setLoading] = useState(true)
  const today = currentDate.getDate()

  useEffect(() => {
    const hoje = ymd(new Date())
    fetch(`/api/consultas?de=${hoje}&ate=${hoje}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setConsultas(Array.isArray(rows) ? rows : []))
      .catch(() => setConsultas([]))
      .finally(() => setLoading(false))
  }, [])

  const getDaysInMonth = () => {
    const year = currentDate.getFullYear()
    const month = currentDate.getMonth()
    const firstDay = new Date(year, month, 1).getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const days: (number | null)[] = []
    for (let i = 0; i < firstDay; i++) days.push(null)
    for (let i = 1; i <= daysInMonth; i++) days.push(i)
    return days
  }
  const days = getDaysInMonth()

  const ordenadas = [...consultas].sort((a, b) => a.iniciaEm.localeCompare(b.iniciaEm))

  return (
    <Card className="border-border/80 hover:border-primary/25 hover:shadow-[0_4px_24px_rgba(94,75,139,0.07)] transition-all duration-200">
      <CardHeader className="pb-2 pt-5 px-5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-[0.9375rem] font-semibold text-foreground">Agenda</CardTitle>
          <div className="flex items-center gap-0.5">
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" disabled>
              <ChevronLeft size={16} />
            </Button>
            <span className="text-xs font-medium text-muted-foreground px-1">
              {currentDate.toLocaleDateString("pt-BR", { month: "short", year: "numeric" })}
            </span>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" disabled>
              <ChevronRight size={16} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-5 pt-1.5 pb-4">
        {/* Mini calendar */}
        <div className="grid grid-cols-7 gap-0.5 text-center mb-1">
          {weekDays.map((d, i) => (
            <div key={i} className="text-[10px] font-semibold text-muted-foreground py-1 uppercase tracking-wide">
              {d}
            </div>
          ))}
          {days.map((day, i) => (
            <div
              key={i}
              className={`text-xs py-1.5 rounded-lg font-medium ${
                day === null
                  ? ""
                  : day === today
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-foreground"
              }`}
            >
              {day}
            </div>
          ))}
        </div>

        {/* Appointments (reais) */}
        <div className="pt-3 border-t border-border/50 space-y-2">
          <p className="text-xs font-semibold text-foreground mb-2">Consultas de Hoje</p>
          {loading ? (
            <div className="flex justify-center py-4 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : ordenadas.length === 0 ? (
            <p className="py-3 text-center text-xs text-muted-foreground">Nenhuma consulta hoje.</p>
          ) : (
            <div className="space-y-1.5 max-h-[180px] overflow-y-auto">
              {ordenadas.slice(0, 3).map((c, i) => (
                <Link
                  key={c.id}
                  href={`/dashboard/consultas/${c.id}/briefing`}
                  className={`flex items-center gap-3 p-2.5 rounded-xl bg-muted/40 hover:bg-secondary transition-colors cursor-pointer animate-fade-left ${delayClass[i]}`}
                >
                  <span className="text-sm font-bold tabular-nums w-12 flex-shrink-0 text-primary">
                    {hora(c.iniciaEm)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{c.pacienteNome ?? "Paciente"}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Badge
                        variant="secondary"
                        className="text-[0.6rem] h-4 px-1.5 font-semibold border-0 bg-primary/10 text-primary capitalize"
                      >
                        {c.modalidade}
                      </Badge>
                      <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[c.status] ?? "bg-warning"}`} />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
          <Button
            variant="ghost"
            asChild
            className="w-full text-primary hover:text-purple-dark hover:bg-secondary mt-1 text-xs h-8"
          >
            <Link href="/dashboard/agenda">Ver agenda completa</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
