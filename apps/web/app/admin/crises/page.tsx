"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  ShieldAlert, RefreshCw, Loader2, BellOff, Timer, PauseCircle, CheckCircle2,
} from "lucide-react"
import { ErroCarregar } from "@/components/admin/erro-carregar"

interface CriseEvento {
  id: string
  criadoEm: string
  medicoNome: string | null
  origem: string
  gatilho: string
  confianca: number
  medicoNotificado: boolean
  medicoNotificadoEm: string | null
  automacaoPausada: boolean
}
interface Crises {
  total30d: number
  semNotificacao: number
  slaMedioSegundos: number | null
  automacaoPausada: number
  eventos: CriseEvento[]
}

const ORIGEM_LABEL: Record<string, string> = {
  conversa: "Conversa",
  diario_audio: "Diário (áudio)",
  diario_texto: "Diário (texto)",
}

function duracao(seg: number | null): string {
  if (seg == null) return "—"
  if (seg < 60) return `${Math.round(seg)}s`
  if (seg < 3600) return `${Math.round(seg / 60)}min`
  return `${(seg / 3600).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}h`
}
function quando(iso: string | null) {
  return iso ? new Date(iso).toLocaleString("pt-BR") : "—"
}
function sla(ev: CriseEvento): string {
  if (!ev.medicoNotificado || !ev.medicoNotificadoEm) return "—"
  const s = (new Date(ev.medicoNotificadoEm).getTime() - new Date(ev.criadoEm).getTime()) / 1000
  return duracao(s)
}

export default function CrisesPage() {
  const [c, setC] = useState<Crises | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null)
    try {
      const r = await fetch("/api/admin/crises")
      if (r.status === 401) { window.location.href = "/login"; return }
      if (!r.ok) { setErro("Não foi possível carregar a supervisão de crise."); return }
      setC(await r.json())
    } catch {
      setErro("Erro de conexão ao carregar a supervisão de crise.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ShieldAlert className="h-5 w-5 text-destructive" />
            <p className="font-mono text-xs uppercase tracking-widest text-destructive">Segurança clínica</p>
          </div>
          <h1 className="text-2xl font-semibold text-foreground">Supervisão de crise</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Trilha imutável, somente leitura · últimos 30 dias · sem conteúdo clínico
          </p>
        </div>
        <Button variant="glass" size="sm" onClick={carregar} disabled={loading} className="gap-1.5">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Atualizar
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : erro || !c ? (
        <ErroCarregar mensagem={erro ?? "Não foi possível carregar."} onRetry={carregar} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Crises (30d)", value: String(c.total30d), icon: ShieldAlert, cls: "text-foreground" },
              { label: "Sem médico notificado", value: String(c.semNotificacao), icon: BellOff, cls: c.semNotificacao > 0 ? "text-destructive" : "text-success" },
              { label: "SLA médio até notificar", value: duracao(c.slaMedioSegundos), icon: Timer, cls: "text-warning" },
              { label: "Automação pausada", value: String(c.automacaoPausada), icon: PauseCircle, cls: "text-primary" },
            ].map((k) => (
              <div key={k.label} className="rounded-2xl border border-noir-line bg-noir-surface p-5">
                <div className="flex items-center justify-between mb-3">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{k.label}</p>
                  <k.icon className={`h-4 w-4 ${k.cls}`} />
                </div>
                <p className="text-2xl font-bold text-foreground">{k.value}</p>
              </div>
            ))}
          </div>

          {c.eventos.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-noir-line bg-noir-surface p-16 text-center text-sm text-muted-foreground">
              Nenhuma crise acionada nos últimos 30 dias.
            </div>
          ) : (
            <div className="rounded-2xl border border-noir-line bg-noir-surface overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-noir-line bg-noir-surface-raised">
                    {["Quando", "Médico", "Origem", "Gatilho", "Conf.", "Notificado", "SLA", "Automação"].map((h) => (
                      <th key={h} className="px-4 py-2.5 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-noir-line">
                  {c.eventos.map((ev) => (
                    <tr key={ev.id} className="hover:bg-noir-surface-raised/40 transition-colors">
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{quando(ev.criadoEm)}</td>
                      <td className="px-4 py-2.5 text-foreground">{ev.medicoNome ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        <Badge className="border border-noir-line bg-noir-surface-raised font-mono text-[10px] text-muted-foreground">
                          {ORIGEM_LABEL[ev.origem] ?? ev.origem}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-foreground">{ev.gatilho}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{Math.round((ev.confianca ?? 0) * 100)}%</td>
                      <td className="px-4 py-2.5">
                        {ev.medicoNotificado ? (
                          <span className="inline-flex items-center gap-1 text-xs text-success"><CheckCircle2 className="h-3.5 w-3.5" /> sim</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-destructive"><BellOff className="h-3.5 w-3.5" /> não</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{sla(ev)}</td>
                      <td className="px-4 py-2.5">
                        {ev.automacaoPausada
                          ? <span className="text-xs text-primary">pausada</span>
                          : <span className="text-xs text-muted-foreground">ativa</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
            <ShieldAlert className="h-3 w-3" /> Somente metadados de governança — gatilho é categoria do classificador, nunca trecho do paciente (LGPD / clinical-safety). Trilha append-only: nada é editável aqui.
          </p>
        </>
      )}
    </div>
  )
}
