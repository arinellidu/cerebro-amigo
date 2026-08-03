import Link from "next/link"
import { PublicFooter, PublicHeader } from "@/components/public/public-chrome"
import { RuntimeDisclosure } from "@/components/public/runtime-disclosure"
import access from "@/components/access/signal-access.module.css"
import styles from "@/components/public/public-surface.module.css"

export const metadata = { title: "Privacy Policy — Cérebro Amigo", description: "Cérebro Amigo privacy policy", alternates: { canonical: "https://www.cerebroamigo.com.br/privacy" } }

export default function PrivacyPage() {
  return (
    <main className={`${access.page} ${styles.contentPage}`} lang="en">
      <PublicHeader />
      <div className={styles.legalWrap}>
        <aside className={styles.legalAside}>
          <p>POLICY / DATA BOUNDARY</p><h1>Privacy policy</h1><p>Last updated: July 2026</p>
        </aside>
        <div className={styles.legalBody}>
          <section><h2>1. Portfolio demonstration</h2><p>The public Cérebro Amigo environment is a technical portfolio demonstration, not an active medical service. Its scenarios, accounts and records use fictional, reproducible demo data. Do not enter real patient information, health information or other sensitive personal data.</p></section>
          <section><h2>2. Current hosting and location</h2><p>The frontend runs on Vercel. Backend services and Azure Database for PostgreSQL run in Azure’s <strong>eastus2</strong> region in the United States. This portfolio environment does not make a Brazilian data-residency claim. AWS documentation in the repository describes previous or reference architecture and is not part of the current public request path.</p></section>
          <section><h2>3. Data that may be processed</h2><p>Ordinary technical and contact data—such as request metadata, security logs, email correspondence or account identifiers—may be processed to operate and protect the demonstration. Demo clinical records are fictional. Real clinical use is outside the permitted scope of this environment.</p></section>
          <section><h2>4. Artificial intelligence and safeguards</h2><p>Language models may support demonstration flows for organization and summarization. The system does not diagnose, prescribe or change medication doses. Crisis messaging remains fixed and human-approved rather than generated dynamically by AI.</p></section>
          <section><h2>5. Security and LGPD</h2><p>Controls demonstrated by the project include encryption, tenant isolation, minimized access and immutable audit trails. Brazil’s LGPD may apply to identifiable visitor, contact or account data according to the circumstances; this policy does not turn the portfolio environment into a clinical service.</p></section>
          <section><h2>6. Rights and contact</h2><p>Requests concerning access, correction, anonymization or deletion of applicable personal data can be sent to <Link href="mailto:arinpar@gmail.com">arinpar@gmail.com</Link>.</p></section>
        </div>
      </div>
      <RuntimeDisclosure />
      <PublicFooter />
    </main>
  )
}
