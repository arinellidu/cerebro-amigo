"use client"

import { Header } from "@/components/header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  Search,
  Filter,
  Calendar,
  MessageSquare,
  FileText,
  Mail,
  Pill,
  ChevronRight,
  Download,
  FileDown,
  Printer,
} from "lucide-react"
import { useState, useEffect, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ImportarDialog } from "@/components/pacientes/importar-dialog"
import { NovoPacienteDialog } from "@/components/pacientes/novo-paciente-dialog"
import { ReenviarLinkButton } from "@/components/pacientes/reenviar-link-button"
import { PacientesCommand } from "@/components/pacientes/pacientes-command"
import { baixarModelo, exportarPacientes } from "@/lib/pacientes-xlsx"

interface Paciente {
  id: string
  numero: number
  nome: string
  email: string | null
  prescricoesAtivas: number
  ultimaMsg: string | null
}

function initials(nome: string) {
  return nome.split(" ").slice(0, 2).map((n) => n[0]).join("").toUpperCase()
}

function PacientesContent() {
  const router = useRouter()
  // Busca vem do header fixo (?q=<termo>) e re-sincroniza a cada navegação.
  const searchParams = useSearchParams()
  const qParam = searchParams.get("q") ?? ""
  const [searchQuery, setSearchQuery] = useState(qParam)
  useEffect(() => {
    setSearchQuery(qParam)
  }, [qParam])
  const [pacientes, setPacientes] = useState<Paciente[]>([])
  const [loading, setLoading] = useState(true)
  const [cmdOpen, setCmdOpen] = useState(false)

  // Cmd/Ctrl+K abre a busca rápida de pacientes.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setCmdOpen((v) => !v)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])

  // Ações da linha do paciente → deep-link com ?paciente=<id> (as páginas-alvo leem).
  const irPront = (id: string) => router.push(`/dashboard/prontuarios/${id}`)
  const irConversa = (id: string) => router.push(`/dashboard/mensagens?paciente=${id}`)
  const irAgenda = (id: string) => router.push(`/dashboard/agenda?paciente=${id}`)

  const recarregar = () => {
    setLoading(true)
    fetch("/api/pacientes/")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setPacientes)
      .catch(() => setPacientes([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    recarregar()
  }, [])

  const filteredPatients = pacientes.filter((p) =>
    p.nome.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="min-h-screen">
      <PacientesCommand open={cmdOpen} onOpenChange={setCmdOpen} />
      <div className="print:hidden">
        <Header title="Pacientes" subtitle="Gerencie seus pacientes" />
      </div>
      {/* Título só na impressão (Header é escondido no print) */}
      <h1 className="hidden print:block px-6 pt-6 text-2xl font-semibold text-foreground">
        Pacientes
      </h1>

      <div className="p-6 space-y-6">
        {/* Search and Toolbar */}
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between print:hidden">
          <div className="relative w-full sm:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Buscar paciente por nome..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-card border-border focus-visible:ring-primary"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" className="gap-2" onClick={() => setCmdOpen(true)}>
              <Search className="h-4 w-4" />
              Busca rápida
              <kbd className="ml-1 hidden rounded border border-border/70 bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">
                ⌘K
              </kbd>
            </Button>
            <Button variant="outline" className="gap-2">
              <Filter className="h-4 w-4" />
              Filtros
            </Button>
            <ImportarDialog onConcluido={recarregar} />
            <Button variant="outline" className="gap-2" onClick={baixarModelo}>
              <Download className="h-4 w-4" />
              Baixar modelo
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => exportarPacientes(filteredPatients)}
              disabled={filteredPatients.length === 0}
            >
              <FileDown className="h-4 w-4" />
              Exportar
            </Button>
            <Button variant="outline" className="gap-2" onClick={() => window.print()}>
              <Printer className="h-4 w-4" />
              Imprimir
            </Button>
            <NovoPacienteDialog onConcluido={recarregar} />
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="border-border/50">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Total</p>
              <p className="text-2xl font-bold text-foreground">{pacientes.length}</p>
            </CardContent>
          </Card>
          <Card className="border-border/50">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Com medicação</p>
              <p className="text-2xl font-bold text-success">
                {pacientes.filter((p) => p.prescricoesAtivas > 0).length}
              </p>
            </CardContent>
          </Card>
          <Card className="border-border/50">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Sem medicação</p>
              <p className="text-2xl font-bold text-primary">
                {pacientes.filter((p) => p.prescricoesAtivas === 0).length}
              </p>
            </CardContent>
          </Card>
          <Card className="border-border/50">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Filtrados</p>
              <p className="text-2xl font-bold text-warning">
                {filteredPatients.length}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Patients List */}
        <Card className="border-border/50">
          <CardContent className="p-0">
            {loading ? (
              <div className="p-8 text-center text-muted-foreground text-sm">Carregando...</div>
            ) : filteredPatients.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                {pacientes.length === 0 ? "Nenhum paciente cadastrado." : "Nenhum resultado para a busca."}
              </div>
            ) : (
              <div className="divide-y divide-border">
                {filteredPatients.map((paciente) => (
                  <div
                    key={paciente.id}
                    onClick={() => irPront(paciente.id)}
                    className="flex items-center gap-4 p-4 hover:bg-muted/50 transition-colors cursor-pointer group"
                  >
                    <Avatar className="h-12 w-12 border-2 border-primary/20">
                      <AvatarFallback className="bg-secondary text-primary font-medium">
                        {initials(paciente.nome)}
                      </AvatarFallback>
                    </Avatar>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium text-foreground truncate">{paciente.nome}</h3>
                        <span className="text-xs text-muted-foreground">#{paciente.numero}</span>
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                        {paciente.email && (
                          <span className="flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            {paciente.email}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Pill className="h-3 w-3" />
                          {paciente.prescricoesAtivas} medicações
                        </span>
                      </div>
                    </div>

                    {paciente.ultimaMsg && (
                      <div className="hidden md:block text-right">
                        <p className="text-sm text-muted-foreground">Última mensagem</p>
                        <p className="text-sm font-medium text-foreground">
                          {new Date(paciente.ultimaMsg).toLocaleDateString("pt-BR")}
                        </p>
                      </div>
                    )}

                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity print:hidden">
                      <Button variant="ghost" size="icon" title="Agendar consulta" aria-label="Agendar consulta"
                        className="h-8 w-8 text-muted-foreground hover:text-primary"
                        onClick={(e) => { e.stopPropagation(); irAgenda(paciente.id) }}>
                        <Calendar className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" title="Conversa" aria-label="Conversa"
                        className="h-8 w-8 text-muted-foreground hover:text-primary"
                        onClick={(e) => { e.stopPropagation(); irConversa(paciente.id) }}>
                        <MessageSquare className="h-4 w-4" />
                      </Button>
                      {paciente.email && (
                        <ReenviarLinkButton email={paciente.email} nome={paciente.nome} />
                      )}
                      <Button variant="ghost" size="icon" title="Prontuário" aria-label="Prontuário"
                        className="h-8 w-8 text-muted-foreground hover:text-primary"
                        onClick={(e) => { e.stopPropagation(); irPront(paciente.id) }}>
                        <FileText className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" title="Abrir prontuário" aria-label="Abrir prontuário"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        onClick={(e) => { e.stopPropagation(); irPront(paciente.id) }}>
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default function PacientesPage() {
  return (
    <Suspense
      fallback={<div className="p-8 text-center text-muted-foreground text-sm">Carregando...</div>}
    >
      <PacientesContent />
    </Suspense>
  )
}
