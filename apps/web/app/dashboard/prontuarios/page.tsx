"use client"

// Índice de prontuários: lista de pacientes do médico. Selecionar um paciente
// abre as páginas unitárias de seção (/dashboard/prontuarios/<id>/<secao>).
// Deep-links antigos (?paciente=<id>) são redirecionados pra página do paciente.

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Header } from "@/components/header"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Search, ChevronRight, AlertTriangle, Loader2 } from "lucide-react"

interface Paciente {
  id: string
  numero: number
  nome: string
  email: string
  prescricoesAtivas: number
  ultimaMsg: string | null
  dataNascimento: string | null
}

function initials(nome: string) {
  return nome
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("")
}

function relativeDate(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("pt-BR")
}

function ProntuariosIndex() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [pacientes, setPacientes] = useState<Paciente[]>([])
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState(false)

  // Back-compat: deep-links antigos ?paciente=<id> → página unitária do paciente.
  useEffect(() => {
    const alvo = searchParams.get("paciente")
    if (alvo) router.replace(`/dashboard/prontuarios/${alvo}`)
  }, [searchParams, router])

  function carregar() {
    setLoading(true)
    setErro(false)
    fetch("/api/pacientes")
      .then((r) => {
        if (!r.ok) throw new Error("falha ao carregar pacientes")
        return r.json()
      })
      .then((data: Paciente[]) => setPacientes(data))
      .catch(() => setErro(true))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    carregar()
  }, [])

  const filtered = pacientes.filter((p) =>
    p.nome.toLowerCase().includes(search.toLowerCase()),
  )

  function abrir(id: string) {
    router.push(`/dashboard/prontuarios/${id}/timeline`)
  }

  return (
    <div className="min-h-screen">
      <Header title="Prontuários" subtitle="Selecione um paciente" />

      <div className="p-6">
        <Card className="border-border/50 max-w-3xl">
          <CardHeader className="pb-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Buscar paciente..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-muted/50 border-0 focus-visible:ring-primary"
              />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : erro ? (
              <div className="text-center py-8 px-4">
                <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">
                  Não foi possível carregar a lista de pacientes.
                </p>
                <Button variant="outline" size="sm" className="mt-3" onClick={carregar}>
                  Tentar novamente
                </Button>
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Nenhum paciente encontrado.
              </p>
            ) : (
              <div className="divide-y divide-border max-h-[calc(100vh-260px)] overflow-y-auto">
                {filtered.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => abrir(p.id)}
                    className="w-full flex items-center gap-3 p-4 hover:bg-muted/50 transition-colors text-left"
                  >
                    <Avatar className="h-11 w-11 border-2 border-primary/20">
                      <AvatarFallback className="bg-secondary text-primary font-medium">
                        {initials(p.nome)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground truncate">{p.nome}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.prescricoesAtivas} prescrição{p.prescricoesAtivas !== 1 ? "ões" : ""} ativa
                        {p.prescricoesAtivas !== 1 ? "s" : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Última msg: {relativeDate(p.ultimaMsg)}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default function ProntuariosPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-muted-foreground text-sm">Carregando...</div>
      }
    >
      <ProntuariosIndex />
    </Suspense>
  )
}
