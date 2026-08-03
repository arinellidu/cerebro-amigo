"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { KeyRound, Mail, Loader2, AlertCircle, CheckCircle2 } from "lucide-react"
import { CampoCopiavel } from "./campo-copiavel"

interface ResultadoLink {
  enviado: boolean
  email: string
  url: string | null
}

/** Reenvia o link de acesso de um paciente existente (recuperação de senha
 *  conduzida pelo médico). O gateway ENVIA o link por e-mail ao próprio paciente —
 *  o médico não recebe a URL. O paciente abre o link e define a própria senha; o
 *  médico nunca escolhe/sabe a senha. Tenant + rate-limit garantidos no gateway.
 *  Só quando o e-mail falha o gateway devolve a URL como fallback pro médico. */
export function ReenviarLinkButton({ email, nome }: { email: string; nome: string }) {
  const [aberto, setAberto] = useState(false)
  const [loading, setLoading] = useState(false)
  const [resultado, setResultado] = useState<ResultadoLink | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  function reset() {
    setResultado(null)
    setErro(null)
  }

  async function enviar() {
    setLoading(true)
    reset()
    try {
      const r = await fetch("/api/pacientes/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      })
      const data = await r.json().catch(() => null)
      if (!r.ok) {
        setErro(data?.error ?? "Não foi possível gerar o link.")
        return
      }
      setResultado({
        enviado: Boolean(data?.enviado),
        email: data?.email ?? email,
        url: data?.url ?? null,
      })
    } catch {
      setErro("Sem conexão com o servidor.")
    } finally {
      setLoading(false)
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
        <Button
          variant="ghost"
          size="icon"
          title="Reenviar link de acesso"
          aria-label="Reenviar link de acesso"
          className="h-8 w-8 text-muted-foreground hover:text-primary"
          onClick={(e) => e.stopPropagation()}
        >
          <KeyRound className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Link de acesso — {nome}</DialogTitle>
          <DialogDescription>
            Enviaremos um link de redefinição de senha (validade 1h) para{" "}
            <strong>{email}</strong>. O paciente abre o link e cria a própria senha —
            você não precisa repassar nada.
          </DialogDescription>
        </DialogHeader>

        {erro && (
          <div className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{erro}</span>
          </div>
        )}

        {resultado?.enviado && (
          <div className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-foreground">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            <span>
              E-mail enviado para <strong>{resultado.email}</strong>. Peça ao paciente
              para verificar a caixa de entrada (e o spam).
            </span>
          </div>
        )}

        {resultado && !resultado.enviado && (
          <div className="space-y-2">
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Não conseguimos enviar o e-mail agora. Entregue este link ao paciente
                por um canal seguro (expira em 1 hora):
              </span>
            </div>
            {resultado.url && <CampoCopiavel valor={resultado.url} />}
          </div>
        )}

        {!resultado && (
          <Button onClick={enviar} disabled={loading} className="w-full gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
            Enviar link por e-mail
          </Button>
        )}
      </DialogContent>
    </Dialog>
  )
}
