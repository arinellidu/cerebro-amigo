"use client"

import { useActionState, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AlertCircle, ArrowRight, KeyRound, Loader2, LockKeyhole, Mail, UserRound } from "lucide-react"
import { entrarComLink, entrarComoPacienteDemo, entrarComSenha, type PacienteAuthState } from "./actions"
import { EsqueciSenhaForm } from "./esqueci-senha-form"

const inicial: PacienteAuthState = { error: null }

const PortfolioProfile = () => {
  return (
    <div className="rounded-2xl border border-primary/20 bg-primary/[0.07] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/20">
          <UserRound className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[0.65rem] font-semibold tracking-[0.18em] text-primary">FICTIONAL PORTFOLIO PROFILE</p>
          <p className="mt-1 text-sm font-semibold text-foreground">Aurora · patient portal</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            A ready-to-use synthetic account with medication, mood, journal, and appointment examples.
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 border-t border-primary/15 pt-3 text-xs">
        <div>
          <span className="block text-muted-foreground">Login</span>
          <span className="mt-0.5 block font-medium text-foreground">Already selected</span>
        </div>
        <div>
          <span className="block text-muted-foreground">Password</span>
          <span className="mt-0.5 flex items-center gap-1.5 font-medium text-foreground">
            <LockKeyhole className="h-3 w-3 text-primary" aria-hidden="true" /> Loaded securely
          </span>
        </div>
      </div>
    </div>
  )
}

const FictionalPatientAccess = ({ next, enabled, onOtherAccount }: { next: string; enabled: boolean; onOtherAccount: () => void }) => {
  const [state, action, pending] = useActionState(entrarComoPacienteDemo, inicial)

  return (
    <div className="space-y-5">
      <form action={action} className="space-y-4">
        <input type="hidden" name="next" value={next} />
        <PortfolioProfile />

        {state.error && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{state.error}</span>
          </div>
        )}

        <Button
          type="submit"
          disabled={pending || !enabled}
          className="portal-tap h-11 w-full rounded-xl bg-primary text-primary-foreground hover:bg-purple-dark"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : (
            <>Enter fictional patient portal <ArrowRight className="h-4 w-4" /></>
          )}
        </Button>

        <p className="text-center text-[0.7rem] leading-relaxed text-muted-foreground">
          No real patient data. The shared credential stays server-side.
        </p>
      </form>

      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        <span className="text-[0.65rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <button
        type="button"
        onClick={onOtherAccount}
        className="flex w-full items-center justify-center gap-2 text-sm font-medium text-foreground transition-colors hover:text-primary"
      >
        Use a different patient account <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  )
}

const InvitationAccess = ({ token, next }: { token: string; next: string }) => {
  const [state, action, pending] = useActionState(entrarComLink, inicial)

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="token" value={token} />

      {state.error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        Create a password to access your care timeline.
      </p>
      <div className="space-y-2">
        <Label htmlFor="novaSenha">Create a password</Label>
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
        <Label htmlFor="confirmar">Confirm password</Label>
        <Input
          id="confirmar"
          name="confirmar"
          type="password"
          autoComplete="new-password"
          placeholder="Repeat your password"
          className="h-11 rounded-xl bg-noir-surface-raised/60"
          required
        />
      </div>

      <Button
        type="submit"
        disabled={pending}
        className="portal-tap h-11 w-full rounded-xl bg-primary text-primary-foreground hover:bg-purple-dark"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : (
          <>
            <KeyRound className="mr-2 h-4 w-4" />
            Create password and sign in
          </>
        )}
      </Button>
    </form>
  )
}

const PatientPasswordAccess = ({ next, onBack, onForgot }: { next: string; onBack: () => void; onForgot: () => void }) => {
  const [state, action, pending] = useActionState(entrarComSenha, inicial)

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />

      {state.error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          className="h-11 rounded-xl bg-noir-surface-raised/60"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="senha">Password</Label>
        <Input
          id="senha"
          name="senha"
          type="password"
          autoComplete="current-password"
          placeholder="Your password"
          className="h-11 rounded-xl bg-noir-surface-raised/60"
          required
        />
      </div>

      <Button
        type="submit"
        disabled={pending}
        className="portal-tap h-11 w-full rounded-xl bg-primary text-primary-foreground hover:bg-purple-dark"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : (
          <><Mail className="mr-2 h-4 w-4" /> Sign in</>
        )}
      </Button>

      <div className="space-y-2 text-center">
        <button type="button" onClick={onBack} className="block w-full text-xs font-medium text-primary underline-offset-2 hover:underline">
          Back to one-click fictional access
        </button>
        <button type="button" onClick={onForgot} className="text-xs text-primary underline-offset-2 hover:underline">
          Forgot my password
        </button>
        <p className="text-xs text-muted-foreground">
          Received an invitation by email? Open its link to create your password.
        </p>
      </div>
    </form>
  )
}

export const EntrarForm = ({ token, next, demoEnabled }: { token?: string; next: string; demoEnabled: boolean }) => {
  const [view, setView] = useState<"demo" | "credentials" | "forgot">("demo")

  if (token) return <InvitationAccess token={token} next={next} />
  if (view === "forgot") return <EsqueciSenhaForm onVoltar={() => setView("credentials")} />
  if (view === "credentials") {
    return (
      <PatientPasswordAccess
        next={next}
        onBack={() => setView("demo")}
        onForgot={() => setView("forgot")}
      />
    )
  }

  return (
    <FictionalPatientAccess
      next={next}
      enabled={demoEnabled}
      onOtherAccount={() => setView("credentials")}
    />
  )
}
