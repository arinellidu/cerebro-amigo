"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  FileClock, Plus, X, Loader2, AlertTriangle, Check,
  ShieldAlert, ShieldCheck, ShieldQuestion,
} from "lucide-react"

interface Rascunho {
  id: string
  medicamento: string
  doseDescricao: string
  receitaTipo: string | null
  criadaEm: string
}

interface InteracaoAlerta {
  tipo: string // "interacao" | "duplicidade"
  severidade: string // "grave" | "moderada"
  medicamentoA: string
  medicamentoB: string
  mecanismo: string
  recomendacao: string | null
  fonte: string | null
}

interface ChecagemResp {
  alertas: InteracaoAlerta[]
  disclaimer: string
  catalogoVersao: string | null
}

/**
 * Fila de confirmação de receita MEMED (Tier 1, ADR-056).
 *
 * O espelho de uma receita emitida no MEMED não conhece horários (lembrete) nem
 * validade (renovação) — entra como rascunho (ativa=false) e fica fora dos jobs.
 * Aqui o médico informa esses dados estruturados e ATIVA a prescrição. A IA não
 * infere posologia; quem decide horário/validade é o médico (clinical-safety #4).
 *
 * Só renderiza algo quando há rascunhos pendentes.
 */
export function ReceitasMemedAConfirmar({
  pacienteId,
  refreshSignal,
  onConfirmado,
}: {
  pacienteId: string
  refreshSignal?: number
  onConfirmado?: () => void
}) {
  const [itens, setItens] = useState<Rascunho[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState(false)

  const carregar = useCallback(async () => {
    setLoading(true)
    setErro(false)
    try {
      const r = await fetch(`/api/pacientes/${pacienteId}/prescricoes-a-confirmar`)
      const d = await r.json().catch(() => null)
      if (r.ok && Array.isArray(d)) {
        setItens(
          d.map((x: any) => ({
            id: x.id,
            medicamento: x.medicamento,
            doseDescricao: x.doseDescricao ?? x.dose_descricao ?? "",
            receitaTipo: x.receitaTipo ?? x.receita_tipo ?? null,
            criadaEm: x.criadaEm ?? x.criada_em ?? "",
          })),
        )
      } else {
        setErro(true)
      }
    } catch {
      setErro(true)
    } finally {
      setLoading(false)
    }
  }, [pacienteId])

  useEffect(() => {
    carregar()
  }, [carregar, refreshSignal])

  const aoResolver = useCallback(
    (id: string) => {
      setItens((prev) => prev.filter((x) => x.id !== id))
      onConfirmado?.()
    },
    [onConfirmado],
  )

  // 2ª barreira A5 (ADR-032 + ADR-057): roda a checagem de interações ANTES de
  // ativar — um fármaco novo do MEMED entra aqui. Rascunhos são ativa=false, então
  // o checar (que pareia com os ATIVOS do paciente) não os vê; mando todos os
  // medicamentos dos rascunhos juntos para também cruzar interação ENTRE os
  // fármacos da mesma receita. Informa; não bloqueia (a decisão é do médico).
  const [chec, setChec] = useState<ChecagemResp | null>(null)
  const [checLoading, setChecLoading] = useState(false)
  // Distingue "checagem FALHOU" de "rodou e não achou nada" — nunca colapsar:
  // uma 2ª barreira que falhou não pode parecer "sem interações".
  const [checErro, setChecErro] = useState(false)

  const checarInteracoes = useCallback(async (medicamentos: string[]) => {
    if (medicamentos.length === 0) {
      setChec(null)
      return
    }
    setChecLoading(true)
    setChecErro(false)
    try {
      const r = await fetch("/api/prescricoes/checar-interacoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pacienteId, medicamentos }),
      })
      const d = await r.json().catch(() => null)
      if (r.ok && d) {
        setChec(d)
      } else {
        setChec(null)
        setChecErro(true)
      }
    } catch {
      setChec(null)
      setChecErro(true)
    } finally {
      setChecLoading(false)
    }
  }, [pacienteId])

  // Re-checa sempre que a lista de rascunhos muda (chave = medicamentos).
  const medsKey = itens.map((i) => i.medicamento).join("|")
  useEffect(() => {
    if (itens.length > 0) void checarInteracoes(itens.map((i) => i.medicamento))
    else setChec(null)
    // medsKey resume a lista; checarInteracoes só depende de pacienteId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [medsKey, checarInteracoes])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Verificando receitas a confirmar…
      </div>
    )
  }

  // Falha na busca: avisa, mas não bloqueia o resto do prontuário.
  if (erro) {
    return (
      <p className="flex items-start gap-1.5 text-sm text-amber-600">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        Não foi possível verificar receitas MEMED a confirmar. Recarregue para tentar de novo.
      </p>
    )
  }

  if (itens.length === 0) return null

  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <FileClock className="h-4 w-4 text-primary" />
          <p className="text-sm font-medium text-foreground">
            Receita(s) MEMED a confirmar ({itens.length})
          </p>
        </div>
        <p className="text-xs text-muted-foreground -mt-2">
          Informe os horários para ligar o lembrete de adesão e a validade para
          entrar na fila de renovação. Sem confirmar, a receita não gera lembrete
          nem renovação.
        </p>

        <BlocoInteracoes resp={chec} loading={checLoading} erro={checErro} />

        {itens.map((item) => (
          <LinhaRascunho
            key={item.id}
            item={item}
            temGrave={(chec?.alertas ?? []).some((a) => a.severidade === "grave")}
            onResolvido={() => aoResolver(item.id)}
          />
        ))}
      </CardContent>
    </Card>
  )
}

// 2ª barreira de interações no momento de confirmar (A5, ADR-032 + ADR-057).
// Mesma linguagem visual do VerificadorInteracoes. Informa, não bloqueia.
function BlocoInteracoes({
  resp,
  loading,
  erro,
}: {
  resp: ChecagemResp | null
  loading: boolean
  erro: boolean
}) {
  const alertas = resp?.alertas ?? []
  const temGrave = alertas.some((a) => a.severidade === "grave")

  return (
    <div className="rounded-lg border border-border/70 bg-background/60 p-3">
      <div className="mb-2 flex items-center gap-2">
        {erro ? (
          <ShieldQuestion className="h-4 w-4 text-amber-600" />
        ) : alertas.length > 0 ? (
          <ShieldAlert className={`h-4 w-4 ${temGrave ? "text-coral" : "text-amber-600"}`} />
        ) : (
          <ShieldCheck className="h-4 w-4 text-primary" />
        )}
        <h5 className="text-sm font-semibold text-foreground">Interações (2ª barreira)</h5>
      </div>

      {loading ? (
        <div className="flex justify-center py-3 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : erro ? (
        // Falhou ≠ sem interação: nunca tratar como "limpo".
        <p className="text-sm text-amber-700">
          Não foi possível verificar interações agora — a 2ª barreira não foi concluída.{" "}
          <span className="font-medium text-foreground">Não trate como &quot;sem interações&quot;</span>;
          confira no MEMED/bula antes de ativar.
        </p>
      ) : alertas.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma interação conhecida na base local.</p>
      ) : (
        <ul className="space-y-2">
          {alertas.map((a, i) => {
            const grave = a.severidade === "grave"
            return (
              <li
                key={i}
                className={`rounded-lg border-l-2 p-2.5 text-sm ${grave ? "border-coral bg-coral/5" : "border-amber-500 bg-amber-500/5"}`}
              >
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  <Badge variant={grave ? "destructive" : "secondary"} className="text-[0.65rem] uppercase">
                    {a.severidade}
                  </Badge>
                  <Badge variant="outline" className="text-[0.65rem]">
                    {a.tipo === "duplicidade" ? "duplicidade" : "interação"}
                  </Badge>
                  <span className="font-medium text-foreground">
                    {a.medicamentoA} × {a.medicamentoB}
                  </span>
                </div>
                <p className="text-muted-foreground">{a.mecanismo}</p>
                {a.recomendacao && <p className="mt-0.5 text-foreground/80">{a.recomendacao}</p>}
                {a.fonte && <p className="mt-0.5 text-[0.7rem] text-muted-foreground">Fonte: {a.fonte}</p>}
              </li>
            )
          })}
        </ul>
      )}

      {resp?.disclaimer && (
        <p className="mt-2 border-t border-border/60 pt-2 text-[0.7rem] leading-snug text-muted-foreground">
          {resp.disclaimer}
        </p>
      )}
    </div>
  )
}

function LinhaRascunho({
  item,
  temGrave,
  onResolvido,
}: {
  item: Rascunho
  temGrave: boolean
  onResolvido: () => void
}) {
  const [horarios, setHorarios] = useState<string[]>(["08:00"])
  const [validade, setValidade] = useState("")
  const [inicio, setInicio] = useState("")
  const [fim, setFim] = useState("")
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const horariosValidos = horarios.filter((h) => h.trim() !== "")
  // Confirmar só faz sentido se ligar pelo menos uma automação (lembrete ou renovação).
  const podeAtivar = horariosValidos.length > 0 || validade !== ""

  const setHorario = (i: number, v: string) =>
    setHorarios((prev) => prev.map((h, idx) => (idx === i ? v : h)))
  const addHorario = () => setHorarios((prev) => [...prev, ""])
  const removeHorario = (i: number) =>
    setHorarios((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev))

  const confirmar = async () => {
    setErro(null)
    setSalvando(true)
    try {
      const r = await fetch(`/api/prescricoes/${item.id}/confirmar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          horarios: horariosValidos,
          receitaValidade: validade || null,
          inicioEm: inicio || null,
          fimEm: fim || null,
        }),
      })
      if (r.ok) {
        onResolvido()
      } else {
        setErro("Não foi possível confirmar. Tente novamente.")
      }
    } catch {
      setErro("Não foi possível confirmar. Verifique a conexão e tente novamente.")
    } finally {
      setSalvando(false)
    }
  }

  const descartar = async () => {
    setErro(null)
    setSalvando(true)
    try {
      const r = await fetch(`/api/prescricoes/${item.id}/descartar`, { method: "POST" })
      if (r.ok) {
        onResolvido()
      } else {
        setErro("Não foi possível descartar. Tente novamente.")
      }
    } catch {
      setErro("Não foi possível descartar. Verifique a conexão e tente novamente.")
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-background p-3 space-y-3">
      <div>
        <p className="text-sm font-medium text-foreground">{item.medicamento}</p>
        {item.doseDescricao && (
          <p className="text-xs text-muted-foreground">Posologia MEMED: {item.doseDescricao}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">Horários do lembrete</p>
        <div className="flex flex-wrap items-center gap-2">
          {horarios.map((h, i) => (
            <div key={i} className="flex items-center gap-1">
              <Input
                type="time"
                value={h}
                onChange={(e) => setHorario(i, e.target.value)}
                className="h-8 w-28"
              />
              {horarios.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeHorario(i)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="Remover horário"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1" onClick={addHorario}>
            <Plus className="h-3.5 w-3.5" /> Horário
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Validade da receita</span>
          <Input type="date" value={validade} onChange={(e) => setValidade(e.target.value)} className="h-8" />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Início (opcional)</span>
          <Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className="h-8" />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Fim (opcional)</span>
          <Input type="date" value={fim} onChange={(e) => setFim(e.target.value)} className="h-8" />
        </label>
      </div>

      {erro && (
        <p className="flex items-start gap-1.5 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {erro}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={confirmar} disabled={salvando || !podeAtivar} size="sm" className="gap-1.5">
          {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Ativar lembrete + renovação
        </Button>
        <Button onClick={descartar} disabled={salvando} variant="ghost" size="sm" className="text-muted-foreground">
          Descartar
        </Button>
        {!podeAtivar && (
          <span className="text-xs text-muted-foreground">
            Informe ao menos um horário ou a validade.
          </span>
        )}
        {podeAtivar && temGrave && (
          <span className="flex items-center gap-1 text-xs text-coral">
            <ShieldAlert className="h-3.5 w-3.5 shrink-0" /> Há alerta grave acima — confirme se intencional.
          </span>
        )}
      </div>
    </div>
  )
}
