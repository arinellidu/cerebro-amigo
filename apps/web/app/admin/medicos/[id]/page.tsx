"use client"

import { type ReactNode, useCallback, useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  ArrowLeft, Loader2, Stethoscope, Users, MessageSquare, CalendarDays,
  Heart, ShieldAlert, Cpu, BadgeCheck, ShieldX, ShieldQuestion,
} from "lucide-react"

interface MedicoPerfil {
  id: string
  nome: string
  crm: string | null
  crmUf: string | null
  cpf: string | null
  especialidade: string | null
  timezone: string | null
  crmSituacao: string | null
  crmValidadoEm: string | null
  crmNomeCfm: string | null
  criadoEm: string
  email: string
  ultimoLogin: string | null
  plano: string | null
  valorMensal: number | null
  moeda: string | null
  statusAssinatura: string | null
  trialAte: string | null
  inicioEm: string | null
  totalPacientes: number
  mensagensRecentes: number
  totalConsultas: number
  crisesTotal: number
  checkinsRespondidos: number
  custoConversaUsd: number
  custoAgentesUsd: number
}

const brl = (n: number | null, moeda: string | null) =>
  n == null ? "—" : `${moeda ?? "BRL"} ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
const usd = (n: number) => `$ ${n.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`
const data = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR") : "—")

function SituacaoCrm({ s }: { s: string | null }) {
  // Chaves normalizadas (lowercase, só letras) — a coluna crm_situacao guarda o
  // valor cru do CFM (caixa/acentuação variável) e o soft-fail "PendenteVerificacao".
  const map: Record<string, { cls: string; Icon: typeof BadgeCheck; label: string }> = {
    regular: { cls: "bg-accent-on-dark/10 text-accent-on-dark", Icon: BadgeCheck, label: "Regular" },
    cancelado: { cls: "bg-destructive/10 text-destructive", Icon: ShieldX, label: "Cancelado" },
    suspenso: { cls: "bg-destructive/10 text-destructive", Icon: ShieldX, label: "Suspenso" },
    pendenteverificacao: { cls: "bg-warning/10 text-warning", Icon: ShieldQuestion, label: "Pendente de verificação" },
    naovalidado: { cls: "bg-muted text-muted-foreground", Icon: ShieldQuestion, label: "Não validado" },
  }
  const key = (s ?? "").toLowerCase().replace(/[^a-z]/g, "")
  const v = map[key] ?? map.naovalidado
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${v.cls}`}>
      <v.Icon className="h-3 w-3" /> {v.label}
    </span>
  )
}

export default function MedicoPerfilPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string
  const [m, setM] = useState<MedicoPerfil | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState("")

  const carregar = useCallback(async () => {
    setLoading(true)
    setErro("")
    try {
      const r = await fetch(`/api/admin/medicos/${id}`)
      if (!r.ok)
        throw new Error(
          r.status === 404
            ? "Médico não encontrado."
            : "Não foi possível carregar o perfil deste médico. Verifique a conexão/sessão e tente de novo.",
        )
      setM(await r.json())
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao carregar.")
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    carregar()
  }, [carregar])

  const custoTotal = m ? m.custoConversaUsd + m.custoAgentesUsd : 0

  const kpis = m
    ? [
        { label: "Pacientes", value: m.totalPacientes, icon: Users, cls: "text-primary" },
        { label: "Mensagens (30d)", value: m.mensagensRecentes, icon: MessageSquare, cls: "text-primary" },
        { label: "Consultas", value: m.totalConsultas, icon: CalendarDays, cls: "text-accent-on-dark" },
        { label: "Check-ins respondidos", value: m.checkinsRespondidos, icon: Heart, cls: "text-accent-on-dark" },
        { label: "Crises acionadas", value: m.crisesTotal, icon: ShieldAlert, cls: m.crisesTotal ? "text-destructive" : "text-muted-foreground" },
      ]
    : []

  return (
    <div className="p-8 space-y-6 max-w-5xl">
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={() => router.push("/admin/usuarios")}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Voltar
        </Button>
        <div className="flex items-center gap-2">
          <Stethoscope className="h-5 w-5 text-primary" />
          <p className="font-mono text-xs uppercase tracking-widest text-primary">Médico</p>
        </div>
        <h1 className="text-2xl font-semibold text-foreground">{m?.nome ?? "Perfil do médico"}</h1>
      </div>

      {loading ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : erro ? (
        <div className="rounded-2xl border border-dashed border-noir-line bg-noir-surface p-16 text-center text-sm text-destructive">
          {erro}
        </div>
      ) : m ? (
        <>
          {/* Cadastro + assinatura */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-noir-line bg-noir-surface p-5 space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Cadastro · CRM</p>
                <SituacaoCrm s={m.crmSituacao} />
              </div>
              <dl className="space-y-1.5 text-sm">
                <Linha k="CRM" v={m.crm ? `${m.crm}${m.crmUf ? `/${m.crmUf}` : ""}` : "—"} />
                <Linha k="Nome no CFM" v={m.crmNomeCfm ?? "—"} />
                <Linha k="Validado em" v={data(m.crmValidadoEm)} />
                <Linha k="Especialidade" v={m.especialidade ?? "—"} />
                <Linha k="CPF" v={m.cpf ?? "—"} />
                <Linha k="E-mail" v={m.email} />
                <Linha k="Fuso" v={m.timezone ?? "—"} />
                <Linha k="Último login" v={data(m.ultimoLogin)} />
                <Linha k="Cadastrado em" v={data(m.criadoEm)} />
              </dl>
            </div>

            <div className="rounded-2xl border border-noir-line bg-noir-surface p-5 space-y-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Assinatura</p>
              {m.plano ? (
                <dl className="space-y-1.5 text-sm">
                  <Linha k="Plano" v={<span className="capitalize">{m.plano}</span>} />
                  <Linha k="Status" v={<span className="capitalize">{m.statusAssinatura ?? "—"}</span>} />
                  <Linha k="Valor mensal" v={brl(m.valorMensal, m.moeda)} />
                  <Linha k="Trial até" v={data(m.trialAte)} />
                  <Linha k="Início" v={data(m.inicioEm)} />
                </dl>
              ) : (
                <p className="text-sm text-muted-foreground">Sem assinatura cadastrada.</p>
              )}
              <div className="border-t border-noir-line pt-3">
                <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Uso de IA (USD)</p>
                <dl className="space-y-1.5 text-sm">
                  <Linha k="Conversa" v={usd(m.custoConversaUsd)} />
                  <Linha k="Agentes" v={usd(m.custoAgentesUsd)} />
                  <Linha k="Total" v={<span className="font-semibold text-warning">{usd(custoTotal)}</span>} />
                </dl>
              </div>
            </div>
          </div>

          {/* Atividade */}
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {kpis.map((k) => (
              <div key={k.label} className="rounded-2xl border border-noir-line bg-noir-surface p-5">
                <div className="flex items-center justify-between mb-3">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{k.label}</p>
                  <k.icon className={`h-4 w-4 ${k.cls}`} />
                </div>
                <p className="text-2xl font-bold text-foreground">{k.value.toLocaleString("pt-BR")}</p>
              </div>
            ))}
          </div>

          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
            <Cpu className="h-3 w-3" /> Somente metadados e contagens — sem conteúdo clínico (LGPD / clinical-safety).
          </p>
        </>
      ) : null}
    </div>
  )
}

function Linha({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="text-right text-foreground">{v}</dd>
    </div>
  )
}
