import { cookies } from "next/headers"
import { notFound } from "next/navigation"
import { Mic, PenLine } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { PortalPageHeader } from "@/components/portal/page-header"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"

interface DiarioEntrada {
  id: string
  titulo: string | null
  conteudo: string
  humor: number | null
  tags: string[]
  compartilhadaComMedico: boolean
  criadaEm: string
  atualizadaEm: string
  tipo: string
  transcricao: string | null
}

async function carregarEntrada(id: string): Promise<DiarioEntrada | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get("paciente_token")?.value
  if (!token) return null

  const gateway = process.env.API_GATEWAY_URL ?? "http://localhost:5050"
  try {
    const res = await fetch(`${gateway}/api/v1/portal/paciente/diario/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export default async function DiarioDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const entrada = await carregarEntrada(id)
  if (!entrada) notFound()

  const quando = format(new Date(entrada.criadaEm), "d 'de' MMMM 'de' yyyy', às' HH:mm", {
    locale: ptBR,
  })

  return (
    <div className="space-y-5 p-5 pt-9">
      <PortalPageHeader
        backHref="/p/diario"
        eyebrow={entrada.tipo === "audio" ? "Áudio transcrito" : "Anotação"}
        titulo={entrada.titulo ?? "Entrada do diário"}
      />

      <div className="portal-rise-in portal-stagger-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        {entrada.tipo === "audio" ? (
          <span className="inline-flex items-center gap-1">
            <Mic className="h-3.5 w-3.5" /> Áudio transcrito
          </span>
        ) : (
          <span className="inline-flex items-center gap-1">
            <PenLine className="h-3.5 w-3.5" /> Texto
          </span>
        )}
        <span>·</span>
        <span className="nums">{quando}</span>
        {entrada.humor != null && <HumorBadge humor={entrada.humor} />}
        {entrada.compartilhadaComMedico && (
          <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
            Compartilhado
          </Badge>
        )}
      </div>

      {entrada.tags.length > 0 && (
        <div className="portal-rise-in portal-stagger-2 flex flex-wrap gap-1.5">
          {entrada.tags.map((t) => (
            <Badge key={t} variant="secondary" className="text-xs">
              {t}
            </Badge>
          ))}
        </div>
      )}

      <div className="portal-card portal-hairline portal-rise-in portal-stagger-3 p-5">
        <p className="whitespace-pre-wrap text-[0.95rem] leading-relaxed text-foreground/90">
          {entrada.conteudo}
        </p>
      </div>
    </div>
  )
}

function HumorBadge({ humor }: { humor: number }) {
  const emoji =
    humor >= 8 ? "😊" : humor >= 6 ? "🙂" : humor >= 4 ? "😐" : humor >= 2 ? "😔" : "😢"
  return (
    <span className="text-xs tabular-nums">
      {emoji} {humor}/10
    </span>
  )
}
