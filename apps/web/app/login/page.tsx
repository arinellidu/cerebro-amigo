import { Suspense } from "react"
import Link from "next/link"
import { LoginForm } from "@/components/login-form"
import { AuthShell } from "@/components/public/public-chrome"

export const metadata = { title: "Physician sign in — Cérebro Amigo", description: "Sign in to your Cérebro Amigo physician account", robots: { index: false, follow: false } }

export default function LoginPage() {
  return (
    <AuthShell
      eyebrow="PHYSICIAN ACCESS / AUTH"
      title={<>Return to the <em>clinical workspace.</em></>}
      description="Secure access for physicians and authorized clinical staff."
      context={["AI-assisted pre-appointment briefings", "Protected between-appointment follow-up", "LGPD-aligned data controls"]}
    >
      <div>
        <h2 className="text-xl font-semibold text-foreground">Welcome back</h2>
        <p className="mb-6 mt-1 text-sm text-muted-foreground">Use your physician credentials to continue.</p>
        <Suspense fallback={null}><LoginForm /></Suspense>
        <p className="mt-6 text-xs text-muted-foreground">By signing in, you agree to the <Link href="/terms">Terms of Use</Link> and <Link href="/privacy">Privacy Policy</Link>.</p>
        <p className="mt-3 text-xs text-muted-foreground">Are you a patient? <Link href="/p/entrar">Open the patient portal</Link>.</p>
      </div>
    </AuthShell>
  )
}
