'use client'

import { useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

type SpotlightCardProps = {
  children: ReactNode
  className?: string
  spotlightColor?: string
}

export function SpotlightCard({
  children,
  className,
  spotlightColor = '94,75,139',
}: SpotlightCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [opacity, setOpacity] = useState(0)

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!cardRef.current) return
    const rect = cardRef.current.getBoundingClientRect()
    setPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setOpacity(1)}
      onMouseLeave={() => setOpacity(0)}
      className={cn(
        'relative overflow-hidden rounded-xl border border-border/40 bg-card transition-transform duration-200 hover:-translate-y-1',
        className,
      )}
    >
      {/* Spotlight gradient */}
      <div
        className="pointer-events-none absolute inset-0 rounded-xl transition-opacity duration-300"
        style={{
          opacity,
          background: `radial-gradient(350px circle at ${pos.x}px ${pos.y}px, rgba(${spotlightColor},0.10), transparent 65%)`,
        }}
      />
      {/* Border glow */}
      <div
        className="pointer-events-none absolute inset-0 rounded-xl border border-transparent transition-opacity duration-300"
        style={{
          opacity,
          boxShadow: `inset 0 0 0 1px rgba(${spotlightColor},0.25)`,
        }}
      />
      {children}
    </div>
  )
}
