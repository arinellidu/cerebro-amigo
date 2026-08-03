"use client"

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"

interface HumorSemanaPonto {
  day: string
  muitoBem: number
  bem: number
  neutro: number
  mal: number
}

export function MoodChart({ data = [] }: { data?: HumorSemanaPonto[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={200}>
      <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="day" tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
        <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={{
            backgroundColor: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
          }}
        />
        <Bar dataKey="muitoBem" stackId="a" fill="var(--success)" name="Muito bem" radius={[0, 0, 0, 0]} />
        <Bar dataKey="bem" stackId="a" fill="var(--primary)" name="Bem" />
        <Bar dataKey="neutro" stackId="a" fill="var(--warning)" name="Neutro" />
        <Bar dataKey="mal" stackId="a" fill="var(--coral)" name="Mal" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
