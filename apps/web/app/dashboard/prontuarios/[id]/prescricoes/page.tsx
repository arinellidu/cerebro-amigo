"use client"

import { useCallback, useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { BotaoReceitaMemed } from "@/components/memed/botao-receita-memed"
import { ReceitasMemedAConfirmar } from "@/components/memed/receitas-a-confirmar"
import { VerificadorInteracoes } from "@/components/memed/verificador-interacoes"
import { Pill, AlertTriangle, Loader2 } from "lucide-react"

// MEMED desligado por enquanto (integração em andamento — ADR-056).
// Para reativar: voltar `MEMED_HABILITADO` para true. Isso reexibe o botão de emissão
// e a fila de confirmação, e volta a unir as prescrições MEMED ativas na lista.
const MEMED_HABILITADO = false

// Linha de prescrição MEMED (origem: tabela `prescricoes`, ativa após confirmação do médico).
interface PrescricaoRow {
  id: string
  medicamentoNome: string
  posologia: string
  ativa: boolean
  inicioEm: string
}
// Linha de medicação em uso (origem: tabela `medicacoes_em_uso`, ADR-062 — o médico digita).
interface MedicacaoEmUsoRow {
  id: string
  medicamento: string
  posologia: string | null
  fonte: string | null
}
// Item unificado renderizado na aba.
interface ItemMedicacao {
  id: string
  medicamentoNome: string
  posologia: string
  fonte: string | null
  ativa: boolean
}

export default function PrescricoesPage() {
  const { id } = useParams<{ id: string }>()
  const [itens, setItens] = useState<ItemMedicacao[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState(false)
  // Sobe a cada receita MEMED espelhada → refaz a fila de confirmação.
  const [confirmacaoSignal, setConfirmacaoSignal] = useState(0)

  const carregar = useCallback((pid: string) => {
    setLoading(true)
    setErro(false)
    setItens([])

    // Fontes da lista. Medicações em uso entram sempre (o médico digita o que o paciente
    // toma — ADR-062). Prescrições MEMED só entram com MEMED ligado. NÃO duplicamos linha:
    // é união só de exibição, então a checagem de interações A5 (que já faz UNION das duas
    // tabelas no gateway) não conta o mesmo fármaco duas vezes.
    const fontes: Promise<ItemMedicacao[]>[] = [
      fetch(`/api/pacientes/${pid}/medicacoes-em-uso`)
        .then((r) => {
          if (!r.ok) throw new Error("falha ao carregar medicações em uso")
          return r.json()
        })
        .then((rows: MedicacaoEmUsoRow[]) =>
          (Array.isArray(rows) ? rows : []).map((m) => ({
            id: m.id,
            medicamentoNome: m.medicamento,
            posologia: m.posologia ?? "",
            fonte: m.fonte ?? null,
            ativa: true,
          })),
        ),
    ]

    if (MEMED_HABILITADO) {
      fontes.push(
        fetch(`/api/pacientes/${pid}/prescricoes`)
          .then((r) => {
            if (!r.ok) throw new Error("falha ao carregar prescrições")
            return r.json()
          })
          .then((rows: PrescricaoRow[]) =>
            (Array.isArray(rows) ? rows : []).map((rx) => ({
              id: rx.id,
              medicamentoNome: rx.medicamentoNome,
              posologia: rx.posologia,
              fonte: null,
              ativa: rx.ativa,
            })),
          ),
      )
    }

    Promise.all(fontes)
      .then((listas) => setItens(listas.flat()))
      .catch(() => setErro(true))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (id) carregar(id)
  }, [id, carregar])

  return (
    <div className="space-y-3">
      {MEMED_HABILITADO && (
        <>
          <BotaoReceitaMemed
            pacienteId={id}
            onReceitaRegistrada={() => setConfirmacaoSignal((s) => s + 1)}
          />
          <ReceitasMemedAConfirmar
            pacienteId={id}
            refreshSignal={confirmacaoSignal}
            onConfirmado={() => carregar(id)}
          />
        </>
      )}
      <VerificadorInteracoes pacienteId={id} />

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : erro ? (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="p-6 text-center py-8">
            <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
            <p className="text-sm text-foreground font-medium">
              Não foi possível carregar os medicamentos deste paciente.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Recarregue antes de tomar decisões clínicas — a lista pode estar incompleta.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => id && carregar(id)}
            >
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      ) : itens.length === 0 ? (
        <Card className="border-border/50">
          <CardContent className="p-6 text-center py-8">
            <Pill className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-sm text-muted-foreground">Nenhum medicamento registrado.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Registre na aba <strong>Medicações em uso</strong>.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {itens.map((rx) => (
            <Card key={rx.id} className="border-border/50">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                  <Pill className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground">{rx.medicamentoNome}</p>
                  {rx.posologia && (
                    <p className="text-sm text-muted-foreground">{rx.posologia}</p>
                  )}
                  {rx.fonte && (
                    <p className="text-[11px] text-muted-foreground">Fonte: {rx.fonte}</p>
                  )}
                </div>
                <Badge
                  className={
                    rx.ativa
                      ? "bg-success/15 text-success"
                      : "bg-muted text-muted-foreground"
                  }
                >
                  {rx.ativa ? "Ativa" : "Inativa"}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
