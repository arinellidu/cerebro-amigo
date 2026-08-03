import Link from "next/link"
import { PublicFooter, PublicHeader } from "@/components/public/public-chrome"
import { RuntimeDisclosure } from "@/components/public/runtime-disclosure"
import access from "@/components/access/signal-access.module.css"
import styles from "@/components/public/public-surface.module.css"

export const metadata = { title: "Terms of Use — Cérebro Amigo", description: "Cérebro Amigo terms of use", alternates: { canonical: "https://www.cerebroamigo.com.br/terms" } }

export default function TermsPage() {
  return (
    <main className={`${access.page} ${styles.contentPage}`} lang="en">
      <PublicHeader />
      <div className={styles.legalWrap}>
        <aside className={styles.legalAside}><p>TERMS / OPERATING BOUNDARY</p><h1>Terms of use</h1><p>Last updated: July 2026</p></aside>
        <div className={styles.legalBody}>
          <section><h2>1. Nature of this environment</h2><p>Cérebro Amigo is presented publicly as a technical portfolio demonstration. It is not an active medical service, emergency channel, diagnostic tool or prescribing service. Every scenario and clinical record in the public demonstration is fictional.</p></section>
          <section><h2>2. Permitted use</h2><p>You may inspect the product and its architecture for evaluation purposes. Do not submit real patient information, health information or other sensitive personal data. Do not rely on the demonstration for care, diagnosis, treatment or emergency assistance.</p></section>
          <section><h2>3. Runtime and data location</h2><p>The frontend runs on Vercel; backend services and Azure PostgreSQL run in Azure <strong>eastus2</strong> in the United States. The current portfolio runtime makes no Brazilian data-residency promise. AWS is previous or reference architecture only.</p></section>
          <section><h2>4. Privacy and responsibility</h2><p>See the <Link href="/privacy">Privacy Policy</Link> for the limited data processed to operate the demonstration. AI does not replace clinical judgment, and the portfolio is provided without a guarantee of uninterrupted availability.</p></section>
          <section><h2>5. Contact</h2><p>Questions about these terms can be sent to <Link href="mailto:arinpar@gmail.com">arinpar@gmail.com</Link>.</p></section>
        </div>
      </div>
      <RuntimeDisclosure />
      <PublicFooter />
    </main>
  )
}
