/*
THESIS: A patient sees one calm daily cadence, not a miniature medical dashboard.
OWN-WORLD: Signal Boundary rails, square readouts, cyan flow, yellow action and coral human authority.
STORY: Aurora reviews today, tries a local check-in and reaches the voice journal without credentials.
FIRST VIEWPORT: Greeting and day status lead into a continuous care track with the next visit held in a quiet side rail.
FORM: Care cadence strip, structural candidate 7; established world; degraded seed 51a7c95f.
*/

import Link from "next/link"
import { ArrowRight, CalendarDays, Circle, Mic, Pill, ShieldCheck, Smile } from "lucide-react"
import styles from "./patient-app.module.css"

const dayItems = [
  { icon: Smile, label: "MOOD", title: "How are you today?", detail: "Try a local 1–10 check-in.", href: "/demo/patient-app/check-in", state: "OPEN" },
  { icon: Pill, label: "ROUTINE", title: "Medication record", detail: "Preview confirmation with synthetic entries.", href: "/demo/patient-app/check-in#medications", state: "READY" },
  { icon: Mic, label: "JOURNAL", title: "Add a voice note", detail: "Simulate the recorder without microphone access.", href: "/demo/patient-app/voice", state: "OPTIONAL" },
] as const

const DayTrackItem = ({ item }: { item: (typeof dayItems)[number] }) => (
  <li>
    <span className={styles.trackNode}><item.icon aria-hidden="true" /></span>
    <div><small>{item.label}</small><strong>{item.title}</strong><p>{item.detail}</p></div>
    <span className={styles.itemState}>{item.state}</span>
    <Link href={item.href} aria-label={`${item.title}: ${item.detail}`}><ArrowRight aria-hidden="true" /></Link>
  </li>
)

const DayTrack = () => (
  <section className={styles.dayTrack} aria-labelledby="day-track-title">
    <header><div><p>TODAY&apos;S CARE CADENCE</p><h2 id="day-track-title">Three small touchpoints</h2></div><span>DEMO DAY · LOCAL ONLY</span></header>
    <ol>{dayItems.map((item) => <DayTrackItem item={item} key={item.label} />)}</ol>
  </section>
)

const VisitRail = () => (
  <aside className={styles.visitRail}>
    <p>NEXT FICTIONAL VISIT</p>
    <CalendarDays aria-hidden="true" />
    <strong>7 demo days</strong>
    <span>Video appointment · Dr. Morgan</span>
    <div><Circle aria-hidden="true" /><p>Your entries stay organized for physician review. Clinical decisions remain with your psychiatrist.</p></div>
  </aside>
)

const PatientAppToday = () => (
  <>
    <header className={styles.appHeader}>
      <div><p>PATIENT PWA / SYNTHETIC PROFILE</p><h1>Good morning, Aurora.</h1><span>One clear view of today—nothing to configure, nothing real to submit.</span></div>
      <dl><div><dt>Profile</dt><dd>SYN-001</dd></div><div><dt>Open items</dt><dd>03</dd></div><div><dt>Stored data</dt><dd>00</dd></div></dl>
    </header>

    <div className={styles.todayGrid}>
      <DayTrack />
      <VisitRail />
    </div>

    <div className={styles.patientBoundary}><ShieldCheck aria-hidden="true" /><p><strong>Public demo boundary.</strong> Every interaction is synthetic and resets with the page. No account, clinical backend or patient record is used.</p></div>
  </>
)

export default PatientAppToday
