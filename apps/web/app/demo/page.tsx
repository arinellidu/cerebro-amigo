import Link from "next/link"
import { ArrowRight, CalendarClock, Database, Eye, UsersRound } from "lucide-react"
import { demoPatients } from "@/lib/portfolio-demo"
import styles from "./demo.module.css"

const Metrics = () => (
  <dl className={styles.metrics}>
    <div><dt><UsersRound aria-hidden="true" /> Patients</dt><dd>3</dd><small>All synthetic</small></div>
    <div><dt><Eye aria-hidden="true" /> Awaiting review</dt><dd>1</dd><small>Human decision required</small></div>
    <div><dt><CalendarClock aria-hidden="true" /> Next visit</dt><dd>3d</dd><small>Fictional schedule</small></div>
    <div><dt><Database aria-hidden="true" /> Real records</dt><dd>0</dd><small>Public demo boundary</small></div>
  </dl>
)

const PatientTable = () => (
  <div className={styles.patientTable}>
    <header><div><p>BETWEEN-APPOINTMENT SIGNALS</p><h2 id="patient-signal-title">Three synthetic patients</h2></div><span>UPDATED · DEMO CLOCK</span></header>
    <div className={styles.tableHeader} aria-hidden="true"><span>Patient</span><span>Last entry</span><span>Current signal</span><span>Open</span></div>
    {demoPatients.map((patient, index) => (
      <article key={patient.id}>
        <span className={styles.avatar}>{patient.initials}</span>
        <div><strong>{patient.name}</strong><small>Patient {String(index + 1).padStart(2, "0")} · synthetic</small></div>
        <time>{patient.lastEntry}</time>
        <span className={`${styles.signalState} ${styles[patient.state]}`}>{patient.signal}</span>
        <Link href="/demo/patient" aria-label={`Continue from ${patient.name} to the featured synthetic patient record`}>
          <ArrowRight aria-hidden="true" />
        </Link>
      </article>
    ))}
  </div>
)

const InspectionRail = () => (
  <aside className={styles.inspectionRail}>
    <p>ACTIVE INSPECTION</p>
    <span className={styles.pulse} aria-hidden="true" />
    <h2>A briefing is ready for physician review.</h2>
    <p>The system has organized reported facts from Aurora&apos;s fictional interval. It has not produced a diagnosis, prescription or dose change.</p>
    <Link href="/demo/patient">Inspect patient record <ArrowRight aria-hidden="true" /></Link>
  </aside>
)

const DemoDashboardPage = () => {
  return (
    <>
      <header className={styles.pageHeader}>
        <div><p>PHYSICIAN WORKSPACE / SYNTHETIC TENANT</p><h1>Dashboard</h1></div>
        <p>Start with the whole interval, then follow one synthetic signal into its record and briefing.</p>
      </header>

      <Metrics />

      <section className={styles.dashboardGrid} aria-labelledby="patient-signal-title">
        <PatientTable />
        <InspectionRail />
      </section>
    </>
  )
}

export default DemoDashboardPage
