export const DEMO_PATIENT_ID = "10000000-0000-4000-8000-000000000001"

export const demoPatients = [
  {
    id: DEMO_PATIENT_ID,
    name: "Aurora Demo",
    initials: "AD",
    lastEntry: "Today · 08:42",
    signal: "Briefing ready",
    state: "review",
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    name: "Bento Demo",
    initials: "BD",
    lastEntry: "Yesterday · 19:10",
    signal: "Timeline updated",
    state: "active",
  },
  {
    id: "10000000-0000-4000-8000-000000000003",
    name: "Clara Demo",
    initials: "CD",
    lastEntry: "2 days ago · 07:55",
    signal: "Next visit scheduled",
    state: "scheduled",
  },
] as const

export const demoTimeline = [
  {
    time: "Today · 08:42",
    source: "MOOD ENTRY",
    title: "Mood recorded as 7/10",
    detail: "Structured entry added by the fictional patient profile.",
  },
  {
    time: "Yesterday · 20:15",
    source: "JOURNAL",
    title: "Short journal entry added",
    detail: "Synthetic text is available to the physician as reported context.",
  },
  {
    time: "3 days ago · 09:00",
    source: "SCHEDULE",
    title: "Follow-up visit confirmed",
    detail: "Administrative event included in the demonstration timeline.",
  },
  {
    time: "6 days ago · 08:21",
    source: "MOOD ENTRY",
    title: "Mood recorded as 6/10",
    detail: "No diagnosis or recommendation is inferred from this entry.",
  },
] as const

export const demoPatientProfile = [
  ["Record", "SYN-001"],
  ["Age range", "35–39"],
  ["Pronouns", "She / her"],
  ["Care window", "90 synthetic days"],
  ["Contact", "Hidden in public demo"],
  ["Data class", "Fictional only"],
] as const

export const demoMedications = [
  {
    name: "Sertraline",
    category: "Antidepressant · SSRI",
    state: "Recorded as current",
    confirmation: "Fictional confirmation · today",
  },
  {
    name: "Quetiapine",
    category: "Antipsychotic",
    state: "Recorded as current",
    confirmation: "Fictional confirmation · yesterday",
  },
  {
    name: "Clonazepam",
    category: "Benzodiazepine",
    state: "Recorded in chart",
    confirmation: "Fictional confirmation · 5 days ago",
  },
] as const

export const demoBriefingFacts = [
  ["Mood entries", "14 synthetic records"],
  ["Journal entries", "3 synthetic records"],
  ["Observation window", "42 fictional days"],
  ["Next visit", "In 7 demo days"],
] as const
