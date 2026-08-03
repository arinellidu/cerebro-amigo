"use client"

import { useActionState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, Mail } from "lucide-react"
import { esqueciSenha, type EsqueciSenhaState } from "./actions"

const inicial: EsqueciSenhaState = { ok: false, msg: null }

/** Fluxo "Esqueci minha senha" do paciente. Pede o e-mail e dispara o envio do
 *  link de recuperação. Resposta sempre neutra (anti-enumeração): nunca diz se o
 *  e-mail existe. */
export function EsqueciSenhaForm({ onVoltar }: { onVoltar: () => void }) {
  const [state, action, pending] = useActionState(esqueciSenha, inicial)

  if (state.ok) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-foreground">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          <span>{state.msg}</span>
        </div>
        <Button type="button" variant="ghost" className="w-full gap-2" onClick={onVoltar}>
          <ArrowLeft className="h-4 w-4" />
          Back to sign in
        </Button>
      </div>
    )
  }

  return (
    <form action={action} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Enter the email linked to your access. We will send a link to create a new password.
      </p>

      {state.msg && (
        <div className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{state.msg}</span>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="email-reset">Email</Label>
        <Input
          id="email-reset"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          className="h-11 rounded-xl bg-noir-surface-raised/60"
          required
        />
      </div>

      <Button
        type="submit"
        disabled={pending}
        className="portal-tap h-11 w-full gap-2 rounded-xl bg-primary text-primary-foreground hover:bg-purple-dark"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
        Send recovery link
      </Button>

      <Button type="button" variant="ghost" className="w-full gap-2" onClick={onVoltar}>
        <ArrowLeft className="h-4 w-4" />
        Back to sign in
      </Button>
    </form>
  )
}
