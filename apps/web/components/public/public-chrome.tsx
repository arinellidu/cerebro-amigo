import Link from "next/link"
import { ArrowRight, HeartHandshake } from "lucide-react"
import { Logo } from "@/components/logo"
import access from "@/components/access/signal-access.module.css"
import styles from "./public-surface.module.css"

type AuthShellProps = {
  eyebrow: string
  title: React.ReactNode
  description: string
  children: React.ReactNode
  context?: string[]
}

export function PublicHeader({ actionHref = "/login", actionLabel = "Physician sign in" }) {
  return (
    <header className={access.header}>
      <Link href="/" className={access.brand} aria-label="Cérebro Amigo home">
        <Logo size="md" variant="light" />
      </Link>
      <nav className={access.nav} aria-label="Primary navigation">
        <Link href="/medico">For physicians</Link>
        <Link href="/paciente">For patients</Link>
        <Link href="/precos">Pricing</Link>
        <Link href="/sobre">About</Link>
      </nav>
      <Link href={actionHref} className={`${access.headerAction} ${styles.mobileAction}`}>
        {actionLabel} <ArrowRight aria-hidden="true" />
      </Link>
    </header>
  )
}

export function PublicFooter() {
  return (
    <footer className={access.footer}>
      <div>
        <Link href="/sobre">About</Link>
        <Link href="/precos">Pricing</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="mailto:arinpar@gmail.com">Contact</Link>
      </div>
      <Link href="/" aria-label="Cérebro Amigo home">
        <Logo size="sm" variant="light" />
      </Link>
      <p>
        <HeartHandshake aria-hidden="true" /> Human judgment remains the boundary
      </p>
    </footer>
  )
}

export function AuthShell({ eyebrow, title, description, children, context = [] }: AuthShellProps) {
  return (
    <main className={`${access.page} ${styles.authPage}`} lang="en">
      <a className={access.skipLink} href="#access-form">Skip to form</a>
      <PublicHeader actionHref="/" actionLabel="Back to system" />
      <section className={styles.authGrid}>
        <div className={styles.authIntro}>
          <p className={styles.kicker}>{eyebrow}</p>
          <h1>{title}</h1>
          <p>{description}</p>
          {context.length > 0 && (
            <ul>
              {context.map((item, index) => (
                <li key={item}><span>0{index + 1}</span>{item}</li>
              ))}
            </ul>
          )}
        </div>
        <div className={styles.authPanel} id="access-form" tabIndex={-1}>
          <div className={styles.panelRail}><span>SECURE ACCESS</span><span>ENCRYPTED SESSION</span></div>
          {children}
        </div>
      </section>
      <PublicFooter />
    </main>
  )
}
