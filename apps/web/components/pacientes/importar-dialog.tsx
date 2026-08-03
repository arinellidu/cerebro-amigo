"use client"

import { useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Upload,
  FileSpreadsheet,
  Download,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Loader2,
  AlertTriangle,
} from "lucide-react"
import {
  parsePlanilha,
  validarLinha,
  baixarModelo,
  type LinhaValidada,
} from "@/lib/pacientes-xlsx"

type Etapa = "selecionar" | "preview" | "enviando" | "relatorio"

interface ResultadoServidor {
  linha: number
  status: "criado" | "pulado_duplicado" | "erro"
  motivo?: string | null
}

interface LinhaRelatorio {
  linha: number
  nome: string
  email: string
  status: "criado" | "pulado_duplicado" | "erro"
  motivo?: string | null
}

function StatusBadge({ status }: { status: LinhaRelatorio["status"] }) {
  const map = {
    criado: { cls: "bg-success/10 text-success", Icon: CheckCircle2, txt: "Criado" },
    pulado_duplicado: { cls: "bg-warning/10 text-warning", Icon: MinusCircle, txt: "Pulado (duplicado)" },
    erro: { cls: "bg-destructive/10 text-destructive", Icon: XCircle, txt: "Erro" },
  }[status]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${map.cls}`}>
      <map.Icon className="h-3 w-3" />
      {map.txt}
    </span>
  )
}

export function ImportarDialog({ onConcluido }: { onConcluido: () => void }) {
  const [aberto, setAberto] = useState(false)
  const [etapa, setEtapa] = useState<Etapa>("selecionar")
  const [linhas, setLinhas] = useState<LinhaValidada[]>([])
  const [relatorio, setRelatorio] = useState<LinhaRelatorio[]>([])
  const [erroGeral, setErroGeral] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const validas = linhas.filter((l) => l.valida)
  const invalidas = linhas.filter((l) => !l.valida)
  const resumo = {
    criados: relatorio.filter((r) => r.status === "criado").length,
    pulados: relatorio.filter((r) => r.status === "pulado_duplicado").length,
    erros: relatorio.filter((r) => r.status === "erro").length,
  }

  function reset() {
    setEtapa("selecionar")
    setLinhas([])
    setRelatorio([])
    setErroGeral(null)
    if (inputRef.current) inputRef.current.value = ""
  }

  async function aoSelecionar(file: File) {
    setErroGeral(null)
    try {
      const brutas = await parsePlanilha(file)
      if (brutas.length === 0) {
        setErroGeral("A planilha está vazia ou sem a aba esperada.")
        return
      }
      const validadas: LinhaValidada[] = brutas.map((l, i) => {
        const { valida, erros } = validarLinha(l)
        return { ...l, linha: i + 1, valida, erros }
      })
      setLinhas(validadas)
      setEtapa("preview")
    } catch {
      setErroGeral("Não foi possível ler o arquivo. Use o modelo .xlsx.")
    }
  }

  async function confirmar() {
    setEtapa("enviando")
    setErroGeral(null)
    try {
      const payload = {
        pacientes: validas.map((l) => ({
          nome: l.nome,
          email: l.email,
          waId: l.whatsapp,
          cpf: l.cpf ?? null,
          dataNascimento: l.dataNascimento ?? null,
        })),
      }
      const resp = await fetch("/api/pacientes/importar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!resp.ok) throw new Error(String(resp.status))
      const data = (await resp.json()) as { resultados: ResultadoServidor[] }

      // Junta erros pegos no cliente (não enviados) com o retorno do servidor,
      // remapeando o índice do servidor para a linha original da planilha.
      const doServidor: LinhaRelatorio[] = data.resultados.map((r) => {
        const orig = validas[r.linha - 1]
        return {
          linha: orig?.linha ?? r.linha,
          nome: orig?.nome ?? "",
          email: orig?.email ?? "",
          status: r.status,
          motivo: r.motivo,
        }
      })
      const doCliente: LinhaRelatorio[] = invalidas.map((l) => ({
        linha: l.linha,
        nome: l.nome,
        email: l.email,
        status: "erro",
        motivo: l.erros.join(", "),
      }))

      setRelatorio([...doCliente, ...doServidor].sort((a, b) => a.linha - b.linha))
      setEtapa("relatorio")
      onConcluido()
    } catch {
      setErroGeral("Falha ao importar. Tente novamente.")
      setEtapa("preview")
    }
  }

  return (
    <Dialog
      open={aberto}
      onOpenChange={(o) => {
        setAberto(o)
        if (!o) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Upload className="h-4 w-4" />
          Importar
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-foreground">Importar pacientes</DialogTitle>
          <DialogDescription>
            Envie uma planilha .xlsx (colunas: nome, email, whatsapp, cpf, data_nascimento).
            Cada paciente é criado em <strong>convite pendente</strong> — sem senha e sem e-mail.
          </DialogDescription>
        </DialogHeader>

        {erroGeral && (
          <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {erroGeral}
          </div>
        )}

        {/* ── Selecionar arquivo ── */}
        {etapa === "selecionar" && (
          <div className="space-y-4 py-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex w-full flex-col items-center gap-3 rounded-xl border-2 border-dashed border-border bg-muted/30 px-6 py-10 text-center transition-colors hover:border-primary/40 hover:bg-secondary/40"
            >
              <FileSpreadsheet className="h-10 w-10 text-primary" />
              <span className="text-sm font-medium text-foreground">Clique para escolher a planilha .xlsx</span>
              <span className="text-xs text-muted-foreground">Os dados são validados antes de enviar.</span>
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) aoSelecionar(f)
              }}
            />
            <div className="flex justify-center">
              <Button variant="ghost" size="sm" className="gap-2 text-primary" onClick={baixarModelo}>
                <Download className="h-4 w-4" />
                Baixar modelo
              </Button>
            </div>
          </div>
        )}

        {/* ── Preview com validação por linha ── */}
        {etapa === "preview" && (
          <div className="space-y-3">
            <div className="flex items-center gap-4 text-sm">
              <span className="flex items-center gap-1.5 text-success">
                <CheckCircle2 className="h-4 w-4" />
                {validas.length} válidas
              </span>
              {invalidas.length > 0 && (
                <span className="flex items-center gap-1.5 text-destructive">
                  <XCircle className="h-4 w-4" />
                  {invalidas.length} com erro (não serão enviadas)
                </span>
              )}
            </div>
            <ScrollArea className="h-72 rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/80 text-left text-xs text-muted-foreground backdrop-blur">
                  <tr>
                    <th className="px-3 py-2 font-medium">#</th>
                    <th className="px-3 py-2 font-medium">Nome</th>
                    <th className="px-3 py-2 font-medium">E-mail</th>
                    <th className="px-3 py-2 font-medium">WhatsApp</th>
                    <th className="px-3 py-2 font-medium">Validação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {linhas.map((l) => (
                    <tr key={l.linha} className={l.valida ? "" : "bg-destructive/5"}>
                      <td className="px-3 py-2 text-muted-foreground">{l.linha}</td>
                      <td className="px-3 py-2 text-foreground">{l.nome || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{l.email || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{l.whatsapp || "—"}</td>
                      <td className="px-3 py-2">
                        {l.valida ? (
                          <span className="inline-flex items-center gap-1 text-success">
                            <CheckCircle2 className="h-3.5 w-3.5" /> ok
                          </span>
                        ) : (
                          <span className="text-destructive">{l.erros.join(", ")}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="outline" onClick={reset}>
                Trocar arquivo
              </Button>
              <Button
                className="bg-primary hover:bg-purple-dark text-primary-foreground"
                disabled={validas.length === 0}
                onClick={confirmar}
              >
                Confirmar importação ({validas.length})
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* ── Enviando ── */}
        {etapa === "enviando" && (
          <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm">Importando {validas.length} pacientes…</p>
          </div>
        )}

        {/* ── Relatório ── */}
        {etapa === "relatorio" && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg bg-success/10 p-3 text-center">
                <p className="text-2xl font-bold text-success">{resumo.criados}</p>
                <p className="text-xs text-muted-foreground">criados</p>
              </div>
              <div className="rounded-lg bg-warning/10 p-3 text-center">
                <p className="text-2xl font-bold text-warning">{resumo.pulados}</p>
                <p className="text-xs text-muted-foreground">pulados</p>
              </div>
              <div className="rounded-lg bg-destructive/10 p-3 text-center">
                <p className="text-2xl font-bold text-destructive">{resumo.erros}</p>
                <p className="text-xs text-muted-foreground">erros</p>
              </div>
            </div>
            <ScrollArea className="h-64 rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/80 text-left text-xs text-muted-foreground backdrop-blur">
                  <tr>
                    <th className="px-3 py-2 font-medium">#</th>
                    <th className="px-3 py-2 font-medium">Paciente</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Motivo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {relatorio.map((r) => (
                    <tr key={r.linha}>
                      <td className="px-3 py-2 text-muted-foreground">{r.linha}</td>
                      <td className="px-3 py-2">
                        <span className="text-foreground">{r.nome || "—"}</span>
                        <span className="block text-xs text-muted-foreground">{r.email}</span>
                      </td>
                      <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{r.motivo ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
            <DialogFooter>
              <Button
                className="bg-primary hover:bg-purple-dark text-primary-foreground"
                onClick={() => setAberto(false)}
              >
                Concluir
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
