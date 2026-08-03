import Link from "next/link"
import { ArrowRight, CalendarClock, CircleCheck, FileText, Fingerprint, Pill, ShieldCheck } from "lucide-react"
import { demoMedications, demoPatientProfile, demoPatients, demoTimeline } from "@/lib/portfolio-demo"
import styles from "../demo.module.css"

const weeklyMood = [
  { week: "W1", value: 5 },
  { week: "W2", value: 5 },
  { week: "W3", value: 6 },
  { week: "W4", value: 6 },
  { week: "W5", value: 6 },
  { week: "W6", value: 7 },
] as const

const patient = demoPatients[0]

const PatientHeader = () => (
  <header className={styles.patientHeader}>
    <div className={styles.patientIdentity}><span>{patient.initials}</span><div><p>PATIENT RECORD / SYNTHETIC PROFILE</p><h1>{patient.name}</h1><small>Fictional patient · no direct identifiers</small></div></div>
    <div className={styles.patientMeta}><span><CalendarClock aria-hidden="true" /> Next demo visit · 7 days</span><span><ShieldCheck aria-hidden="true" /> Physician-owned record</span></div>
  </header>
)

const TimelineEntry = ({ entry }: { entry: (typeof demoTimeline)[number] }) => (
  <li>
    <time>{entry.time}</time>
    <span className={styles.timelineNode} aria-hidden="true" />
    <div><small>{entry.source}</small><strong>{entry.title}</strong><p>{entry.detail}</p></div>
  </li>
)

const PatientTimeline = () => (
  <section className={styles.timeline} aria-labelledby="timeline-title">
    <header><p>REPORTED FACTS</p><h2 id="timeline-title">Between-appointment timeline</h2></header>
    <ol>{demoTimeline.map((entry) => <TimelineEntry entry={entry} key={`${entry.time}-${entry.source}`} />)}</ol>
  </section>
)

const PatientProfile = () => (
  <section className={styles.patientProfile} aria-labelledby="patient-profile-title">
    <header><Fingerprint aria-hidden="true" /><div><p>PATIENT FILE</p><h2 id="patient-profile-title">Synthetic profile</h2></div></header>
    <dl>{demoPatientProfile.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
  </section>
)

const MedicationRow = ({ medication }: { medication: (typeof demoMedications)[number] }) => (
  <article>
    <span className={styles.medicationIcon}><Pill aria-hidden="true" /></span>
    <div><strong>{medication.name}</strong><small>{medication.category}</small></div>
    <span className={styles.medicationState}><CircleCheck aria-hidden="true" /> {medication.state}</span>
    <time>{medication.confirmation}</time>
  </article>
)

const MedicationPanel = () => (
  <section className={styles.medicationPanel} aria-labelledby="medication-title">
    <header><div><p>MEDICATION RECORD</p><h2 id="medication-title">Reported current medications</h2></div><span>3 SYNTHETIC ENTRIES</span></header>
    <div className={styles.medicationList}>{demoMedications.map((medication) => <MedicationRow key={medication.name} medication={medication} />)}</div>
    <p className={styles.medicationBoundary}><ShieldCheck aria-hidden="true" /><span><strong>Demonstration record only.</strong> Names are illustrative chart facts—not a prescription, regimen, dose or treatment recommendation.</span></p>
  </section>
)

const PatientReadout = () => (
  <aside className={styles.patientReadout}>
    <p>SIX-WEEK SYNTHETIC TRACE</p>
    <h2>Reported mood entries</h2>
    <div className={styles.moodBars} aria-label="Six synthetic weekly mood values: 5, 5, 6, 6, 6 and 7 out of 10">
      {weeklyMood.map(({ week, value }) => <span key={week} style={{ height: `${value * 10}%` }}><i>{value}</i></span>)}
    </div>
    <dl>
      <div><dt>Source</dt><dd>Patient-reported demo entries</dd></div>
      <div><dt>Interpretation</dt><dd>Reserved for the physician</dd></div>
      <div><dt>Automation</dt><dd>Organization only</dd></div>
    </dl>
    <Link href="/demo/briefing"><FileText aria-hidden="true" /> Open AI-assisted briefing <ArrowRight aria-hidden="true" /></Link>
  </aside>
)

const DemoPatientPage = () => {

  return (
    <>
      <PatientHeader />

      <div className={styles.patientOverviewGrid}>
        <PatientProfile />
        <MedicationPanel />
      </div>

      <div className={styles.recordGrid}>
        <PatientTimeline />
        <PatientReadout />
      </div>
    </>
  )
}

export default DemoPatientPage
