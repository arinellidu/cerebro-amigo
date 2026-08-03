"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ClipboardCheck, Loader2, Check, Smile } from "lucide-react"
import { Button } from "@/components/ui/button"
import { QuestionarioEscala } from "@/components/portal/QuestionarioEscala"
import { PortalErroCarregar } from "@/components/portal/portal-erro-carregar"

interface Checkin {
  id: string
  tipo: string
  payloadJson: string
  agendadoPara: string
}

const ROTULO: Record<string, string> = {
  medicacao: "Confirmação de medicação",
  humor_diario: "Check-in de humor",
  questionario_phq9: "Questionário PHQ-9",
  questionario_gad7: "Questionário GAD-7",
}

export default function CheckinsPage() {
  const [itens, setItens] = useState<Checkin[]>([])
  const [loading, setLoading] = useState(true)
  const [falhou, setFalhou] = useState(false)
  const [respondendo, setRespondendo] = useState<string | null>(null)
  const [feitos, setFeitos] = useState<Record<string, boolean>>({})
  const [erros, setErros] = useState<Record<string, string>>({})

  function carregar() {
    setLoading(true)
    setFalhou(false)
    fetch("/api/paciente/checkins")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setItens)
      .catch(() => {
        setItens([])
        setFalhou(true)
      })
      .finally(() => setLoading(false))
  }
  useEffect(carregar, [])

  async function responder(c: Checkin, resposta: Record<string, unknown>) {
    setRespondendo(c.id)
    setErros((e) => {
      const { [c.id]: _, ...resto } = e
      return resto
    })
    try {
      const r = await fetch(`/api/paciente/checkins/${c.id}/responder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resposta }),
      })
      if (r.ok) {
        setFeitos((f) => ({ ...f, [c.id]: true }))
      } else {
        setErros((e) => ({
          ...e,
          [c.id]: "Não conseguimos enviar sua resposta agora. Verifique sua conexão e tente de novo.",
        }))
      }
    } catch {
      setErros((e) => ({
        ...e,
        [c.id]: "Não conseguimos enviar sua resposta agora. Verifique sua conexão e tente de novo.",
      }))
    } finally {
      setRespondendo(null)
    }
  }

  function nomeMedicamento(c: Checkin): string {
    try {
      return JSON.parse(c.payloadJson)?.medicamento ?? ""
    } catch {
      return ""
    }
  }

  const pendentes = itens.filter((c) => !feitos[c.id])

  return (
    <div className="space-y-5 p-5 pt-9">
      <header className="portal-rise-in">
        <p className="portal-eyebrow">Da sua psiquiatra</p>
        <h1 className="portal-display mt-2 text-[1.75rem] font-medium leading-tight text-foreground">
          Check-ins
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Perguntas rápidas — leva poucos minutos</p>
      </header>

      {loading ? (
        <div className="flex justify-center py-12 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : falhou ? (
        <PortalErroCarregar
          mensagem="Não foi possível carregar seus check-ins."
          onRetry={carregar}
        />
      ) : pendentes.length === 0 ? (
        <div className="portal-card portal-hairline flex flex-col items-center gap-3 px-6 py-14 text-center">
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-success/10 text-3xl ring-1 ring-success/15">
            🎉
          </div>
          <div>
            <p className="portal-display text-lg font-medium text-foreground">Tudo em dia</p>
            <p className="mt-1 text-sm text-muted-foreground">Nenhum check-in pendente.</p>
          </div>
        </div>
      ) : (
        <ul className="portal-rise-in portal-stagger-2 space-y-3">
          {pendentes.map((c) => (
            <li key={c.id} className="portal-card portal-hairline space-y-3 p-4">
              <div className="flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/12 text-primary">
                  <ClipboardCheck className="h-4 w-4" />
                </span>
                <p className="text-sm font-medium text-foreground">{ROTULO[c.tipo] ?? c.tipo}</p>
              </div>

              {c.tipo === "medicacao" ? (
                <>
                  {nomeMedicamento(c) && (
                    <p className="text-sm text-muted-foreground">{nomeMedicamento(c)}</p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="portal-tap rounded-lg bg-primary text-primary-foreground hover:bg-purple-dark"
                      disabled={respondendo === c.id}
                      onClick={() => responder(c, { status: "tomada" })}
                    >
                      {respondendo === c.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Tomei ✓"
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="portal-tap rounded-lg"
                      disabled={respondendo === c.id}
                      onClick={() => responder(c, { status: "esquecida" })}
                    >
                      Esqueci
                    </Button>
                  </div>
                </>
              ) : c.tipo === "humor_diario" ? (
                <Button
                  asChild
                  size="sm"
                  className="portal-tap gap-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-purple-dark"
                >
                  <Link href="/p/humor">
                    <Smile className="h-4 w-4" /> Registrar humor
                  </Link>
                </Button>
              ) : c.tipo.startsWith("questionario_") ? (
                <QuestionarioEscala
                  checkinId={c.id}
                  codigo={c.tipo.replace("questionario_", "")}
                  onConcluido={(id) => setFeitos((f) => ({ ...f, [id]: true }))}
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  Responda este check-in com sua psiquiatra na próxima consulta.
                </p>
              )}

              {erros[c.id] && <p className="text-sm text-destructive">{erros[c.id]}</p>}
            </li>
          ))}
        </ul>
      )}

      {Object.keys(feitos).length > 0 && (
        <p className="flex items-center justify-center gap-1.5 text-sm text-success">
          <Check className="h-4 w-4" /> Respostas enviadas
        </p>
      )}
    </div>
  )
}
