"use client"

import { useEffect, useState, type ReactNode } from "react"
import Link from "next/link"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Plus,
  Loader2,
  AlertTriangle,
  MailCheck,
  KeyRound,
  LogIn,
} from "lucide-react"
import { CampoCopiavel } from "./campo-copiavel"

// ── Máscaras ─────────────────────────────────────────────────────────────────
function mascaraWhatsApp(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 13)
  if (d.length <= 2) return d
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`
}
function mascaraCpf(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 11)
  if (d.length <= 3) return d
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}
function somenteDigitos(val: string) {
  return val.replace(/\D/g, "")
}

// ── Schema ────────────────────────────────────────────────────────────────────
const schema = z
  .object({
    nome: z.string().trim().min(2, "Nome obrigatório (mínimo 2 caracteres)"),
    email: z.string().trim().email("E-mail inválido"),
    whatsapp: z
      .string()
      .transform(somenteDigitos)
      .pipe(
        z
          .string()
          .min(10, "WhatsApp inválido (10–13 dígitos com DDD)")
          .max(13, "WhatsApp inválido (10–13 dígitos com DDD)"),
      ),
    cpf: z
      .string()
      .optional()
      .transform((v) => (v ? somenteDigitos(v) : ""))
      .pipe(
        z
          .string()
          .refine((v) => v === "" || v.length === 11, "CPF inválido (11 dígitos)"),
      ),
    nascimento: z.string().optional(),
    usarSenha: z.boolean().default(false),
    senha: z.string().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.usarSenha && (!d.senha || d.senha.length < 6)) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_small,
        minimum: 6,
        type: "string",
        inclusive: true,
        message: "Senha provisória precisa ter ao menos 6 caracteres",
        path: ["senha"],
      })
    }
  })

type FormValues = z.infer<typeof schema>

interface ResultadoCriacao {
  pacienteId: string
  // "magic_link" (só convite por e-mail) ou "magic_link_e_senha" (e-mail + senha extra).
  modo: string
  emailEnviado: boolean
  emailErro: string | null
  magicLinkUrl: string | null
  senhaProvisoria: string | null
}

// ── Auth status (pre-check no open) ──────────────────────────────────────────
type AuthStatus = "checking" | "ok" | "sessao_expirada" | "sem_conta_medico" | "erro_conexao"

function useAuthCheck(aberto: boolean): AuthStatus {
  const [status, setStatus] = useState<AuthStatus>("checking")
  useEffect(() => {
    if (!aberto) {
      setStatus("checking")
      return
    }
    setStatus("checking")
    fetch("/api/me")
      .then((r) => {
        if (r.ok) return setStatus("ok")
        if (r.status === 401) return setStatus("sessao_expirada")
        if (r.status === 403) return setStatus("sem_conta_medico")
        setStatus("erro_conexao")
      })
      .catch(() => setStatus("erro_conexao"))
  }, [aberto])
  return status
}

// ── Error de auth ─────────────────────────────────────────────────────────────
const AUTH_MSG: Record<string, { titulo: string; desc: string; link?: string }> = {
  sessao_expirada: {
    titulo: "Sessão expirada",
    desc: "Sua sessão expirou ou foi aberta em outro dispositivo. Faça login novamente.",
    link: "/login",
  },
  sem_conta_medico: {
    titulo: "Conta não configurada",
    desc: "O sistema ainda não foi inicializado com uma conta de médico. Execute o endpoint /api/v1/seed/primeiro-medico.",
  },
  erro_conexao: {
    titulo: "Sem conexão com o servidor",
    desc: "Não foi possível verificar sua sessão. Verifique se o gateway está rodando (API_GATEWAY_URL).",
  },
}

// ── Componente principal ──────────────────────────────────────────────────────
export function NovoPacienteDialog({ onConcluido, trigger }: { onConcluido: () => void; trigger?: ReactNode }) {
  const [aberto, setAberto] = useState(false)
  const [resultado, setResultado] = useState<ResultadoCriacao | null>(null)
  const [erroServidor, setErroServidor] = useState<string | null>(null)

  const authStatus = useAuthCheck(aberto)

  const {
    register,
    handleSubmit,
    control,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { usarSenha: false },
  })

  const usarSenha = watch("usarSenha")

  function fechar() {
    setAberto(false)
    setResultado(null)
    setErroServidor(null)
    reset()
  }

  async function onSubmit(values: FormValues) {
    setErroServidor(null)
    try {
      const r = await fetch("/api/pacientes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: values.nome,
          email: values.email,
          waId: values.whatsapp,
          cpf: values.cpf || null,
          dataNascimento: values.nascimento || null,
          senhaInicial: values.usarSenha ? values.senha : null,
        }),
      })
      const data = await r.json().catch(() => null)
      if (!r.ok) {
        if (r.status === 401)
          setErroServidor("Sessão expirada — faça logout e login novamente.")
        else if (r.status === 403)
          setErroServidor("Sem permissão. Conta não está configurada como médico.")
        else if (r.status === 402)
          setErroServidor("Assinatura inativa — regularize o pagamento para cadastrar pacientes (Conta → Minha assinatura).")
        else if (r.status === 409)
          setErroServidor(data?.message ?? "Paciente já cadastrado com este e-mail ou CPF.")
        else
          setErroServidor(data?.error ?? data?.message ?? "Não foi possível cadastrar o paciente.")
        return
      }
      setResultado(data as ResultadoCriacao)
      onConcluido()
    } catch {
      setErroServidor("Erro de conexão. Tente novamente.")
    }
  }

  const authInfo = authStatus !== "ok" && authStatus !== "checking" ? AUTH_MSG[authStatus] : null

  return (
    <Dialog
      open={aberto}
      onOpenChange={(o) => {
        setAberto(o)
        if (!o) fechar()
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button className="bg-primary hover:bg-purple-dark text-primary-foreground gap-2">
            <Plus className="h-4 w-4" />
            Novo Paciente
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-foreground">Novo paciente</DialogTitle>
          <DialogDescription>
            Cadastre o paciente e envie o convite de acesso ao portal.
          </DialogDescription>
        </DialogHeader>

        {/* ── Auth pre-check ── */}
        {authStatus === "checking" && (
          <div className="flex justify-center py-6 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}

        {authInfo && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div>
                <p className="font-medium text-destructive">{authInfo.titulo}</p>
                <p className="text-muted-foreground mt-0.5">{authInfo.desc}</p>
              </div>
            </div>
            {authInfo.link && (
              <Button className="w-full gap-2 bg-primary hover:bg-purple-dark text-primary-foreground" asChild>
                <Link href={authInfo.link}>
                  <LogIn className="h-4 w-4" /> Fazer login
                </Link>
              </Button>
            )}
          </div>
        )}

        {/* ── Resultado de criação ── */}
        {authStatus === "ok" && resultado && (
          <div className="space-y-4">
            {/* Convite por e-mail — todo cadastro envia. */}
            {resultado.emailEnviado ? (
              <div className="flex items-start gap-3 rounded-lg bg-success/10 p-3">
                <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" />
                <div className="text-sm">
                  <p className="font-medium text-foreground">Convite enviado</p>
                  <p className="text-muted-foreground">
                    O paciente recebeu um e-mail com o link para criar a senha (válido por 24h).
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-start gap-2 rounded-lg bg-warning/10 p-3 text-sm text-warning">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    {resultado.magicLinkUrl
                      ? "Não foi possível enviar o e-mail. Copie e envie o link manualmente:"
                      : "Não foi possível enviar o e-mail nem gerar o link agora. Use “Reenviar link” na lista do paciente."}
                  </span>
                </div>
                {resultado.magicLinkUrl && <CampoCopiavel valor={resultado.magicLinkUrl} />}
              </div>
            )}

            {/* Senha provisória — opcional, ADICIONAL ao e-mail. */}
            {resultado.senhaProvisoria && (
              <div className="space-y-2">
                <div className="flex items-start gap-3 rounded-lg bg-secondary/60 p-3">
                  <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <div className="text-sm">
                    <p className="font-medium text-foreground">Senha provisória (opcional)</p>
                    <p className="text-muted-foreground">
                      Além do e-mail, você pode entregar esta senha. O paciente troca no primeiro acesso.
                    </p>
                  </div>
                </div>
                <CampoCopiavel valor={resultado.senhaProvisoria} />
              </div>
            )}

            <DialogFooter>
              <Button className="bg-primary hover:bg-purple-dark text-primary-foreground" onClick={fechar}>
                Concluir
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* ── Formulário ── */}
        {authStatus === "ok" && !resultado && (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {erroServidor && (
              <div className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{erroServidor}</span>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* Nome */}
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="np-nome">Nome completo</Label>
                <Input id="np-nome" {...register("nome")} />
                {errors.nome && (
                  <p className="text-xs text-destructive">{errors.nome.message}</p>
                )}
              </div>

              {/* E-mail */}
              <div className="space-y-1.5">
                <Label htmlFor="np-email">E-mail</Label>
                <Input id="np-email" type="email" {...register("email")} />
                {errors.email && (
                  <p className="text-xs text-destructive">{errors.email.message}</p>
                )}
              </div>

              {/* WhatsApp com máscara */}
              <div className="space-y-1.5">
                <Label htmlFor="np-wa">WhatsApp (com DDD)</Label>
                <Controller
                  control={control}
                  name="whatsapp"
                  render={({ field }) => (
                    <Input
                      id="np-wa"
                      inputMode="numeric"
                      placeholder="(11) 99999-8888"
                      value={mascaraWhatsApp(field.value ?? "")}
                      onChange={(e) => field.onChange(e.target.value)}
                      onBlur={field.onBlur}
                    />
                  )}
                />
                {errors.whatsapp && (
                  <p className="text-xs text-destructive">{errors.whatsapp.message}</p>
                )}
              </div>

              {/* CPF com máscara */}
              <div className="space-y-1.5">
                <Label htmlFor="np-cpf">CPF (opcional)</Label>
                <Controller
                  control={control}
                  name="cpf"
                  render={({ field }) => (
                    <Input
                      id="np-cpf"
                      inputMode="numeric"
                      placeholder="000.000.000-00"
                      value={mascaraCpf(field.value ?? "")}
                      onChange={(e) => field.onChange(e.target.value)}
                      onBlur={field.onBlur}
                    />
                  )}
                />
                {errors.cpf && (
                  <p className="text-xs text-destructive">{errors.cpf.message}</p>
                )}
              </div>

              {/* Nascimento */}
              <div className="space-y-1.5">
                <Label htmlFor="np-nasc">Nascimento (opcional)</Label>
                <Input id="np-nasc" type="date" {...register("nascimento")} />
              </div>
            </div>

            {/* Modo de acesso */}
            <Controller
              control={control}
              name="usarSenha"
              render={({ field }) => (
                <div className="flex items-center justify-between rounded-lg border border-border/60 p-3">
                  <div className="text-sm">
                    <p className="font-medium text-foreground">
                      Também definir uma senha provisória
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {field.value
                        ? "O paciente recebe o convite por e-mail E você também entrega esta senha (troca no 1º acesso)."
                        : "Opcional. O convite por e-mail (magic link de 24h) é sempre enviado ao paciente."}
                    </p>
                  </div>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    aria-label="Também definir uma senha provisória"
                  />
                </div>
              )}
            />

            {usarSenha && (
              <div className="space-y-1.5">
                <Label htmlFor="np-senha">Senha provisória</Label>
                <Input
                  id="np-senha"
                  type="text"
                  placeholder="Mínimo 6 caracteres"
                  {...register("senha")}
                />
                {errors.senha && (
                  <p className="text-xs text-destructive">{errors.senha.message}</p>
                )}
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={fechar}>
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="bg-primary hover:bg-purple-dark text-primary-foreground"
              >
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Cadastrar"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
