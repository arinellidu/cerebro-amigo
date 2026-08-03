"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Header } from "@/components/header"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Bell, BellOff, CalendarClock, FileText, Loader2 } from "lucide-react"

interface LembreteItem {
  id: string
  pacienteNome: string | null
  iniciaEm: string
  status: string
  lembreteDia: boolean // 24h antes
  lembreteHora: boolean // 1h antes
}

function quando(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function StatusLembrete({ enviado, rotulo }: { enviado: boolean; rotulo: string }) {
  return enviado ? (
    <Badge className="border-0 bg-success/10 text-success text-[10px] gap-1">
      <Bell className="h-3 w-3" /> {rotulo} enviado
    </Badge>
  ) : (
    <Badge className="border-0 bg-muted text-muted-foreground text-[10px] gap-1">
      <BellOff className="h-3 w-3" /> {rotulo} pendente
    </Badge>
  )
}

export default function LembretesPage() {
  const [itens, setItens] = useState<LembreteItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/lembretes")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setItens(Array.isArray(rows) ? rows : []))
      .catch(() => setItens([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="min-h-screen">
      <Header title="Lembretes" subtitle="Avisos automáticos de consulta enviados aos pacientes" />

      <div className="max-w-3xl p-6 space-y-4">
        <p className="text-sm text-muted-foreground">
          O paciente recebe um lembrete <strong>24h</strong> e outro <strong>1h</strong> antes da consulta
          (push no app, e-mail se não houver dispositivo). Conteúdo automático, sem dado clínico.
        </p>

        {loading ? (
          <div className="flex justify-center py-16 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : itens.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              Nenhuma consulta futura agendada.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {itens.map((it) => (
              <Card key={it.id} className="border-border/60">
                <CardContent className="flex items-center gap-4 p-4">
                  <CalendarClock className="h-5 w-5 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {it.pacienteNome ?? "Paciente"}
                    </p>
                    <p className="text-xs capitalize text-muted-foreground">{quando(it.iniciaEm)}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                    <StatusLembrete enviado={it.lembreteDia} rotulo="24h" />
                    <StatusLembrete enviado={it.lembreteHora} rotulo="1h" />
                    <Button variant="outline" size="sm" asChild className="gap-1 text-xs">
                      <Link href={`/dashboard/consultas/${it.id}/briefing`}>
                        <FileText className="h-3.5 w-3.5" /> Briefing
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
