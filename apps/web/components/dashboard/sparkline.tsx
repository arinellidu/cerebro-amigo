// Sparkline SVG puro (sem dependências). Herda a cor via `currentColor` — o
// chamador define `text-*`. Mostra tendência de uma série curta de forma factual.

export function Sparkline({
  values,
  width = 72,
  height = 24,
  strokeWidth = 1.5,
  className = "",
}: {
  values: number[]
  width?: number
  height?: number
  strokeWidth?: number
  className?: string
}) {
  if (!values || values.length === 0) return null

  const pad = strokeWidth + 1.5
  const usableH = height - pad * 2
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1

  const y = (v: number) => pad + (1 - (v - min) / span) * usableH

  // Ponto único: traço plano no centro vertical.
  if (values.length === 1) {
    const cy = height / 2
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} fill="none" aria-hidden>
        <line x1={0} y1={cy} x2={width} y2={cy} stroke="currentColor" strokeWidth={strokeWidth} opacity={0.4} />
        <circle cx={width} cy={cy} r={2} fill="currentColor" />
      </svg>
    )
  }

  const stepX = width / (values.length - 1)
  const pts = values.map((v, i) => [i * stepX, y(v)] as const)
  const line = pts.map(([px, py], i) => `${i === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ")
  const area = `${line} L${width},${height} L0,${height} Z`
  const [lx, ly] = pts[pts.length - 1]

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} fill="none" aria-hidden>
      <path d={area} fill="currentColor" opacity={0.1} />
      <path d={line} stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r={2} fill="currentColor" />
    </svg>
  )
}
