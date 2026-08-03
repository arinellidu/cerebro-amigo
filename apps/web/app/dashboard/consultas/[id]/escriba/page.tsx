"use client"

// Escriba — revisão da nota da teleconsulta (ADR-040). O médico vê o rascunho FACTUAL
// gerado pela IA (relato/temas/medicações mencionadas — SEM diagnóstico/conduta), edita,
// ESCREVE a avaliação e conduta (parte clínica é do médico) e aprova → evolução.

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { Header } from "@/components/header"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Loader2, ShieldAlert, FileText, Check, ChevronDown, ChevronUp, Sparkles, ArrowLeft,
} from "lucide-react"
import { useMe } from "@/lib/use-me"
import { FEATURE, temFeature, readFeatureGate } from "@/lib/feature-gate"
import { UpsellFeature } from "@/components/assinatura/upsell-feature"
import { useFeatureUpsell } from "@/components/assinatura/feature-upsell"

interface Rascunho {
  resumo_factual?: string
  queixas_relatadas?: string[]
  fatos_relatados?: string[]
  temas_abordados?: string[]
  medicacoes_mencionadas?: string[]
  mencao_risco?: boolean
}
interface EscribaData {
  transcricao: string | null
  rascunho: Rascunho | null
  mencaoRisco: boolean
  status: string
}

const linhas = (a?: string[]) => (a ?? []).join("\n")
const arr = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean)

export default function EscribaRevisaoPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const me = useMe()
  const { showUpsell } = useFeatureUpsell()
  // Feature gate (ADR-059): escriba = só Master. Trava proativa (me.features) + reativa (402).
  const semEscriba = me?.features != null && !temFeature(me.features, FEATURE.escriba)

  const [data, setData] = useState<EscribaData | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [erroSalvar, setErroSalvar] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [aprovado, setAprovado] = useState(false)
  const [verTranscricao, setVerTranscricao] = useState(false)

  // Campos editáveis (rascunho factual + parte clínica do médico)
  const [resumo, setResumo] = useState("")
  const [queixas, setQueixas] = useState("")
  const [fatos, setFatos] = useState("")
  const [temas, setTemas] = useState("")
  const [medicacoes, setMedicacoes] = useState("")
  const [avaliacao, setAvaliacao] = useState("")

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    async function carregar() {
      try {
        const r = await fetch(`/api/consultas/${id}/escriba`)
        const gate = await readFeatureGate(r)
        if (gate) { if (!cancelled) { setErro("bloqueado"); showUpsell(gate.feature) } return }
        if (r.status === 404) { if (!cancelled) setErro("sem_rascunho"); return }
        if (!r.ok) { if (!cancelled) setErro("erro"); return }
        const d: EscribaData = await r.json()
        if (cancelled) return
        setData(d)
        const rr = d.rascunho ?? {}
        setResumo(rr.resumo_factual ?? "")
        setQueixas(linhas(rr.queixas_relatadas))
        setFatos(linhas(rr.fatos_relatados))
        setTemas(linhas(rr.temas_abordados))
        setMedicacoes(linhas(rr.medicacoes_mencionadas))
        if (d.status === "aprovado") setAprovado(true)
        // Presencial (ADR-075): transcrição é assíncrona — faz polling até ficar pronta.
        if (d.status === "processando") timer = setTimeout(carregar, 5000)
      } catch {
        if (!cancelled) setErro("erro")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    carregar()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [id])

  const rascunhoAtual = (): Rascunho => ({
    resumo_factual: resumo,
    queixas_relatadas: arr(queixas),
    fatos_relatados: arr(fatos),
    temas_abordados: arr(temas),
    medicacoes_mencionadas: arr(medicacoes),
    mencao_risco: data?.mencaoRisco ?? false,
  })

  async function salvarRascunho(): Promise<boolean> {
    setSalvando(true)
    setErroSalvar(false)
    try {
      const r = await fetch(`/api/consultas/${id}/escriba`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rascunho: rascunhoAtual() }),
      })
      if (!r.ok) {
        setErroSalvar(true)
        return false
      }
      return true
    } catch {
      setErroSalvar(true)
      return false
    } finally {
      setSalvando(false)
    }
  }

  function montarConteudo(): string {
    const bloco = (titulo: string, itens: string[]) =>
      itens.length ? `${titulo}:\n${itens.map((i) => `- ${i}`).join("\n")}\n\n` : ""
    return (
      `RESUMO (assistido por IA, revisado pelo médico)\n${resumo || "—"}\n\n` +
      bloco("Queixas relatadas", arr(queixas)) +
      bloco("Fatos relatados", arr(fatos)) +
      bloco("Medicações mencionadas", arr(medicacoes)) +
      (arr(temas).length ? `Temas: ${arr(temas).join(", ")}\n\n` : "") +
      `AVALIAÇÃO E CONDUTA (médico)\n${avaliacao || "—"}`
    )
  }

  async function aprovar() {
    if (!avaliacao.trim()) {
      setErro("avaliacao_vazia")
      return
    }
    setSalvando(true)
    setErro(null)
    try {
      const salvou = await salvarRascunho()
      if (!salvou) {
        setErro("erro_aprovar")
        return
      }
      const r = await fetch(`/api/consultas/${id}/escriba/aprovar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conteudo: montarConteudo() }),
      })
      if (!r.ok) throw new Error()
      setAprovado(true)
    } catch {
      setErro("erro_aprovar")
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="p-8 space-y-6 max-w-3xl">
      <Header title="Escriba — nota da consulta" subtitle="Rascunho factual da IA · você revisa, completa e aprova" />

      {loading ? (
        <div className="flex justify-center py-20 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : erro === "bloqueado" || semEscriba ? (
        <UpsellFeature feature={FEATURE.escriba} />
      ) : erro === "sem_rascunho" ? (
        <Card><CardContent className="py-12 text-center space-y-3">
          <p className="text-sm text-muted-foreground">Nenhum rascunho ainda. Grave a teleconsulta (com consentimento do paciente) para gerar a nota.</p>
          <Button asChild variant="outline"><Link href={`/dashboard/consultas/${id}/teleconsulta`}><ArrowLeft className="h-4 w-4 mr-2" />Ir para a teleconsulta</Link></Button>
        </CardContent></Card>
      ) : erro === "erro" ? (
        <Card><CardContent className="py-12 text-center space-y-3">
          <ShieldAlert className="mx-auto h-8 w-8 text-coral" />
          <p className="text-sm text-muted-foreground">Não foi possível carregar a nota desta consulta agora. Atualize a página ou tente novamente em instantes.</p>
          <Button variant="outline" onClick={() => window.location.reload()}>Tentar novamente</Button>
        </CardContent></Card>
      ) : data?.status === "processando" ? (
        <Card><CardContent className="py-16 flex flex-col items-center gap-3 text-center">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
          <p className="text-sm font-medium text-foreground">Gerando a nota clínica…</p>
          <p className="text-xs text-muted-foreground">A transcrição da consulta está sendo processada — numa consulta longa isso pode levar alguns minutos. A página atualiza sozinha.</p>
        </CardContent></Card>
      ) : data?.status === "erro" ? (
        <Card><CardContent className="py-12 text-center space-y-3">
          <ShieldAlert className="mx-auto h-8 w-8 text-coral" />
          <p className="text-sm text-muted-foreground">Não foi possível gerar a nota desta gravação. Você pode gravar a consulta novamente.</p>
          <Button asChild variant="outline"><Link href={`/dashboard/consultas/${id}/escriba/gravar`}>Regravar</Link></Button>
        </CardContent></Card>
      ) : aprovado ? (
        <Card className="border-success/40 bg-success/5"><CardContent className="py-12 text-center space-y-3">
          <Check className="mx-auto h-8 w-8 text-success" />
          <p className="text-sm font-medium text-foreground">Evolução aprovada e salva no prontuário.</p>
          <Button asChild variant="outline"><Link href="/dashboard/prontuarios">Ir para prontuários</Link></Button>
        </CardContent></Card>
      ) : (
        <>
          {data?.mencaoRisco && (
            <div className="flex items-start gap-3 rounded-xl border border-coral/40 bg-coral/10 p-4">
              <ShieldAlert className="h-5 w-5 flex-shrink-0 text-coral" />
              <p className="text-sm text-foreground">
                <strong>Menção de risco</strong> identificada na conversa. Revise com atenção — esta é uma
                observação factual da fala, não uma avaliação clínica.
              </p>
            </div>
          )}

          {/* Rascunho factual (editável) */}
          <Card>
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold text-foreground">Rascunho factual (IA — sem diagnóstico)</h2>
              </div>
              <Campo label="Resumo factual" value={resumo} onChange={setResumo} rows={4} />
              <Campo label="Queixas relatadas (uma por linha)" value={queixas} onChange={setQueixas} rows={3} />
              <Campo label="Fatos relatados (uma por linha)" value={fatos} onChange={setFatos} rows={3} />
              <Campo label="Medicações mencionadas (uma por linha)" value={medicacoes} onChange={setMedicacoes} rows={2} />
              <Campo label="Temas abordados (um por linha)" value={temas} onChange={setTemas} rows={2} />
            </CardContent>
          </Card>

          {/* Avaliação e conduta — DO MÉDICO */}
          <Card className="border-primary/30">
            <CardContent className="p-6 space-y-3">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold text-foreground">Avaliação e conduta (você escreve)</h2>
              </div>
              <p className="text-xs text-muted-foreground">
                A IA não preenche este campo. Diagnóstico, impressão clínica e conduta são da sua decisão.
              </p>
              <Campo label="" value={avaliacao} onChange={setAvaliacao} rows={6}
                placeholder="Impressão clínica, hipóteses, conduta, ajustes, próximos passos…" />
              {erro === "avaliacao_vazia" && <p className="text-xs text-coral">Escreva a avaliação e conduta antes de aprovar.</p>}
              {erro === "erro_aprovar" && <p className="text-xs text-coral">Não foi possível aprovar. Tente novamente.</p>}
            </CardContent>
          </Card>

          {/* Transcrição (colapsada) */}
          {data?.transcricao && (
            <Card>
              <CardContent className="p-0">
                <button
                  onClick={() => setVerTranscricao((v) => !v)}
                  className="flex w-full items-center justify-between px-6 py-4 text-sm font-medium text-foreground"
                >
                  Transcrição da consulta
                  {verTranscricao ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
                {verTranscricao && (
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap border-t border-border px-6 py-4 text-xs text-muted-foreground">
                    {data.transcricao}
                  </pre>
                )}
              </CardContent>
            </Card>
          )}

          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={salvarRascunho} disabled={salvando}>
              {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar rascunho"}
            </Button>
            <Button onClick={aprovar} disabled={salvando} className="gap-2">
              <Check className="h-4 w-4" /> Aprovar e salvar evolução
            </Button>
          </div>
          {erroSalvar && (
            <p className="text-xs text-coral">Não foi possível salvar o rascunho da nota. Tente novamente.</p>
          )}
        </>
      )}
    </div>
  )
}

function Campo({ label, value, onChange, rows = 3, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; rows?: number; placeholder?: string
}) {
  return (
    <label className="block">
      {label && <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className="w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30"
      />
    </label>
  )
}
