"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { AuthShell } from "@/components/public/public-chrome"
import { Loader2, MailCheck } from "lucide-react"

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSending(true)
    try { await fetch("/api/esqueci-senha", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim() }) }) }
    catch { /* Always keep the response generic to prevent account enumeration. */ }
    finally { setSending(false); setSent(true) }
  }

  return (
    <AuthShell eyebrow="ACCOUNT RECOVERY / PHYSICIAN" title={<>Recover your <em>secure access.</em></>} description="Request a time-limited password reset link for your physician account." context={["The response never confirms whether an account exists", "Reset links expire after one hour", "Existing sessions remain protected"]}>
      <div>
        {sent ? <div className="space-y-4 text-center"><MailCheck className="mx-auto h-10 w-10 text-success" /><h2 className="text-xl font-semibold">Check your email</h2><p className="text-sm text-muted-foreground">If an account exists for this email, we sent a password-reset link. The link is valid for one hour.</p><Link className="inline-block text-sm underline" href="/login">Back to sign in</Link></div> :
          <form onSubmit={submit} className="space-y-5"><div><h2 className="text-xl font-semibold">Request a reset link</h2><p className="mt-1 text-sm text-muted-foreground">Enter the email linked to your account.</p></div><div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" /></div><Button type="submit" className="w-full" disabled={sending || !email.trim()}>{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send reset link"}</Button><p className="text-center text-sm"><Link href="/login">Back to sign in</Link></p></form>}
      </div>
    </AuthShell>
  )
}
