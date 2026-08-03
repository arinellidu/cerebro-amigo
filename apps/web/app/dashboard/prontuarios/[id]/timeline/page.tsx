"use client"

import { useCallback, useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  FileText,
  Calendar,
  Activity,
  AlertTriangle,
  MessageSquare,
  Loader2,
} from "lucide-react"

interface TimelineItem {
  tipo: string
  quando: string
  titulo: string
  descricao: string
  intensidade: number | null
  origem: string
}

const TIPO_ICON: Record<string, React.ReactNode> = {
  mensagem: <MessageSquare className="h-4 w-4 text-primary" />,
  sintoma: <Activity className="h-4 w-4 text-blue-500" />,
  evento: <Calendar className="h-4 w-4 text-purple-500" />,
  crise: <AlertTriangle className="h-4 w-4 text-red-500" />,
}

const TIPO_LABEL: Record<string, string> = {
  mensagem: "Mensagem",
  sintoma: "Sintoma",
  evento: "Evento",
  crise: "Crise",
}

export default function TimelinePage() {
  const { id } = useParams<{ id: string }>()
  const [timeline, setTimeline] = useState<TimelineItem[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState(false)

  const fetchTimeline = useCallback((pid: string) => {
    setLoading(true)
    setErro(false)
    setTimeline([])
    fetch(`/api/pacientes/${pid}/timeline?dias=60`)
      .then((r) => {
        if (!r.ok) throw new Error("falha ao carregar timeline")
        return r.json()
      })
      .then(setTimeline)
      .catch(() => setErro(true))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (id) fetchTimeline(id)
  }, [id, fetchTimeline])

  return (
    <div className="space-y-3">
      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : erro ? (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="p-6 text-center py-8">
            <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
            <p className="text-sm text-foreground font-medium">
              Não foi possível carregar o histórico deste paciente.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Recarregue antes de tomar decisões clínicas — a lista abaixo pode estar incompleta.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => id && fetchTimeline(id)}
            >
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      ) : timeline.length === 0 ? (
        <Card className="border-border/50">
          <CardContent className="p-6 text-center py-8">
            <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-sm text-muted-foreground">
              Nenhum evento nos últimos 60 dias.
            </p>
          </CardContent>
        </Card>
      ) : (
        timeline.map((item, i) => (
          <Card key={i} className="border-border/50">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5">
                  {TIPO_ICON[item.tipo] ?? <FileText className="h-4 w-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="secondary" className="text-xs">
                      {TIPO_LABEL[item.tipo] ?? item.tipo}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(item.quando).toLocaleString("pt-BR")}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-foreground">{item.titulo}</p>
                  {item.descricao && (
                    <p className="text-sm text-muted-foreground mt-0.5 line-clamp-3">
                      {item.descricao}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}
