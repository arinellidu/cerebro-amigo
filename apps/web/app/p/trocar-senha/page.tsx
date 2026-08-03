"use client"

import { useActionState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AlertCircle, Loader2, ShieldCheck } from "lucide-react"
import { trocarSenha, type PacienteAuthState } from "./actions"

const inicial: PacienteAuthState = { error: null }

export default function TrocarSenhaPage() {
  const [state, action, pending] = useActionState(trocarSenha, inicial)

  return (
    <div className="relative flex min-h-screen flex-col justify-center overflow-hidden px-6 py-12">
      <div className="portal-aura" aria-hidden />
      <div className="relative z-10 mx-auto w-full max-w-sm space-y-7">
        <div className="space-y-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/15 text-primary ring-1 ring-primary/20">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div>
            <p className="portal-eyebrow">Security</p>
            <h1 className="portal-display mt-2 text-[1.6rem] font-medium leading-tight text-foreground">
              Set a new password
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              You are using a temporary password. Create a personal password to continue.
            </p>
          </div>
        </div>

        <form
          action={action}
          className="portal-card portal-hairline relative space-y-4 p-6"
        >
          {state.error && (
            <div className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{state.error}</span>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="senhaAtual">Current temporary password</Label>
            <Input
              id="senhaAtual"
              name="senhaAtual"
              type="password"
              autoComplete="current-password"
              className="h-11 rounded-xl bg-noir-surface-raised/60"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="novaSenha">New password</Label>
            <Input
              id="novaSenha"
              name="novaSenha"
              type="password"
              autoComplete="new-password"
              placeholder="At least 8 characters"
              className="h-11 rounded-xl bg-noir-surface-raised/60"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmar">Confirm new password</Label>
            <Input
              id="confirmar"
              name="confirmar"
              type="password"
              autoComplete="new-password"
              className="h-11 rounded-xl bg-noir-surface-raised/60"
              required
            />
          </div>

          <Button
            type="submit"
            disabled={pending}
            className="portal-tap h-11 w-full rounded-xl bg-primary text-primary-foreground hover:bg-purple-dark"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save new password"}
          </Button>
        </form>
      </div>
    </div>
  )
}
