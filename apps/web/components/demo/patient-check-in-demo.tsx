"use client"

import { useState } from "react"
import { Check, Pill, RotateCcw, ShieldCheck, Smile } from "lucide-react"
import { demoMedications } from "@/lib/portfolio-demo"
import styles from "@/app/demo/patient-app/patient-app.module.css"

const moodValues = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const

const MoodDemoPanel = ({ mood, selectMood }: { mood: number | null; selectMood: (value: number) => void }) => (
  <section className={styles.moodPanel} aria-labelledby="mood-demo-title">
    <header><Smile aria-hidden="true" /><div><p>MOOD ENTRY</p><h2 id="mood-demo-title">Choose a demo value</h2></div></header>
    <div className={styles.moodScale} role="group" aria-label="Synthetic mood value from 1 to 10">
      {moodValues.map((value) => <button aria-pressed={mood === value} key={value} onClick={() => selectMood(value)} type="button">{value}</button>)}
    </div>
    <p className={styles.localReadout}><span>LOCAL READOUT</span><strong>{mood ? `${mood} / 10 selected` : "No value selected"}</strong></p>
  </section>
)

const MedicationDemoRow = ({ confirmed, medication, toggle }: { confirmed: boolean; medication: (typeof demoMedications)[number]; toggle: (name: string) => void }) => (
  <li>
    <div><strong>{medication.name}</strong><span>{medication.category} · synthetic chart</span></div>
    <button aria-pressed={confirmed} onClick={() => toggle(medication.name)} type="button">{confirmed && <Check aria-hidden="true" />}{confirmed ? "Marked in demo" : "Simulate confirmation"}</button>
  </li>
)

const MedicationDemoPanel = ({ confirmed, toggle }: { confirmed: string[]; toggle: (name: string) => void }) => (
  <section className={styles.medicationCheck} id="medications" aria-labelledby="medication-demo-title">
    <header><Pill aria-hidden="true" /><div><p>MEDICATION CHECK-IN</p><h2 id="medication-demo-title">Preview confirmation</h2></div></header>
    <ul>{demoMedications.map((medication) => <MedicationDemoRow confirmed={confirmed.includes(medication.name)} key={medication.name} medication={medication} toggle={toggle} />)}</ul>
    <p className={styles.medicationSafety}><ShieldCheck aria-hidden="true" /><span>This demo does not tell you what, when or how much to take. Follow only instructions from your clinician.</span></p>
  </section>
)

const LocalDemoState = ({ count, reset }: { count: number; reset: () => void }) => (
  <footer className={styles.localState}>
    <p><strong>{count}</strong><span>local demo interactions</span></p>
    <button onClick={reset} type="button"><RotateCcw aria-hidden="true" /> Reset this screen</button>
  </footer>
)

export const PatientCheckInDemo = () => {
  const [mood, setMood] = useState<number | null>(null)
  const [confirmed, setConfirmed] = useState<string[]>([])

  const toggleMedication = (name: string) => {
    setConfirmed((current) => current.includes(name) ? current.filter((item) => item !== name) : [...current, name])
  }

  const reset = () => {
    setMood(null)
    setConfirmed([])
  }

  return (
    <div className={styles.checkInGrid}>
      <MoodDemoPanel mood={mood} selectMood={setMood} />
      <MedicationDemoPanel confirmed={confirmed} toggle={toggleMedication} />
      <LocalDemoState count={(mood ? 1 : 0) + confirmed.length} reset={reset} />
    </div>
  )
}
