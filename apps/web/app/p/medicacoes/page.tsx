"use client"

import { useEffect, useState } from "react"
import { Clock, Check, Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PortalPageHeader } from "@/components/portal/page-header"

interface Medicacao {
  id: string
  medicamento: string
  doseDescricao: string
  horarios: string[]
  inicioEm: string
  observacoes: string | null
  fonte: string | null
  origem: string
}

interface TomadaHoje {
  prescricaoId: string
  status: string
}

function horaCurta(t: string) {
  return t.slice(0, 5)
}

export default function MedicacoesPage() {
  const [meds, setMeds] = useState<Medicacao[]>([])
  const [loading, setLoading] = useState(true)
  const [falhou, setFalhou] = useState(false)
  const [confirmando, setConfirmando] = useState<string | null>(null)
  const [feito, setFeito] = useState<Record<string, boolean>>({})
  const [erro, setErro] = useState<Record<string, boolean>>({})

  function carregar() {
    setLoading(true)
    setFalhou(false)
    Promise.all([
      fetch("/api/paciente/medicacoes").then((r) => (r.ok ? r.json() : Promise.reject())),
      fetch("/api/paciente/home").then((r) => (r.ok ? r.json() : Promise.reject())),
    ])
      .then(([lista, home]: [Medicacao[], { tomadasHoje?: TomadaHoje[] }]) => {
        setMeds(Array.isArray(lista) ? lista : [])
        const tomadas = Array.isArray(home?.tomadasHoje) ? home.tomadasHoje : []
        const confirmadas: Record<string, boolean> = {}
        for (const t of tomadas) {
          if (t.status === "tomada" && t.prescricaoId) {
            confirmadas[t.prescricaoId] = true
          }
        }
        setFeito(confirmadas)
      })
      .catch(() => {
        setMeds([])
        setFalhou(true)
      })
      .finally(() => setLoading(false))
  }

  useEffect(carregar, [])

  // Confirma a tomada de uma medicação (cria/atualiza a tomada de hoje no backend).
  async function confirmar(id: string) {
    setConfirmando(id)
    setErro((e) => ({ ...e, [id]: false }))
    try {
      const r = await fetch(`/api/paciente/medicacoes/confirmar/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "tomada" }),
      })
      if (r.ok) {
        setFeito((f) => ({ ...f, [id]: true }))
      } else {
        setErro((e) => ({ ...e, [id]: true }))
      }
    } catch {
      setErro((e) => ({ ...e, [id]: true }))
    } finally {
      setConfirmando(null)
    }
  }

  return (
    <div className="space-y-5 p-5 pt-9">
      <PortalPageHeader
        eyebrow="Sua rotina"
        titulo="Medicações"
        subtitulo="Confirme as tomadas e acompanhe sua prescrição."
      />

      {loading ? (
        <div className="flex justify-center py-12 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : falhou ? (
        <div className="portal-card space-y-3 border-destructive/30 p-6 text-center">
          <p className="text-sm text-foreground">Não foi possível carregar suas medicações.</p>
          <Button
            variant="outline"
            size="sm"
            className="portal-tap gap-2 rounded-lg"
            onClick={carregar}
          >
            <RefreshCw className="h-4 w-4" /> Tentar de novo
          </Button>
        </div>
      ) : meds.length === 0 ? (
        <div className="portal-card portal-hairline px-6 py-12 text-center text-sm text-muted-foreground">
          Nenhuma medicação ativa no momento.
        </div>
      ) : (
        <ul className="portal-rise-in portal-stagger-2 space-y-3">
          {meds.map((m) => (
            <li key={m.id} className="portal-card portal-hairline space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{m.medicamento}</p>
                  <p className="text-sm text-muted-foreground">{m.doseDescricao}</p>
                  {m.fonte && (
                    <p className="mt-0.5 text-xs text-muted-foreground">Fonte: {m.fonte}</p>
                  )}
                </div>
                {/* Só prescrições da plataforma têm tomada/check-in p/ confirmar.
                    Medicação "em uso" (reconciliação) é informativa — sem botão. */}
                {m.origem === "prescricao" ? (
                  <Button
                    size="sm"
                    variant={feito[m.id] ? "outline" : "default"}
                    className={
                      feito[m.id]
                        ? "portal-tap rounded-lg border-success/40 text-success"
                        : "portal-tap rounded-lg bg-primary text-primary-foreground hover:bg-purple-dark"
                    }
                    disabled={confirmando === m.id || feito[m.id]}
                    onClick={() => confirmar(m.id)}
                  >
                    {confirmando === m.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : feito[m.id] ? (
                      <>
                        <Check className="mr-1 h-4 w-4" /> Tomada
                      </>
                    ) : (
                      "Confirmar"
                    )}
                  </Button>
                ) : (
                  <span className="shrink-0 rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground">
                    em uso
                  </span>
                )}
              </div>
              {m.horarios?.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  {m.horarios.map((h, i) => (
                    <span
                      key={i}
                      className="nums rounded-full bg-primary/12 px-2.5 py-0.5 font-medium text-primary"
                    >
                      {horaCurta(h)}
                    </span>
                  ))}
                </div>
              )}
              {m.observacoes && <p className="text-xs text-muted-foreground">{m.observacoes}</p>}
              {erro[m.id] && (
                <p className="text-xs text-destructive">
                  Não conseguimos registrar agora. Verifique sua conexão e toque em Confirmar de
                  novo. Isso não muda sua rotina de medicação.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
