"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  ArrowRight,
  BrainCircuit,
  ClipboardCheck,
  FileClock,
  House,
  LayoutDashboard,
  LogOut,
  Mic,
  Network,
  ShieldCheck,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Logo } from "@/components/logo"
import styles from "@/app/demo/demo.module.css"

type TourStep = { href: string; label: string; detail: string; icon: LucideIcon }

const physicianSteps: readonly TourStep[] = [
  { href: "/demo", label: "Dashboard", detail: "See the workspace", icon: LayoutDashboard },
  { href: "/demo/patient", label: "Patient record", detail: "Inspect the timeline", icon: FileClock },
  { href: "/demo/briefing", label: "AI briefing", detail: "Review the boundary", icon: BrainCircuit },
  { href: "/#architecture", label: "Architecture", detail: "Trace the real stack", icon: Network },
] as const

const patientSteps: readonly TourStep[] = [
  { href: "/demo/patient-app", label: "Today", detail: "See the daily rhythm", icon: House },
  { href: "/demo/patient-app/check-in", label: "Check-in", detail: "Try local interactions", icon: ClipboardCheck },
  { href: "/demo/patient-app/voice", label: "Voice journal", detail: "Simulate a recording", icon: Mic },
  { href: "/#architecture", label: "Architecture", detail: "Trace the real stack", icon: Network },
] as const

const physicianConfig = {
  mode: "physician",
  steps: physicianSteps,
  accountLabel: "PORTFOLIO DEMO ACCOUNT",
  accountName: "Dr. Morgan · fictional",
  sessionLabel: "Read-only session",
  tourLabel: "LIVE PORTFOLIO TOUR",
  exitHref: "/medico",
  boundary: "Three synthetic patients. No real health data. No write actions.",
  notice: "This resilient read-only tour does not require credentials or the clinical backend.",
} as const

const patientConfig = {
  mode: "patient",
  steps: patientSteps,
  accountLabel: "PATIENT DEMO PROFILE",
  accountName: "Aurora Demo · fictional",
  sessionLabel: "Local-only session",
  tourLabel: "PATIENT PWA TOUR",
  exitHref: "/paciente",
  boundary: "One synthetic profile. No microphone access. No stored health data.",
  notice: "Interactions stay in this browser tab. Voice recording is simulated; no audio is captured or uploaded.",
} as const

const configForPath = (pathname: string) => pathname.startsWith("/demo/patient-app") ? patientConfig : physicianConfig

const currentStep = (pathname: string, steps: readonly TourStep[]) => {
  return steps.slice(0, -1).reduce((active, step, index) => pathname.startsWith(step.href) ? index : active, 0)
}

const TourNavigation = ({ active, steps }: { active: number; steps: readonly TourStep[] }) => (
  <nav className={styles.tourNav} aria-label="Four-step product tour">
    {steps.map((step, index) => {
      const Icon = step.icon
      const selected = index === active
      return (
        <Link
          aria-current={selected ? "step" : undefined}
          className={selected ? styles.activeStep : ""}
          href={step.href}
          key={step.label}
        >
          <span className={styles.stepNumber}>{String(index + 1).padStart(2, "0")}</span>
          <Icon aria-hidden="true" />
          <span><strong>{step.label}</strong><small>{step.detail}</small></span>
        </Link>
      )
    })}
  </nav>
)

const RoleSwitch = ({ mode }: { mode: "physician" | "patient" }) => (
  <nav className={styles.roleSwitch} aria-label="Choose demo perspective">
    <Link className={mode === "physician" ? styles.activeRole : ""} href="/demo">Physician</Link>
    <Link className={mode === "patient" ? styles.activeRole : ""} href="/demo/patient-app">Patient</Link>
  </nav>
)

type DemoConfig = typeof physicianConfig | typeof patientConfig

const DemoSidebar = ({ active, config }: { active: number; config: DemoConfig }) => (
  <aside className={styles.sidebar} aria-label="Demo tour">
    <Link className={styles.brand} href="/" aria-label="Cérebro Amigo home">
      <Logo size="md" variant="light" />
    </Link>

    <div className={styles.account}>
      <span>{config.accountLabel}</span>
      <strong>{config.accountName}</strong>
      <small><ShieldCheck aria-hidden="true" /> {config.sessionLabel}</small>
    </div>

    <RoleSwitch mode={config.mode} />
    <TourNavigation active={active} steps={config.steps} />

    <div className={styles.runtimeNote}>
      <span>DEMO BOUNDARY</span>
      <p>{config.boundary}</p>
    </div>
  </aside>
)

const DemoTopbar = ({ active, config }: { active: number; config: DemoConfig }) => (
  <header className={styles.topbar}>
    <div>
      <span>{config.tourLabel}</span>
      <strong>STEP {active + 1} / 4</strong>
    </div>
    <Link href={config.exitHref}>Exit demo <LogOut aria-hidden="true" /></Link>
  </header>
)

const DemoNotice = ({ notice }: { notice: string }) => (
  <div className={styles.demoNotice} role="note">
    <ShieldCheck aria-hidden="true" />
    <p><strong>Fictional data only.</strong> {notice}</p>
  </div>
)

const NextStep = ({ step }: { step: TourStep }) => (
  <footer className={styles.nextStep}>
    <span>TOUR CONTINUES</span>
    <div><p>Next: <strong>{step.label}</strong></p><Link href={step.href}>Continue tour <ArrowRight aria-hidden="true" /></Link></div>
  </footer>
)

export const DemoShell = ({ children }: { children: React.ReactNode }) => {
  const pathname = usePathname()
  const config = configForPath(pathname)
  const active = currentStep(pathname, config.steps)
  const next = config.steps[active + 1]

  return (
    <main className={styles.demo} lang="en">
      <a className={styles.skipLink} href="#demo-content">Skip to demo content</a>
      <DemoSidebar active={active} config={config} />

      <section className={styles.workspace}>
        <DemoTopbar active={active} config={config} />
        <DemoNotice notice={config.notice} />

        <div className={styles.content} id="demo-content" tabIndex={-1}>{children}</div>

        {next && <NextStep step={next} />}
      </section>
    </main>
  )
}
