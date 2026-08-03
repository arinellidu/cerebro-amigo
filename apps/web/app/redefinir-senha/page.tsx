"use client"

import { Suspense, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { AuthShell } from "@/components/public/public-chrome"
import { CheckCircle2, Loader2 } from "lucide-react"

const errors: Record<string, string> = { token_invalido: "Invalid link. Request a new one.", token_ja_utilizado: "This link has already been used.", senha_curta: "Your password must contain at least 8 characters.", dados_invalidos: "Invalid data." }

function ResetForm() {
  const token = useSearchParams().get("token") ?? ""
  const [password, setPassword] = useState(""); const [confirmation, setConfirmation] = useState(""); const [sending, setSending] = useState(false); const [done, setDone] = useState(false); const [error, setError] = useState<string | null>(null)
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(null)
    if (password.length < 8) return setError("Your password must contain at least 8 characters.")
    if (password !== confirmation) return setError("The passwords do not match.")
    setSending(true)
    try { const response = await fetch("/api/redefinir-senha", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, novaSenha: password }) }); if (response.ok || response.status === 204) setDone(true); else if (response.status === 410) setError("This link has expired. Request a new one."); else { const data = await response.json().catch(() => null); setError(errors[data?.error] ?? "We could not reset your password.") } }
    catch { setError("Connection error. Please try again.") } finally { setSending(false) }
  }
  if (!token) return <p className="text-sm text-destructive">Invalid link. <Link href="/esqueci-senha">Request another</Link>.</p>
  if (done) return <div className="space-y-4 text-center"><CheckCircle2 className="mx-auto h-10 w-10 text-success" /><h2 className="text-xl font-semibold">Password updated</h2><p className="text-sm text-muted-foreground">You can now sign in with your new password.</p><Link href="/login">Go to sign in</Link></div>
  return <form onSubmit={submit} className="space-y-5"><div><h2 className="text-xl font-semibold">Create a new password</h2><p className="mt-1 text-sm text-muted-foreground">Use at least eight characters.</p></div><div className="space-y-2"><Label htmlFor="new-password">New password</Label><Input id="new-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /></div><div className="space-y-2"><Label htmlFor="confirm-password">Confirm password</Label><Input id="confirm-password" type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" /></div><Button type="submit" className="w-full" disabled={sending || !password}>{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reset password"}</Button>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}</form>
}
export default function ResetPasswordPage() {
  return <AuthShell eyebrow="ACCOUNT RECOVERY / RESET" title={<>Set a new <em>access key.</em></>} description="The reset token is verified server-side before your password changes." context={["Time-limited reset token", "Minimum eight-character password", "Return to physician sign in when complete"]}><div><Suspense fallback={<div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin" /></div>}><ResetForm /></Suspense></div></AuthShell>
}
