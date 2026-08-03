import Link from "next/link"
import { AuthShell } from "@/components/public/public-chrome"
import { EntrarForm } from "./entrar-form"

export default async function PatientSignInPage({ searchParams }: { searchParams: Promise<{ token?: string; next?: string }> }) {
  const sp = await searchParams
  const next = sp.next?.startsWith("/p") ? sp.next : "/p"
  const demoEnabled = Boolean(process.env.DEMO_LOGIN_PASSWORD)
  return (
    <AuthShell
      eyebrow={sp.token ? "PATIENT ACCESS / ACTIVATION" : "PATIENT ACCESS / AUTH"}
      title={sp.token ? <>Activate your <em>private space.</em></> : <>Continue your <em>care timeline.</em></>}
      description="A private channel for check-ins, journal entries, and the information you choose to share between appointments."
      context={["Access begins with a physician invitation", "Your entries remain part of your care context", "Clinical decisions always remain with your physician"]}
    >
      <div>
        <h2 className="text-xl font-semibold text-foreground">{sp.token ? "Create your password" : "Explore the patient portal"}</h2>
        <p className="mb-6 mt-1 text-sm text-muted-foreground">{sp.token ? "Complete your invitation to enter the portal." : "Enter the fictional account in one click, or use your own invitation."}</p>
        <EntrarForm token={sp.token} next={next} demoEnabled={demoEnabled} />
        <p className="mt-6 text-xs text-muted-foreground">In a crisis, call <a href="tel:188">CVV 188</a> (24/7) or <a href="tel:192">SAMU 192</a>.</p>
        <p className="mt-3 text-xs text-muted-foreground">Are you a physician? <Link href="/login">Use physician sign in</Link>.</p>
      </div>
    </AuthShell>
  )
}
