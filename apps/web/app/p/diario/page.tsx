import Link from "next/link"
import { cookies } from "next/headers"
import { Plus, Mic, PenLine, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { PortalPageHeader } from "@/components/portal/page-header"
import { formatDistanceToNow } from "date-fns"
import { ptBR } from "date-fns/locale"

interface DiarioEntrada {
  id: string
  titulo: string | null
  conteudo: string
  humor: number | null
  tags: string[]
  compartilhadaComMedico: boolean
  criadaEm: string
  tipo: string
  transcricao: string | null
}

async function carregarEntradas(): Promise<DiarioEntrada[]> {
  const cookieStore = await cookies()
  const token = cookieStore.get("paciente_token")?.value
  if (!token) return []

  const gateway = process.env.API_GATEWAY_URL ?? "http://localhost:5050"
  try {
    const res = await fetch(`${gateway}/api/v1/portal/paciente/diario/?pageSize=30`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
    if (!res.ok) return []
    return res.json()
  } catch {
    return []
  }
}

export default async function DiarioPage() {
  const entradas = await carregarEntradas()

  return (
    <div className="space-y-5 p-5 pt-9">
      <PortalPageHeader
        eyebrow="Seu espaço"
        titulo="Diário"
        subtitulo={
          entradas.length === 0
            ? "Nenhuma entrada ainda"
            : `${entradas.length} entr${entradas.length === 1 ? "ada" : "adas"} registrada${
                entradas.length === 1 ? "" : "s"
              }`
        }
        acao={
          <Button asChild size="sm" className="portal-tap rounded-full">
            <Link href="/p/diario/nova">
              <Plus className="mr-1 h-4 w-4" />
              Nova entrada
            </Link>
          </Button>
        }
      />

      {entradas.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="portal-rise-in portal-stagger-2 space-y-3">
          {entradas.map((e) => (
            <EntradaCard key={e.id} entrada={e} />
          ))}
        </div>
      )}
    </div>
  )
}

function EntradaCard({ entrada }: { entrada: DiarioEntrada }) {
  const preview = entrada.conteudo.slice(0, 120)
  const temMais = entrada.conteudo.length > 120
  const quando = formatDistanceToNow(new Date(entrada.criadaEm), {
    addSuffix: true,
    locale: ptBR,
  })

  return (
    <Link
      href={`/p/diario/${entrada.id}`}
      className="portal-card portal-tap group block p-4 hover:border-primary/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary/12 text-primary">
              {entrada.tipo === "audio" ? (
                <Mic className="h-3.5 w-3.5" />
              ) : (
                <PenLine className="h-3.5 w-3.5" />
              )}
            </span>
            {entrada.titulo ? (
              <span className="truncate text-sm font-medium text-foreground">{entrada.titulo}</span>
            ) : (
              <span className="text-sm italic text-muted-foreground">Sem título</span>
            )}
          </div>

          <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
            {preview}
            {temMais && "…"}
          </p>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">{quando}</span>
            {entrada.humor != null && <HumorBadge humor={entrada.humor} />}
            {entrada.compartilhadaComMedico && (
              <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                Compartilhado
              </Badge>
            )}
            {entrada.tags.slice(0, 3).map((t) => (
              <Badge key={t} variant="secondary" className="h-4 px-1.5 text-[10px]">
                {t}
              </Badge>
            ))}
          </div>
        </div>
        <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  )
}

function HumorBadge({ humor }: { humor: number }) {
  const emoji =
    humor >= 8 ? "😊" : humor >= 6 ? "🙂" : humor >= 4 ? "😐" : humor >= 2 ? "😔" : "😢"
  return (
    <span className="text-xs tabular-nums text-muted-foreground">
      {emoji} {humor}/10
    </span>
  )
}

function EmptyState() {
  return (
    <div className="portal-card portal-hairline portal-rise-in portal-stagger-2 flex flex-col items-center gap-4 px-6 py-14 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-primary/10 text-3xl ring-1 ring-primary/15">
        📔
      </div>
      <div>
        <p className="portal-display text-lg font-medium text-foreground">Seu diário está vazio</p>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          Registre como você está se sentindo — por escrito ou gravando um áudio rápido.
        </p>
      </div>
      <Button asChild className="portal-tap rounded-full">
        <Link href="/p/diario/nova">
          <Plus className="mr-1 h-4 w-4" />
          Primeira entrada
        </Link>
      </Button>
    </div>
  )
}
