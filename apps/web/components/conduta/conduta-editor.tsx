"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Pill, ClipboardList, Smile, BellRing, Loader2, Check, AlertCircle } from "lucide-react"

interface Conduta {
  id: string
  pacienteId: string
  tipo: string
  config: string // JSON string (config::text do gateway)
  ativa: boolean
  atualizadoEm: string
}

const WEEKDAYS = [
  { v: "0", label: "Segunda" },
  { v: "1", label: "Terça" },
  { v: "2", label: "Quarta" },
  { v: "3", label: "Quinta" },
  { v: "4", label: "Sexta" },
  { v: "5", label: "Sábado" },
  { v: "6", label: "Domingo" },
]

const FREQS = [
  { v: "diaria", label: "Todos os dias", dias: [0, 1, 2, 3, 4, 5, 6] },
  { v: "uteis", label: "Dias úteis", dias: [0, 1, 2, 3, 4] },
  { v: "swf", label: "Seg / Qua / Sex", dias: [0, 2, 4] },
]
function freqToDias(f: string): number[] {
  return FREQS.find((x) => x.v === f)?.dias ?? [0, 1, 2, 3, 4, 5, 6]
}
function diasToFreq(dias: unknown): string {
  if (!Array.isArray(dias)) return "diaria"
  const k = [...(dias as number[])].sort().join(",")
  for (const f of FREQS) if ([...f.dias].sort().join(",") === k) return f.v
  return "diaria"
}

function parseConfig(c?: Conduta): Record<string, unknown> {
  if (!c) return {}
  try {
    return (JSON.parse(c.config) as Record<string, unknown>) || {}
  } catch {
    return {}
  }
}

export function CondutaEditor({ pacienteId }: { pacienteId: string }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const [medAtivo, setMedAtivo] = useState(true)
  const [medExpira, setMedExpira] = useState(4)
  const [qAtivo, setQAtivo] = useState(true)
  const [qPhq, setQPhq] = useState("0")
  const [qGad, setQGad] = useState("3")
  const [qHora, setQHora] = useState(9)
  const [chAtivo, setChAtivo] = useState(false)
  const [chFreq, setChFreq] = useState("diaria")
  const [chHora, setChHora] = useState(12)
  const [alAtivo, setAlAtivo] = useState(false)
  const [alLimiar, setAlLimiar] = useState(2)
  const [alJanela, setAlJanela] = useState(7)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/pacientes/${pacienteId}/condutas`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Conduta[]) => {
        const map: Record<string, Conduta> = {}
        for (const c of Array.isArray(rows) ? rows : []) map[c.tipo] = c
        const med = parseConfig(map["lembrete_medicacao"])
        setMedAtivo(med.ativo !== false)
        setMedExpira(Number(med.expira_horas ?? 4))
        const q = parseConfig(map["questionario"])
        setQAtivo(q.ativo !== false)
        setQPhq(String(q.phq9_weekday ?? 0))
        setQGad(String(q.gad7_weekday ?? 3))
        setQHora(Number(q.hora_utc ?? 9))
        const ch = parseConfig(map["checkin_humor"])
        setChAtivo(ch.ativo === true)
        setChFreq(diasToFreq(ch.dias))
        setChHora(Number(ch.hora_utc ?? 12))
        const al = parseConfig(map["alerta_nao_adesao"])
        setAlAtivo(al.ativo === true)
        setAlLimiar(Number(al.limiar ?? 2))
        setAlJanela(Number(al.janela_dias ?? 7))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [pacienteId])

  async function salvar(tipo: string, config: Record<string, unknown>) {
    setSaving(tipo)
    setSaved(null)
    setErro(null)
    try {
      const r = await fetch(`/api/pacientes/${pacienteId}/condutas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo, config }),
      })
      if (r.ok) {
        setSaved(tipo)
        setTimeout(() => setSaved(null), 2500)
      } else {
        setErro(tipo)
      }
    } catch {
      setErro(tipo)
    } finally {
      setSaving(null)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Regras operacionais de acompanhamento entre consultas. Sobrescrevem o
        padrão global para este paciente e respeitam a pausa por crise.
      </p>

      {/* Lembrete de medicação */}
      <Card className="border-border/50">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Pill className="h-4 w-4 text-primary" /> Lembrete de medicação
          </CardTitle>
          <Switch checked={medAtivo} onCheckedChange={setMedAtivo} />
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <Label className="w-48 text-sm text-muted-foreground">
              Janela de resposta (horas)
            </Label>
            <Input
              type="number"
              min={1}
              max={24}
              value={medExpira}
              onChange={(e) => setMedExpira(Number(e.target.value))}
              className="w-24"
              disabled={!medAtivo}
            />
          </div>
          <SaveRow
            tipo="lembrete_medicacao"
            saving={saving}
            saved={saved}
            erro={erro}
            onSave={() =>
              salvar("lembrete_medicacao", { ativo: medAtivo, expira_horas: medExpira })
            }
          />
        </CardContent>
      </Card>

      {/* Questionários */}
      <Card className="border-border/50">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <ClipboardList className="h-4 w-4 text-primary" /> Questionários (PHQ-9 / GAD-7)
          </CardTitle>
          <Switch checked={qAtivo} onCheckedChange={setQAtivo} />
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <WeekdayField label="PHQ-9 (depressão)" value={qPhq} onChange={setQPhq} disabled={!qAtivo} />
            <WeekdayField label="GAD-7 (ansiedade)" value={qGad} onChange={setQGad} disabled={!qAtivo} />
          </div>
          <div className="flex items-center gap-3">
            <Label className="w-48 text-sm text-muted-foreground">Horário (UTC)</Label>
            <Input
              type="number"
              min={0}
              max={23}
              value={qHora}
              onChange={(e) => setQHora(Number(e.target.value))}
              className="w-24"
              disabled={!qAtivo}
            />
          </div>
          <SaveRow
            tipo="questionario"
            saving={saving}
            saved={saved}
            erro={erro}
            onSave={() =>
              salvar("questionario", {
                ativo: qAtivo,
                phq9_weekday: Number(qPhq),
                gad7_weekday: Number(qGad),
                hora_utc: qHora,
              })
            }
          />
        </CardContent>
      </Card>

      {/* Check-in de humor (dirigido por conduta) */}
      <Card className="border-border/50">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Smile className="h-4 w-4 text-primary" /> Check-in de humor
          </CardTitle>
          <Switch checked={chAtivo} onCheckedChange={setChAtivo} />
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Frequência</Label>
              <Select value={chFreq} onValueChange={setChFreq} disabled={!chAtivo}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FREQS.map((f) => (
                    <SelectItem key={f.v} value={f.v}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Horário (UTC)</Label>
              <Input
                type="number"
                min={0}
                max={23}
                value={chHora}
                onChange={(e) => setChHora(Number(e.target.value))}
                disabled={!chAtivo}
              />
            </div>
          </div>
          <SaveRow
            tipo="checkin_humor"
            saving={saving}
            saved={saved}
            erro={erro}
            onSave={() =>
              salvar("checkin_humor", { ativo: chAtivo, dias: freqToDias(chFreq), hora_utc: chHora })
            }
          />
        </CardContent>
      </Card>

      {/* Alerta de não-adesão (dirigido por conduta) */}
      <Card className="border-border/50">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <BellRing className="h-4 w-4 text-primary" /> Alerta de não-adesão
          </CardTitle>
          <Switch checked={alAtivo} onCheckedChange={setAlAtivo} />
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            Avisar se
            <Input
              type="number"
              min={1}
              max={30}
              value={alLimiar}
              onChange={(e) => setAlLimiar(Number(e.target.value))}
              className="w-20"
              disabled={!alAtivo}
            />
            doses não tomadas em
            <Input
              type="number"
              min={1}
              max={90}
              value={alJanela}
              onChange={(e) => setAlJanela(Number(e.target.value))}
              className="w-20"
              disabled={!alAtivo}
            />
            dias.
          </div>
          <SaveRow
            tipo="alerta_nao_adesao"
            saving={saving}
            saved={saved}
            erro={erro}
            onSave={() =>
              salvar("alerta_nao_adesao", { ativo: alAtivo, limiar: alLimiar, janela_dias: alJanela })
            }
          />
        </CardContent>
      </Card>
    </div>
  )
}

function SaveRow({
  tipo,
  saving,
  saved,
  erro,
  onSave,
}: {
  tipo: string
  saving: string | null
  saved: string | null
  erro?: string | null
  onSave: () => void
}) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <Button size="sm" onClick={onSave} disabled={saving === tipo} className="h-8">
        {saving === tipo ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
      </Button>
      {saved === tipo && (
        <span className="flex items-center gap-1 text-xs text-success">
          <Check className="h-3.5 w-3.5" /> Salvo
        </span>
      )}
      {erro === tipo && saving !== tipo && (
        <span className="flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5" /> Não foi possível salvar esta regra de
          acompanhamento. Verifique sua conexão e tente novamente.
        </span>
      )}
    </div>
  )
}

function WeekdayField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {WEEKDAYS.map((d) => (
            <SelectItem key={d.v} value={d.v}>
              {d.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

