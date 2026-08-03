"use client"

import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Plus, Loader2, AlertTriangle } from "lucide-react"

interface PacienteOpcao {
  id: string
  nome: string | null
  numero: number
}

function horaLocal(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
}

export function NovaConsultaDialog({
  diaInicial,
  onCriada,
  pacienteInicial,
}: {
  diaInicial: string // YYYY-MM-DD
  onCriada: (iniciaEm: string) => void // ISO do horário agendado → agenda navega pro dia
  pacienteInicial?: string // deep-link da lista de pacientes (?paciente=<id>): pré-abre + pré-seleciona
}) {
  const [aberto, setAberto] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [pacientes, setPacientes] = useState<PacienteOpcao[]>([])

  const [pacienteId, setPacienteId] = useState(pacienteInicial ?? "")

  // Deep-link: chega com ?paciente=<id> → abre o diálogo já com o paciente selecionado.
  useEffect(() => {
    if (pacienteInicial) { setPacienteId(pacienteInicial); setAberto(true) }
  }, [pacienteInicial])
  const [data, setData] = useState(diaInicial)
  const [modalidade, setModalidade] = useState("presencial")

  // Slots livres (ISO UTC) do médico no dia selecionado.
  const [slots, setSlots] = useState<string[]>([])
  const [slot, setSlot] = useState("")
  const [duracaoMin, setDuracaoMin] = useState(30)
  const [carregandoSlots, setCarregandoSlots] = useState(false)

  useEffect(() => {
    if (!aberto) return
    setData(diaInicial)
    fetch("/api/pacientes")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setPacientes(Array.isArray(rows) ? rows : []))
      .catch(() => setPacientes([]))
  }, [aberto, diaInicial])

  // Busca slots sempre que o dia muda (com o dialog aberto).
  useEffect(() => {
    if (!aberto || !data) return
    setCarregandoSlots(true)
    setSlot("")
    fetch(`/api/consultas/disponibilidade?data=${data}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setSlots(Array.isArray(d?.slots) ? d.slots : [])
        if (typeof d?.duracaoMin === "number") setDuracaoMin(d.duracaoMin)
      })
      .catch(() => setSlots([]))
      .finally(() => setCarregandoSlots(false))
  }, [aberto, data])

  function reset() {
    setEnviando(false)
    setErro(null)
    setPacienteId("")
    setModalidade("presencial")
    setSlots([])
    setSlot("")
  }

  async function submeter(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    if (!pacienteId) return setErro("Selecione o paciente.")
    if (!slot) return setErro("Selecione um horário disponível.")

    setEnviando(true)
    try {
      const r = await fetch("/api/consultas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pacienteId, iniciaEm: slot, duracaoMin, modalidade }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => null)
        if (r.status === 409 || d?.erro === "horario_ocupado") {
          setErro("Esse horário acabou de ser ocupado. Escolha outro.")
        } else {
          // Não expor a mensagem crua do backend (pode vir técnica ou em inglês).
          console.error("Falha ao agendar consulta", { status: r.status, detalhe: d?.erro ?? d?.error })
          setErro("Não foi possível agendar a consulta. Tente novamente em instantes.")
        }
        return
      }
      onCriada(slot)
      setAberto(false)
    } catch {
      setErro("Erro de conexão. Tente novamente.")
    } finally {
      setEnviando(false)
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
        <Button className="bg-primary hover:bg-purple-dark text-primary-foreground gap-2">
          <Plus className="h-4 w-4" /> Nova consulta
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-foreground">Agendar consulta</DialogTitle>
          <DialogDescription>Escolha paciente, dia e um horário livre.</DialogDescription>
        </DialogHeader>

        <form onSubmit={submeter} className="space-y-4">
          {erro && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{erro}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Paciente</Label>
            <Select value={pacienteId} onValueChange={setPacienteId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o paciente" />
              </SelectTrigger>
              <SelectContent>
                {pacientes.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.nome ?? `Paciente ${String(p.numero).padStart(2, "0")}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="nc-data">Data</Label>
              <Input id="nc-data" type="date" value={data} onChange={(e) => setData(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label>Horário</Label>
              <Select value={slot} onValueChange={setSlot} disabled={carregandoSlots || slots.length === 0}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      carregandoSlots ? "Carregando…" : slots.length === 0 ? "Sem horários" : "Escolha"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {slots.map((s) => (
                    <SelectItem key={s} value={s}>
                      {horaLocal(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {!carregandoSlots && slots.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Nenhum horário livre neste dia. Ajuste seu expediente em Configurações ou escolha outra data.
            </p>
          )}

          <div className="space-y-1.5">
            <Label>Modalidade</Label>
            <Select value={modalidade} onValueChange={setModalidade}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="presencial">Presencial</SelectItem>
                <SelectItem value="teleconsulta">Teleconsulta</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={enviando || !slot}
              className="bg-primary hover:bg-purple-dark text-primary-foreground"
            >
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Agendar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
