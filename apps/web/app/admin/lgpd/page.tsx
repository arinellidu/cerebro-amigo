"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Scale, RefreshCw, Loader2, Plus, Check, X } from "lucide-react"
import { ErroCarregar } from "@/components/admin/erro-carregar"
import { toast } from "sonner"

interface Solicitacao {
  id: string
  identificacao: string
  tipo: string
  status: string
  notas: string | null
  criadoEm: string
  atendidoEm: string | null
  criadoPorNome: string | null
  atendidoPorNome: string | null
  pacienteNome: string | null
}

const TIPO_LABEL: Record<string, string> = {
  acesso: "Acesso",
  portabilidade: "Portabilidade",
  eliminacao: "Eliminação",
  oposicao_ia: "Oposição ao tratamento por IA",
  correcao: "Correção",
}
const STATUS_COR: Record<string, string> = {
  aberta: "bg-warning/15 text-warning border-warning/30",
  atendida: "bg-success/15 text-success border-success/30",
  recusada: "bg-muted/50 text-muted-foreground border-border",
}
const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "—")

export default function LgpdPage() {
  const [itens, setItens] = useState<Solicitacao[]>([])
  const [abertas, setAbertas] = useState(0)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [filtro, setFiltro] = useState("todas")

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null)
    try {
      const qs = filtro === "todas" ? "" : `?status=${filtro}`
      const r = await fetch(`/api/admin/solicitacoes${qs}`)
      if (r.status === 401) { window.location.href = "/login"; return }
      if (!r.ok) { setErro("Não foi possível carregar as solicitações."); return }
      const d = await r.json()
      setItens(d.itens ?? []); setAbertas(d.abertas ?? 0)
    } catch {
      setErro("Erro de conexão ao carregar as solicitações.")
    } finally {
      setLoading(false)
    }
  }, [filtro])

  useEffect(() => { carregar() }, [carregar])

  async function resolver(id: string, status: "atendida" | "recusada") {
    const r = await fetch(`/api/admin/solicitacoes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    })
    if (r.ok) { toast.success(`Solicitação marcada como ${status}.`); carregar() }
    else toast.error("Não foi possível atualizar a solicitação.")
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Scale className="h-5 w-5 text-accent" />
            <p className="font-mono text-xs uppercase tracking-widest text-accent">LGPD</p>
          </div>
          <h1 className="text-2xl font-semibold text-foreground">Direitos do titular</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Registro e acompanhamento das solicitações (art. 18)</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="glass" size="sm" onClick={carregar} disabled={loading} className="gap-1.5">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Atualizar
          </Button>
          <NovaSolicitacaoDialog onCriada={carregar} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Badge className="border border-warning/30 bg-warning/15 text-warning">{abertas} aberta(s)</Badge>
        <Select value={filtro} onValueChange={setFiltro}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {["todas", "aberta", "atendida", "recusada"].map((s) => (
              <SelectItem key={s} value={s}>{s === "todas" ? "Todos os status" : s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : erro ? (
        <ErroCarregar mensagem={erro} onRetry={carregar} />
      ) : itens.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-noir-line bg-noir-surface p-16 text-center text-sm text-muted-foreground">
          Nenhuma solicitação registrada.
        </div>
      ) : (
        <div className="rounded-2xl border border-noir-line bg-noir-surface overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-noir-line bg-noir-surface-raised">
                {["Titular", "Tipo", "Status", "Registrada", "Por", "Ações"].map((h) => (
                  <th key={h} className="px-5 py-3 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-noir-line">
              {itens.map((s) => (
                <tr key={s.id} className="hover:bg-noir-surface-raised/40 transition-colors">
                  <td className="px-5 py-3">
                    <div className="text-foreground">{s.identificacao}</div>
                    {s.pacienteNome && <div className="text-[11px] text-muted-foreground">paciente: {s.pacienteNome}</div>}
                    {s.notas && <div className="mt-0.5 line-clamp-1 max-w-xs text-[11px] text-muted-foreground/70">{s.notas}</div>}
                  </td>
                  <td className="px-5 py-3 text-foreground">{TIPO_LABEL[s.tipo] ?? s.tipo}</td>
                  <td className="px-5 py-3">
                    <Badge className={`border font-mono text-[10px] uppercase ${STATUS_COR[s.status] ?? ""}`}>{s.status}</Badge>
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{quando(s.criadoEm)}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{s.criadoPorNome ?? "—"}</td>
                  <td className="px-5 py-3">
                    {s.status === "aberta" ? (
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-success hover:text-success" onClick={() => resolver(s.id, "atendida")}>
                          <Check className="h-3.5 w-3.5" /> Atender
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-muted-foreground hover:text-destructive" onClick={() => resolver(s.id, "recusada")}>
                          <X className="h-3.5 w-3.5" /> Recusar
                        </Button>
                      </div>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">{s.atendidoPorNome ?? "—"} · {quando(s.atendidoEm)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground/70">
        Este console registra e acompanha as solicitações. A execução (export, eliminação, oposição) é feita à parte, com cuidado — o registro é evidência de conformidade e não pode ser apagado.
      </p>
    </div>
  )
}

function NovaSolicitacaoDialog({ onCriada }: { onCriada: () => void }) {
  const [open, setOpen] = useState(false)
  const [identificacao, setIdentificacao] = useState("")
  const [tipo, setTipo] = useState("acesso")
  const [notas, setNotas] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function salvar() {
    setErro(null)
    if (identificacao.trim().length < 2) return setErro("Informe a identificação do titular (e-mail ou nome).")
    setEnviando(true)
    try {
      const r = await fetch("/api/admin/solicitacoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identificacao: identificacao.trim(), tipo, notas: notas.trim() || null }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => null)
        const msg = d?.error || "Erro ao registrar."
        setErro(msg); toast.error(msg)
        return
      }
      toast.success("Solicitação registrada.")
      setIdentificacao(""); setNotas(""); setTipo("acesso"); setOpen(false); onCriada()
    } catch {
      setErro("Erro de conexão."); toast.error("Erro de conexão.")
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setErro(null) }}>
      <DialogTrigger asChild>
        <Button variant="coral" size="sm" className="gap-1.5"><Plus className="h-4 w-4" /> Nova solicitação</Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Nova solicitação de titular</DialogTitle>
          <DialogDescription>Registre um pedido de direito do titular (LGPD art. 18).</DialogDescription>
        </DialogHeader>
        {erro && <p className="text-sm text-destructive">{erro}</p>}
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Identificação do titular</Label>
            <Input value={identificacao} onChange={(e) => setIdentificacao(e.target.value)} placeholder="e-mail ou nome informado" />
          </div>
          <div className="space-y-1.5">
            <Label>Tipo de direito</Label>
            <Select value={tipo} onValueChange={setTipo}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(TIPO_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Notas (opcional)</Label>
            <Input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="contexto / canal do pedido" />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button variant="coral" onClick={salvar} disabled={enviando}>
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Registrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
