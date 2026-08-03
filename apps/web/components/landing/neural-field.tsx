"use client"

import { useEffect, useRef } from "react"

interface Node {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  phase: number
}

/**
 * NeuralField — campo neural vivo (canvas 2D). On-brand "Cérebro": nós +
 * sinapses que pulsam e reagem ao cursor. Client component, renderizado dentro
 * do HeroSection (server, cacheado) como "client hole".
 *
 * Decisões de engenharia:
 *  - Canvas 2D (não WebGL/Three): zero deps, bundle leve, perf previsível.
 *  - SSR-safe: renderiza só <canvas> determinístico; toda leitura de window/dpr
 *    fica no useEffect → sem mismatch de hidratação.
 *  - prefers-reduced-motion → desenha 1 frame estático, sem rAF.
 *  - mobile (<768px) → não anima (o AuroraBackdrop do pai cobre o espaço).
 *  - cleanup total de rAF/listeners/observer.
 */
export function NeuralField({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)
  const nodesRef = useRef<Node[]>([])
  const pointerRef = useRef({ x: -9999, y: -9999, active: false })

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const cx = cv.getContext("2d")
    if (!cx) return

    // Mobile: não anima (pai mostra aurora). Evita drenar bateria/jank de scroll.
    if (window.matchMedia("(max-width: 767px)").matches) return

    const cs = getComputedStyle(cv)
    const colLine = cs.getPropertyValue("--noir-line").trim() || "#2A2A3D"
    const colNode = cs.getPropertyValue("--noir-node").trim() || "#6E5FB0"
    const colActive = cs.getPropertyValue("--noir-node-active").trim() || "#B3A6DA"
    const colCoral = cs.getPropertyValue("--coral").trim() || "#E57373"

    let width = 0
    let height = 0
    const LINK_DIST = 132
    const CURSOR_RADIUS = 170

    const resize = () => {
      const rect = cv.getBoundingClientRect()
      width = rect.width
      height = rect.height
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      cv.width = Math.floor(width * dpr)
      cv.height = Math.floor(height * dpr)
      cx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const target = Math.min(70, Math.round((width * height) / 19000))
      const nodes: Node[] = []
      for (let i = 0; i < target; i++) {
        nodes.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.22,
          vy: (Math.random() - 0.5) * 0.22,
          r: 1.1 + Math.random() * 1.7,
          phase: Math.random() * Math.PI * 2,
        })
      }
      nodesRef.current = nodes
    }

    const draw = (t: number) => {
      const nodes = nodesRef.current
      const p = pointerRef.current
      cx.clearRect(0, 0, width, height)

      for (const n of nodes) {
        if (p.active) {
          const dx = p.x - n.x
          const dy = p.y - n.y
          const d2 = dx * dx + dy * dy
          if (d2 < CURSOR_RADIUS * CURSOR_RADIUS && d2 > 1) {
            const d = Math.sqrt(d2)
            const f = (1 - d / CURSOR_RADIUS) * 0.035
            n.vx += (dx / d) * f
            n.vy += (dy / d) * f
          }
        }
        n.x += n.vx
        n.y += n.vy
        n.vx *= 0.985
        n.vy *= 0.985
        if (Math.abs(n.vx) < 0.04) n.vx += (Math.random() - 0.5) * 0.05
        if (Math.abs(n.vy) < 0.04) n.vy += (Math.random() - 0.5) * 0.05
        if (n.x < 0) n.x += width
        if (n.x > width) n.x -= width
        if (n.y < 0) n.y += height
        if (n.y > height) n.y -= height
      }

      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i]
        const aNear =
          p.active && (a.x - p.x) ** 2 + (a.y - p.y) ** 2 < CURSOR_RADIUS * CURSOR_RADIUS
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j]
          const dx = a.x - b.x
          const dy = a.y - b.y
          const d2 = dx * dx + dy * dy
          if (d2 > LINK_DIST * LINK_DIST) continue
          const d = Math.sqrt(d2)
          const bNear =
            p.active && (b.x - p.x) ** 2 + (b.y - p.y) ** 2 < CURSOR_RADIUS * CURSOR_RADIUS
          const lit = aNear || bNear
          cx.globalAlpha = (1 - d / LINK_DIST) * (lit ? 0.55 : 0.22)
          cx.strokeStyle = lit ? colActive : colLine
          cx.lineWidth = lit ? 1 : 0.6
          cx.beginPath()
          cx.moveTo(a.x, a.y)
          cx.lineTo(b.x, b.y)
          cx.stroke()
        }
      }

      for (const n of nodes) {
        const near =
          p.active && (n.x - p.x) ** 2 + (n.y - p.y) ** 2 < CURSOR_RADIUS * CURSOR_RADIUS
        const pulse = 0.6 + 0.4 * Math.sin(t * 0.0011 + n.phase)
        cx.globalAlpha = near ? 1 : 0.5 + pulse * 0.3
        if (near) {
          cx.shadowBlur = 12
          cx.shadowColor = colActive
        } else {
          cx.shadowBlur = 0
        }
        cx.fillStyle = near ? colActive : n.phase > 5.6 ? colCoral : colNode
        cx.beginPath()
        cx.arc(n.x, n.y, near ? n.r * 1.7 : n.r, 0, Math.PI * 2)
        cx.fill()
      }
      cx.globalAlpha = 1
      cx.shadowBlur = 0
    }

    const loop = (t: number) => {
      draw(t)
      rafRef.current = requestAnimationFrame(loop)
    }

    const onPointerMove = (e: PointerEvent) => {
      const rect = cv.getBoundingClientRect()
      pointerRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top, active: true }
    }
    const onPointerLeave = () => {
      pointerRef.current.active = false
    }

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    resize()

    if (reduce) {
      draw(0)
    } else {
      window.addEventListener("pointermove", onPointerMove, { passive: true })
      window.addEventListener("pointerout", onPointerLeave, { passive: true })
      rafRef.current = requestAnimationFrame(loop)
    }

    const ro = new ResizeObserver(() => {
      resize()
      if (reduce) draw(0)
    })
    ro.observe(cv)

    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("pointerout", onPointerLeave)
      ro.disconnect()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={className}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  )
}
