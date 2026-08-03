"use client"

import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Header } from "@/components/header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Loader2, Check } from "lucide-react"
import { cpfMask, cpfValido, cpfDigits } from "@/lib/cpf"

const HORA_RE = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/
const DIAS: [string, string][] = [
  ["seg", "Seg"], ["ter", "Ter"], ["qua", "Qua"], ["qui", "Qui"],
  ["sex", "Sex"], ["sab", "Sáb"], ["dom", "Dom"],
]

// Schema Zod para validação
const configuracaoSchema = z.object({
  timezone: z.string().min(1, "Fuso horário é obrigatório"),
  dias: z.array(z.string()).min(1, "Selecione ao menos um dia de atendimento"),
  inicio: z.string().regex(HORA_RE, "Horário inválido"),
  fim: z.string().regex(HORA_RE, "Horário inválido"),
  duracao: z.enum(["15", "30", "45", "60"]),
  almocoInicio: z.string().regex(HORA_RE, "Horário inválido").optional().or(z.literal("")),
  almocoFim: z.string().regex(HORA_RE, "Horário inválido").optional().or(z.literal("")),
  criseEmail: z.boolean(),
  crm: z.string().optional(),
  crmUf: z.string().length(2, "UF deve ter 2 caracteres").regex(/^[A-Z]{2}$/, "UF inválida").optional().or(z.literal("")),
  cpf: z.string().refine((v) => {
    if (!v || v === "") return true
    return cpfValido(v)
  }, "CPF inválido").optional().or(z.literal("")),
}).refine((data) => {
  // Fim do expediente depois do início
  const [h1, m1] = data.inicio.split(":").map(Number)
  const [h2, m2] = data.fim.split(":").map(Number)
  return h2 * 60 + m2 > h1 * 60 + m1
}, { message: "Horário de fim deve ser depois do início", path: ["fim"] })
  .refine((data) => {
    // Almoço: ou ambos vazios, ou ambos preenchidos com fim > início
    const ini = data.almocoInicio || ""
    const fim = data.almocoFim || ""
    if (!ini && !fim) return true
    if (!ini || !fim) return false
    const [h1, m1] = ini.split(":").map(Number)
    const [h2, m2] = fim.split(":").map(Number)
    return h2 * 60 + m2 > h1 * 60 + m1
  }, { message: "Preencha início e fim do almoço (fim depois do início)", path: ["almocoFim"] })

type ConfiguracaoFormData = z.infer<typeof configuracaoSchema>

interface Config {
  timezone: string
  horarioTrabalho: string // JSON string
  notifPrefs: string // JSON string
  crm?: string | null
  crmUf?: string | null
  cpf?: string | null
}

const DURACOES = ["15", "30", "45", "60"] as const

export default function ConfiguracoesPage() {
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)
  const [erroSalvar, setErroSalvar] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ConfiguracaoFormData>({
    resolver: zodResolver(configuracaoSchema),
    defaultValues: {
      timezone: "America/Sao_Paulo",
      dias: ["seg", "ter", "qua", "qui", "sex"],
      inicio: "08:00",
      fim: "18:00",
      duracao: "30",
      almocoInicio: "",
      almocoFim: "",
      criseEmail: false,
      crm: "",
      crmUf: "",
      cpf: "",
    },
  })

  const criseEmail = watch("criseEmail")
  const cpf = watch("cpf")
  const crmUf = watch("crmUf")
  const dias = watch("dias")
  const duracao = watch("duracao")

  useEffect(() => {
    fetch("/api/configuracoes")
      .then((r) => (r.ok ? r.json() : null))
      .then((c: Config | null) => {
        if (!c) return
        const horario = (() => {
          try { return JSON.parse(c.horarioTrabalho || "{}") } catch { return {} }
        })()
        const notif = (() => {
          try { return JSON.parse(c.notifPrefs || "{}") } catch { return {} }
        })()
        const durRaw = String(horario.duracao_min ?? 30)
        const dur = (DURACOES as readonly string[]).includes(durRaw) ? durRaw : "30"
        const almoco = Array.isArray(horario.almoco) ? horario.almoco : []

        reset({
          timezone: c.timezone || "America/Sao_Paulo",
          dias: Array.isArray(horario.dias) && horario.dias.length
            ? horario.dias
            : ["seg", "ter", "qua", "qui", "sex"],
          inicio: horario.inicio || "08:00",
          fim: horario.fim || "18:00",
          duracao: dur as ConfiguracaoFormData["duracao"],
          almocoInicio: almoco[0] || "",
          almocoFim: almoco[1] || "",
          criseEmail: Boolean(notif.crise_email),
          crm: c.crm || "",
          crmUf: c.crmUf || "",
          cpf: c.cpf ? cpfMask(c.cpf) : "",
        })
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [reset])

  async function salvar(data: ConfiguracaoFormData) {
    setSaved(false)
    setErroSalvar(null)
    const almoco = data.almocoInicio && data.almocoFim ? [data.almocoInicio, data.almocoFim] : undefined
    try {
      const r = await fetch("/api/configuracoes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timezone: data.timezone,
          horarioTrabalho: {
            dias: data.dias,
            inicio: data.inicio,
            fim: data.fim,
            duracao_min: parseInt(data.duracao, 10),
            ...(almoco ? { almoco } : {}),
          },
          notifPrefs: { crise_email: data.criseEmail },
          crmUf: data.crmUf,
          cpf: cpfDigits(data.cpf || ""), // envia só dígitos
        }),
      })
      if (r.ok) {
        setSaved(true)
        setTimeout(() => setSaved(false), 2500)
      } else {
        console.error("Falha ao salvar configurações: status", r.status)
        setErroSalvar("Não foi possível salvar suas configurações. Verifique sua conexão e tente novamente.")
      }
    } catch (e) {
      console.error("Erro ao salvar configurações", e)
      setErroSalvar("Não foi possível salvar suas configurações. Verifique sua conexão e tente novamente.")
    }
  }

  return (
    <div className="min-h-screen">
      <Header title="Configurações" subtitle="Preferências da sua conta" />

      <div className="max-w-2xl p-6 space-y-6">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <form onSubmit={handleSubmit(salvar)} className="space-y-6">
            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">Expediente</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-sm">Fuso horário</Label>
                  <Input {...register("timezone")} placeholder="America/Sao_Paulo" />
                  {errors.timezone && <p className="text-xs text-destructive">{errors.timezone.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label className="text-sm">Dias de atendimento</Label>
                  <ToggleGroup
                    type="multiple"
                    variant="outline"
                    value={dias}
                    onValueChange={(v) => { if (v.length) setValue("dias", v, { shouldValidate: true }) }}
                    className="w-full"
                  >
                    {DIAS.map(([val, label]) => (
                      <ToggleGroupItem key={val} value={val} aria-label={label} className="text-xs">
                        {label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  {errors.dias && <p className="text-xs text-destructive">{errors.dias.message}</p>}
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-sm">Início</Label>
                    <Input type="time" {...register("inicio")} />
                    {errors.inicio && <p className="text-xs text-destructive">{errors.inicio.message}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm">Fim</Label>
                    <Input type="time" {...register("fim")} />
                    {errors.fim && <p className="text-xs text-destructive">{errors.fim.message}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm">Duração</Label>
                    <Select value={duracao} onValueChange={(v) => setValue("duracao", v as ConfiguracaoFormData["duracao"])}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {DURACOES.map((d) => (
                          <SelectItem key={d} value={d}>{d} min</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-sm">Almoço — início <span className="text-muted-foreground">(opcional)</span></Label>
                    <Input type="time" {...register("almocoInicio")} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm">Almoço — fim</Label>
                    <Input type="time" {...register("almocoFim")} />
                    {errors.almocoFim && <p className="text-xs text-destructive">{errors.almocoFim.message}</p>}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">Notificações</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">Receber e-mail em crise</p>
                    <p className="text-xs text-muted-foreground">
                      Aviso fora do app quando um paciente entra em protocolo de crise.
                    </p>
                  </div>
                  <Switch checked={criseEmail} onCheckedChange={(v) => setValue("criseEmail", v)} />
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">Dados profissionais (receita MEMED)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  Necessários para emitir receita digital via MEMED (CRM com número + UF, e CPF).
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-sm">CRM</Label>
                    <Input {...register("crm")} disabled placeholder="—" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm">UF do CRM</Label>
                    <Select value={crmUf} onValueChange={(v) => setValue("crmUf", v)}>
                      <SelectTrigger><SelectValue placeholder="UF" /></SelectTrigger>
                      <SelectContent>
                        {["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"].map((uf) => (
                          <SelectItem key={uf} value={uf}>{uf}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {errors.crmUf && <p className="text-xs text-destructive">{errors.crmUf.message}</p>}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm">CPF</Label>
                  <Input
                    value={cpf}
                    onChange={(e) => setValue("cpf", cpfMask(e.target.value))}
                    placeholder="000.000.000-00"
                    inputMode="numeric"
                    maxLength={14}
                    className={errors.cpf ? "border-destructive" : ""}
                  />
                  {errors.cpf && <p className="text-xs text-destructive">{errors.cpf.message}</p>}
                </div>
              </CardContent>
            </Card>

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar alterações"}
              </Button>
              {saved && (
                <span className="flex items-center gap-1 text-sm text-success">
                  <Check className="h-4 w-4" /> Salvo
                </span>
              )}
              {erroSalvar && (
                <span className="text-sm text-destructive" role="alert">
                  {erroSalvar}
                </span>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
