"use client"

// Layout compartilhado das seções do prontuário de um paciente. Carrega o
// cabeçalho (GET /api/pacientes/[id]), mostra BannerCrise + navegação entre
// seções, e renderiza a seção atual (children). Cada seção é rota própria.

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { Header } from "@/components/header"
import { BannerCrise } from "@/components/crise/banner-crise"
import { ProntuarioNav } from "@/components/prontuario/prontuario-nav"
import { Card, CardContent } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { User, Loader2, AlertTriangle, ArrowLeft } from "lucide-react"

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

function age(dataNascimento: string | null) {
  if (!dataNascimento) return null
  const diff = Date.now() - new Date(dataNascimento).getTime()
  return Math.floor(diff / (365.25 * 24 * 3600 * 1000))
}

export default function ProntuarioPacienteLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const params = useParams<{ id: string }>()
  const id = params.id
  const router = useRouter()
  const [paciente, setPaciente] = useState<Paciente | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState(false)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    setErro(false)
    fetch(`/api/pacientes/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error("falha ao carregar paciente")
        return r.json()
      })
      .then((p: Paciente) => setPaciente(p))
      .catch(() => setErro(true))
      .finally(() => setLoading(false))
  }, [id])

  return (
    <div className="min-h-screen">
      <Header title="Prontuário" subtitle="Histórico clínico do paciente" />

      <div className="p-6 space-y-6">
        <Link
          href="/dashboard/prontuarios"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Todos os pacientes
        </Link>

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : erro || !paciente ? (
          <Card className="border-amber-500/40 bg-amber-500/5">
            <CardContent className="p-6 text-center py-8">
              <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
              <p className="text-sm text-foreground font-medium">
                Não foi possível carregar este paciente.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Ele pode não existir ou não estar sob seus cuidados.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => router.push("/dashboard/prontuarios")}
              >
                Voltar à lista
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Cabeçalho do paciente */}
            <Card className="border-border/50">
              <CardContent className="p-6">
                <div className="flex items-start gap-4">
                  <Avatar className="h-16 w-16 border-2 border-primary/30">
                    <AvatarFallback className="bg-primary text-primary-foreground text-xl font-medium">
                      {initials(paciente.nome)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <h2 className="text-xl font-semibold text-foreground">{paciente.nome}</h2>
                    <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                      {age(paciente.dataNascimento) && (
                        <span className="flex items-center gap-1">
                          <User className="h-4 w-4" />
                          {age(paciente.dataNascimento)} anos
                        </span>
                      )}
                      {paciente.email && <span className="truncate">{paciente.email}</span>}
                    </div>
                    <Badge className="mt-2 bg-secondary text-primary hover:bg-secondary">
                      Paciente #{paciente.numero}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            <BannerCrise pacienteId={id} onRetomado={() => router.refresh()} />
            <ProntuarioNav pacienteId={id} />

            <div>{children}</div>
          </>
        )}
      </div>
    </div>
  )
}
