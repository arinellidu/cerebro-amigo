"use client"

import { useEffect, useState } from "react"
import { Check, Mic, RotateCcw, ShieldCheck, Square } from "lucide-react"
import styles from "@/app/demo/patient-app/patient-app.module.css"

type VoiceState = "idle" | "recording" | "ready"

const waveform = [24, 42, 66, 36, 78, 52, 88, 44, 72, 30, 62, 84, 48, 70, 38, 58, 80, 46, 68, 34].map((height, position) => ({ id: `signal-${position + 1}`, height }))

const formatTime = (seconds: number) => `00:${String(seconds).padStart(2, "0")}`

const RecorderActions = ({ reset, start, state, stop }: { reset: () => void; start: () => void; state: VoiceState; stop: () => void }) => (
  <div className={styles.recorderActions}>
    {state === "idle" && <button className={styles.recordButton} onClick={start} type="button"><Mic aria-hidden="true" /> Start demo recording</button>}
    {state === "recording" && <button className={styles.stopButton} onClick={stop} type="button"><Square aria-hidden="true" /> Stop simulation</button>}
    {state === "ready" && <><span><Check aria-hidden="true" /> Demo note ready</span><button onClick={reset} type="button"><RotateCcw aria-hidden="true" /> Try again</button></>}
  </div>
)

const Recorder = ({ reset, seconds, start, state, statusCopy, stop }: { reset: () => void; seconds: number; start: () => void; state: VoiceState; statusCopy: string; stop: () => void }) => (
  <section className={styles.recorder} aria-labelledby="recorder-title">
    <header><div><p>VOICE NOTE / LOCAL SIMULATION</p><h2 id="recorder-title">Private by construction</h2></div><time aria-label={`Elapsed simulated time: ${seconds} seconds`}>{formatTime(seconds)}</time></header>
    <div className={`${styles.waveform} ${state === "recording" ? styles.waveformActive : ""}`} aria-hidden="true">
      {waveform.map(({ height, id }, index) => <span key={id} style={{ height: `${height}%`, animationDelay: `${index * 45}ms` }} />)}
    </div>
    <p className={styles.voiceStatus} aria-live="polite">{statusCopy}</p>
    <RecorderActions reset={reset} start={start} state={state} stop={stop} />
  </section>
)

const VoiceBoundary = () => (
  <aside className={styles.voiceBoundary}>
    <ShieldCheck aria-hidden="true" />
    <p>PUBLIC DEMO BOUNDARY</p>
    <h2>The interface moves. Your microphone does not.</h2>
    <dl><div><dt>Microphone</dt><dd>Never requested</dd></div><div><dt>Audio</dt><dd>Never captured</dd></div><div><dt>Upload</dt><dd>Never attempted</dd></div><div><dt>Persistence</dt><dd>Reset on refresh</dd></div></dl>
  </aside>
)

export const PatientVoiceDemo = () => {
  const [state, setState] = useState<VoiceState>("idle")
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    if (state !== "recording") return
    const timer = window.setInterval(() => {
      setSeconds((current) => {
        if (current >= 14) {
          setState("ready")
          return 15
        }
        return current + 1
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [state])

  const start = () => {
    setSeconds(0)
    setState("recording")
  }

  const reset = () => {
    setSeconds(0)
    setState("idle")
  }

  const statusCopy = state === "recording"
    ? "Simulating a recording locally—no audio is being captured."
    : state === "ready"
      ? "Demo note staged. No audio file or transcript was created."
      : "Microphone access is disabled in this public demo."

  return (
    <div className={styles.voiceGrid}>
      <Recorder reset={reset} seconds={seconds} start={start} state={state} statusCopy={statusCopy} stop={() => setState("ready")} />
      <VoiceBoundary />
    </div>
  )
}
