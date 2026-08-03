"use client"

// Medicações EM USO (reconciliação, ADR-062). Registro do que o paciente JÁ toma — de
// qualquer prescritor. NÃO é receita (prescrição legal = MEMED). A IA não preenche nem
// sugere: o médico digita/escolhe. Alimenta a checagem de interações A5 no gateway.

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { baixarCsv } from "@/lib/csv"
import { MedicamentoPickerClasse } from "@/components/medicamentos/picker-classe"
import { Pill, Plus, X, Loader2, Search, Info, Printer, FileSpreadsheet, Download } from "lucide-react"

interface MedicacaoEmUso {
  id: string
  medicamento: string
  generico: string | null
  classe: string | null
  posologia: string | null
  fonte: string | null
  observacoes: string | null
  criadoEm: string
}
interface CatalogoItem {
  id: string
  nomeGenerico: string
  classeTerapeutica: string
  indicacoesResumo: string | null
}

// Escapa string ao injetar no HTML do documento de impressão (dado do médico, mas
// nunca confiar em conteúdo livre ao montar markup).
function escHtml(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  )
}
// Slug simples p/ nome de arquivo (sem acento, só alfanumérico).
function slug(s: string) {
  return (
    s
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "paciente"
  )
}

export function MedicacoesEmUso({ pacienteId }: { pacienteId: string }) {
  const [lista, setLista] = useState<MedicacaoEmUso[]>([])
  const [loading, setLoading] = useState(true)
  const [aberto, setAberto] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // form
  const [nome, setNome] = useState("")
  const [generico, setGenerico] = useState<string | null>(null)
  const [classe, setClasse] = useState<string | null>(null)
  const [posologia, setPosologia] = useState("")
  const [fonte, setFonte] = useState("")

  // catálogo (busca)
  const [sugestoes, setSugestoes] = useState<CatalogoItem[]>([])
  const buscaTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const carregar = () => {
    setLoading(true)
    fetch(`/api/pacientes/${pacienteId}/medicacoes-em-uso`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setLista(Array.isArray(rows) ? rows : []))
      .catch(() => setLista([]))
      .finally(() => setLoading(false))
  }
  useEffect(() => { carregar() /* eslint-disable-next-line */ }, [pacienteId])

  // busca no catálogo (debounce). O nome digitado também vale como texto livre.
  function onNome(v: string) {
    setNome(v); setGenerico(null); setClasse(null)
    if (buscaTimer.current) clearTimeout(buscaTimer.current)
    const termo = v.trim()
    if (termo.length < 2) { setSugestoes([]); return }
    buscaTimer.current = setTimeout(() => {
      fetch(`/api/medicamentos?q=${encodeURIComponent(termo)}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((rows) => setSugestoes(Array.isArray(rows) ? rows.slice(0, 8) : []))
        .catch(() => setSugestoes([]))
    }, 250)
  }
  function escolher(c: CatalogoItem) {
    setNome(c.nomeGenerico); setGenerico(c.nomeGenerico); setClasse(c.classeTerapeutica)
    setSugestoes([])
  }

  function resetForm() {
    setNome(""); setGenerico(null); setClasse(null); setPosologia(""); setFonte("")
    setSugestoes([]); setErro(null)
  }

  async function registrar() {
    // Snapshot síncrono antes de qualquer await — evita closure stale com state do React.
    const snap = {
      medicamento: nome.trim(),
      generico,
      classe,
      posologia: posologia.trim() || null,
      fonte: fonte.trim() || null,
    }
    if (!snap.medicamento) { setErro("Informe o nome do medicamento."); return }
    setSalvando(true); setErro(null)
    try {
      const r = await fetch(`/api/pacientes/${pacienteId}/medicacoes-em-uso`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snap),
      })
      if (!r.ok) { setErro("Não foi possível registrar agora. Tente novamente."); return }
      const { id: novaId } = await r.json() as { id: string }
      setLista((prev) => [...prev, {
        id: novaId, ...snap, observacoes: null, criadoEm: new Date().toISOString(),
      }])
      resetForm(); setAberto(false)
    } catch {
      setErro("Erro de conexão.")
    } finally {
      setSalvando(false)
    }
  }

  async function remover(id: string) {
    const anterior = lista
    setLista((prev) => prev.filter((m) => m.id !== id)) // otimista
    try {
      const r = await fetch(`/api/medicacoes-em-uso/${id}/remover`, { method: "POST" })
      if (!r.ok) setLista(anterior)
    } catch { setLista(anterior) }
  }

  // Nome do paciente p/ cabeçalho do export (fetch lazy; só ao exportar). Fallback "—".
  async function buscarNomePaciente(): Promise<string> {
    try {
      const r = await fetch(`/api/pacientes/${pacienteId}`)
      if (!r.ok) return "—"
      const p = await r.json()
      return typeof p?.nome === "string" && p.nome.trim() ? p.nome.trim() : "—"
    } catch {
      return "—"
    }
  }

  // Exporta a lista atual como CSV (abre no Excel PT-BR com acentos/colunas corretos).
  async function exportarCsv() {
    if (lista.length === 0) return
    const nomePaciente = await buscarNomePaciente()
    baixarCsv(
      `medicacoes-em-uso-${slug(nomePaciente)}.csv`,
      ["Medicamento", "Classe", "Posologia", "Fonte", "Observações", "Registrado em"],
      lista.map((m) => [
        m.medicamento,
        m.classe ?? "",
        m.posologia ?? "",
        m.fonte ?? "",
        m.observacoes ?? "",
        new Date(m.criadoEm).toLocaleDateString("pt-BR"),
      ]),
    )
  }

  // Abre um documento limpo em nova janela e chama print() — o médico imprime ou salva
  // como PDF. NÃO é receita (registro de reconciliação, ADR-062).
  async function imprimir() {
    if (lista.length === 0) return
    // Abrir a janela ANTES do await preserva o gesto do clique (evita bloqueio de popup).
    const win = window.open("", "_blank", "width=820,height=640")
    if (!win) return
    win.document.write(
      "<!doctype html><meta charset='utf-8'><title>Gerando…</title>" +
        "<p style='font-family:system-ui,sans-serif;margin:32px'>Gerando documento…</p>",
    )
    const nomePaciente = await buscarNomePaciente()
    const hoje = new Date().toLocaleDateString("pt-BR")
    const linhas = lista
      .map(
        (m) => `<tr>
          <td>${escHtml(m.medicamento)}</td>
          <td>${escHtml(m.classe ?? "—")}</td>
          <td>${escHtml(m.posologia ?? "—")}</td>
          <td>${escHtml(m.fonte ?? "—")}</td>
        </tr>`,
      )
      .join("")
    win.document.open()
    win.document.write(
      `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" />
        <title>Medicações em uso — ${escHtml(nomePaciente)}</title>
        <style>
          body{font-family:system-ui,-apple-system,Arial,sans-serif;color:#111;margin:32px}
          h1{font-size:18px;margin:0 0 4px}
          .sub{color:#555;font-size:12px;margin:0 0 18px}
          table{width:100%;border-collapse:collapse;font-size:13px}
          th,td{text-align:left;border-bottom:1px solid #ddd;padding:8px 6px;vertical-align:top}
          th{background:#f4f4f5;font-weight:600}
          .foot{margin-top:24px;color:#777;font-size:11px;line-height:1.4}
          @media print{body{margin:14mm}}
        </style></head><body>
        <h1>Medicações em uso</h1>
        <p class="sub">Paciente: ${escHtml(nomePaciente)} · Emitido em ${hoje}</p>
        <table><thead><tr><th>Medicamento</th><th>Classe</th><th>Posologia</th><th>Fonte</th></tr></thead>
        <tbody>${linhas}</tbody></table>
        <p class="foot">Registro do que o paciente já toma (qualquer prescritor). <strong>Não é receita médica.</strong> Documento gerado pelo Cérebro Amigo.</p>
        </body></html>`,
    )
    win.document.close()
    win.focus()
    win.print()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 shrink-0" />
          Registro do que o paciente já toma (qualquer prescritor). Também listado na aba <strong>Prescrições</strong>.
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="gap-1.5" disabled={lista.length === 0}>
                <Download className="h-4 w-4" /> Exportar
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => void imprimir()}>
                <Printer className="mr-2 h-4 w-4" /> Imprimir / PDF
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void exportarCsv()}>
                <FileSpreadsheet className="mr-2 h-4 w-4" /> Exportar CSV (Excel)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        <Dialog open={aberto} onOpenChange={(o) => { setAberto(o); if (!o) resetForm() }}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5"><Plus className="h-4 w-4" /> Adicionar</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Registrar medicação em uso</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Medicamento</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={nome} onChange={(e) => onNome(e.target.value)}
                    placeholder="Busque no catálogo ou digite livremente" className="pl-9" autoComplete="off" />
                </div>
                <MedicamentoPickerClasse
                  triggerLabel="Escolher do catálogo por classe"
                  confirmarLabel="Adicionar selecionados"
                  onConfirmar={(nomes) => {
                    if (nomes.length === 0) return
                    if (nomes.length === 1) {
                      // 1 selecionado → preenche o form p/ o médico completar posologia/fonte
                      setNome(nomes[0]); setGenerico(nomes[0]); setSugestoes([])
                      fetch(`/api/medicamentos?q=${encodeURIComponent(nomes[0])}`)
                        .then((r) => (r.ok ? r.json() : []))
                        .then((rows: CatalogoItem[]) => {
                          const match = rows.find((r) => r.nomeGenerico === nomes[0])
                          if (match) setClasse(match.classeTerapeutica)
                        })
                        .catch(() => {})
                    } else {
                      // vários → adiciona todos direto (sem posologia/fonte; pode editar depois)
                      setSalvando(true); setErro(null)
                      Promise.all(
                        nomes.map((n) =>
                          fetch(`/api/pacientes/${pacienteId}/medicacoes-em-uso`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ medicamento: n, generico: n, classe: null, posologia: null, fonte: null }),
                          }).then((r) => r.ok ? r.json() as Promise<{ id: string }> : null),
                        ),
                      ).then((results) => {
                        const novos = results
                          .map((res, i) => res ? {
                            id: res.id, medicamento: nomes[i], generico: nomes[i],
                            classe: null, posologia: null, fonte: null, observacoes: null,
                            criadoEm: new Date().toISOString(),
                          } : null)
                          .filter(Boolean) as MedicacaoEmUso[]
                        setLista((prev) => [...prev, ...novos])
                        resetForm(); setAberto(false)
                      }).catch(() => setErro("Erro ao adicionar medicações em lote."))
                        .finally(() => setSalvando(false))
                    }
                  }}
                />
                {classe && <p className="text-xs text-muted-foreground">Classe: {classe}</p>}
                {sugestoes.length > 0 && (
                  <div className="rounded-lg border border-border/60 divide-y divide-border/40 max-h-48 overflow-y-auto">
                    {sugestoes.map((c) => (
                      <button key={c.id} type="button" onClick={() => escolher(c)}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50">
                        <span className="font-medium text-foreground">{c.nomeGenerico}</span>
                        <Badge variant="secondary" className="text-[10px]">{c.classeTerapeutica}</Badge>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Posologia <span className="font-normal text-muted-foreground">(como o paciente toma)</span></label>
                <Input value={posologia} onChange={(e) => setPosologia(e.target.value)} placeholder="ex.: 50mg, 1x/dia de manhã" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Fonte <span className="font-normal text-muted-foreground">(opcional)</span></label>
                <Input value={fonte} onChange={(e) => setFonte(e.target.value)} placeholder="ex.: outro psiquiatra, clínico, automedicação" />
              </div>
              {erro && <p role="alert" className="text-xs text-destructive">{erro}</p>}
            </div>
            <DialogFooter>
              <Button onClick={registrar} disabled={salvando || !nome.trim()} className="gap-2">
                {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Registrar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      ) : lista.length === 0 ? (
        <Card className="border-border/50"><CardContent className="py-8 text-center text-sm text-muted-foreground">
          Nenhuma medicação em uso registrada.
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {lista.map((m) => (
            <Card key={m.id} className="border-border/50">
              <CardContent className="flex items-start gap-3 p-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
                  <Pill className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{m.medicamento}</p>
                    {m.classe && <Badge variant="secondary" className="text-[10px]">{m.classe}</Badge>}
                  </div>
                  {m.posologia && <p className="text-xs text-muted-foreground">{m.posologia}</p>}
                  {m.fonte && <p className="text-[11px] text-muted-foreground">Fonte: {m.fonte}</p>}
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  title="Remover" aria-label="Remover" onClick={() => remover(m.id)}>
                  <X className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
