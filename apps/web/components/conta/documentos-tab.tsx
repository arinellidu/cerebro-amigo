"use client"

// ADR-066 — aba "Documentos" do hub Minha conta. Cofre bidirecional:
// médico ENVIA (entra pendente de revisão) e BAIXA o que a plataforma
// DISPONIBILIZA. Upload/download direto no S3 via presigned URL — o binário
// nunca passa pelo BFF nem pelo gateway.

import { useCallback, useEffect, useRef, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Loader2, Upload, Download, Trash2, FileText, CheckCircle2, Clock, XCircle, Inbox,
} from "lucide-react"

interface Doc {
  id: string; direcao: string; tipo: string; titulo: string; status: string
  contentType?: string | null; tamanhoBytes?: number | null; criadoEm: string; observacoes?: string | null
}

const MIME_OK = ["application/pdf", "image/jpeg", "image/png"]
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

const TIPO_LABEL: Record<string, string> = {
  contrato: "Contrato", comprovante: "Comprovante", diploma: "Diploma",
  rg_cpf: "RG / CPF", nfse: "NFS-e", recibo: "Recibo", outro: "Outro",
}
const TIPOS_ENVIO = ["contrato", "comprovante", "diploma", "rg_cpf", "outro"]

const STATUS: Record<string, { label: string; cls: string; icon: typeof Clock }> = {
  pendente: { label: "Em análise", cls: "bg-warning/15 text-warning border-warning/30", icon: Clock },
  aprovado: { label: "Aprovado", cls: "bg-success/15 text-success border-success/30", icon: CheckCircle2 },
  rejeitado: { label: "Rejeitado", cls: "bg-destructive/15 text-destructive border-destructive/30", icon: XCircle },
  disponivel: { label: "Disponível", cls: "bg-primary/10 text-primary border-primary/30", icon: CheckCircle2 },
}

const fmtBytes = (b?: number | null) =>
  !b ? "" : b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`

export function DocumentosTab() {
  const [docs, setDocs] = useState<Doc[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [tipo, setTipo] = useState("contrato")
  const [titulo, setTitulo] = useState("")
  const [enviando, setEnviando] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/api/conta/documentos")
      if (!r.ok) { setErro("Não foi possível carregar seus documentos."); return }
      setDocs(await r.json())
    } catch { setErro("Erro de conexão.") }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  async function enviar() {
    setErro(null)
    const file = fileRef.current?.files?.[0]
    if (!file) { setErro("Escolha um arquivo."); return }
    if (!titulo.trim()) { setErro("Dê um título ao documento."); return }
    if (!MIME_OK.includes(file.type)) { setErro("Formato inválido. Use PDF, JPG ou PNG."); return }
    if (file.size > MAX_BYTES) { setErro("Arquivo grande demais (máx. 10 MB)."); return }

    setEnviando(true)
    try {
      // 1) pede URL de upload presigned
      const ur = await fetch("/api/conta/documentos/upload-url", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo, titulo: titulo.trim(), contentType: file.type }),
      })
      const u = await ur.json().catch(() => null)
      if (!ur.ok || !u?.uploadUrl) { setErro("Não foi possível iniciar o envio."); return }

      // 2) sobe o binário direto no Azure Blob via SAS (x-ms-blob-type obrigatório)
      const put = await fetch(u.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type, "x-ms-blob-type": "BlockBlob" },
        body: file,
      })
      if (!put.ok) { setErro("Falha no upload do arquivo."); return }

      // 3) registra o metadado
      const rr = await fetch("/api/conta/documentos", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ s3Key: u.s3Key, tipo, titulo: titulo.trim(), contentType: file.type, tamanhoBytes: file.size }),
      })
      if (!rr.ok) { setErro("Arquivo enviado, mas falhou ao registrar. Tente de novo."); return }

      setTitulo(""); if (fileRef.current) fileRef.current.value = ""
      await carregar()
    } catch { setErro("Erro de conexão no envio.") }
    finally { setEnviando(false) }
  }

  async function baixar(id: string) {
    try {
      const r = await fetch(`/api/conta/documentos/${id}/download-url`)
      const d = await r.json().catch(() => null)
      if (r.ok && d?.downloadUrl) window.open(d.downloadUrl, "_blank", "noreferrer")
      else setErro("Não foi possível gerar o link de download.")
    } catch { setErro("Erro de conexão.") }
  }

  async function remover(id: string) {
    try {
      const r = await fetch(`/api/conta/documentos/${id}`, { method: "DELETE" })
      if (r.ok || r.status === 204) await carregar()
      else setErro("Não foi possível remover o documento.")
    } catch { setErro("Erro de conexão.") }
  }

  const enviados = docs?.filter((d) => d.direcao === "enviado") ?? []
  const recebidos = docs?.filter((d) => d.direcao === "disponibilizado") ?? []

  return (
    <div className="space-y-4">
      {/* Upload */}
      <Card>
        <CardContent className="p-6 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Enviar documento</h3>
            <p className="text-xs text-muted-foreground">PDF, JPG ou PNG até 10 MB. Entra em análise pela equipe.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-sm">Tipo</Label>
              <Select value={tipo} onValueChange={setTipo}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIPOS_ENVIO.map((t) => <SelectItem key={t} value={t}>{TIPO_LABEL[t]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Título</Label>
              <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Contrato assinado" maxLength={120} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Arquivo</Label>
              <Input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="coral" className="gap-2" disabled={enviando} onClick={enviar}>
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Enviar
            </Button>
            {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
          </div>
        </CardContent>
      </Card>

      {/* Disponibilizados pela plataforma */}
      <Card>
        <CardContent className="p-0">
          <div className="px-6 py-4 border-b border-border"><h3 className="text-sm font-semibold text-foreground">Da plataforma para você</h3></div>
          {docs === null ? (
            <div className="flex justify-center py-8 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : recebidos.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground"><Inbox className="mx-auto mb-2 h-5 w-5 opacity-50" />Nada disponibilizado ainda (contratos, NFS-e, recibos aparecem aqui).</p>
          ) : (
            <ul className="divide-y divide-border">
              {recebidos.map((d) => <Row key={d.id} d={d} onDownload={() => baixar(d.id)} />)}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Enviados por mim */}
      <Card>
        <CardContent className="p-0">
          <div className="px-6 py-4 border-b border-border"><h3 className="text-sm font-semibold text-foreground">Enviados por você</h3></div>
          {docs === null ? (
            <div className="flex justify-center py-8 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : enviados.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">Você ainda não enviou documentos.</p>
          ) : (
            <ul className="divide-y divide-border">
              {enviados.map((d) => <Row key={d.id} d={d} onDownload={() => baixar(d.id)} onDelete={() => remover(d.id)} />)}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Row({ d, onDownload, onDelete }: { d: Doc; onDownload: () => void; onDelete?: () => void }) {
  const st = STATUS[d.status] ?? { label: d.status, cls: "bg-muted text-muted-foreground border-border", icon: Clock }
  const Icon = st.icon
  return (
    <li className="flex items-center gap-3 px-6 py-3">
      <FileText className="h-5 w-5 flex-shrink-0 text-muted-foreground/60" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{d.titulo}</p>
        <p className="text-xs text-muted-foreground">
          {TIPO_LABEL[d.tipo] ?? d.tipo} · {new Date(d.criadoEm).toLocaleDateString("pt-BR")}{d.tamanhoBytes ? ` · ${fmtBytes(d.tamanhoBytes)}` : ""}
          {d.status === "rejeitado" && d.observacoes ? ` · ${d.observacoes}` : ""}
        </p>
      </div>
      <Badge className={`border font-mono text-[10px] uppercase gap-1 ${st.cls}`}><Icon className="h-3 w-3" />{st.label}</Badge>
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onDownload} aria-label="Baixar"><Download className="h-4 w-4" /></Button>
      {onDelete && (
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={onDelete} aria-label="Remover"><Trash2 className="h-4 w-4" /></Button>
      )}
    </li>
  )
}
