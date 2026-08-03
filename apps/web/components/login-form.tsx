"use client"

import { useActionState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Mail, Lock, ArrowRight } from "lucide-react"
import { loginAction } from "@/app/actions"

export function LoginForm() {
  const searchParams = useSearchParams()
  const next = searchParams.get("next") ?? "/dashboard"

  const [state, formAction, isPending] = useActionState(loginAction, {
    error: null,
    next,
  })

  return (
    <form className="space-y-4" action={formAction}>
      <div className="space-y-2">
        <Label htmlFor="email" className="text-foreground">Email</Label>
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="you@example.com"
            className="pl-9 focus-visible:ring-primary"
            required
            autoComplete="email"
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password" className="text-foreground">Password</Label>
          <Link
            href="/esqueci-senha"
            className="text-xs text-primary hover:text-purple-dark transition-colors"
          >
            Forgot password?
          </Link>
        </div>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            id="password"
            name="senha"
            type="password"
            placeholder="••••••••"
            className="pl-9 focus-visible:ring-primary"
            required
            autoComplete="current-password"
          />
        </div>
      </div>

      {state?.error && (
        <p role="alert" className="text-sm text-destructive bg-destructive/5 px-3 py-2 rounded-md">
          {state.error}
        </p>
      )}

      <Button
        type="submit"
        className="w-full bg-primary hover:bg-purple-dark text-primary-foreground gap-2"
        disabled={isPending}
      >
        {isPending ? "Signing in..." : "Sign in"}
        {!isPending && <ArrowRight className="h-4 w-4" />}
      </Button>
    </form>
  )
}
