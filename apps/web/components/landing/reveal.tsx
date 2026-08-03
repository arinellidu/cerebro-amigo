"use client"

import { motion, useReducedMotion, type Variants } from "framer-motion"

const spring = { type: "spring" as const, stiffness: 120, damping: 20, mass: 0.6 }

/**
 * Reveal — wrapper de entrada on-scroll (framer-motion). Client.
 * Usado DENTRO dos Server Components cacheados da landing (vira "client hole",
 * preservando o `'use cache'` do shell). Respeita prefers-reduced-motion.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  y = 24,
  as = "div",
}: {
  children: React.ReactNode
  className?: string
  delay?: number
  y?: number
  as?: "div" | "section" | "li" | "span"
}) {
  const reduce = useReducedMotion()
  const MotionTag = motion[as] as typeof motion.div

  if (reduce) {
    const Tag = as
    return <Tag className={className}>{children}</Tag>
  }

  return (
    <MotionTag
      className={className}
      initial={{ y }}
      whileInView={{ y: 0 }}
      viewport={{ once: true, margin: "-12% 0px" }}
      transition={{ ...spring, delay }}
    >
      {children}
    </MotionTag>
  )
}

const groupVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.04 } },
}
const itemVariants: Variants = {
  hidden: { y: 24 },
  show: { y: 0, transition: spring },
}

/**
 * RevealGroup + RevealItem — stagger para grades (Features, How-It-Works).
 */
export function RevealGroup({
  children,
  className,
  as = "div",
}: {
  children: React.ReactNode
  className?: string
  as?: "div" | "ul" | "ol"
}) {
  const reduce = useReducedMotion()
  const MotionTag = motion[as] as typeof motion.div

  if (reduce) {
    const Tag = as
    return <Tag className={className}>{children}</Tag>
  }

  return (
    <MotionTag
      className={className}
      variants={groupVariants}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-10% 0px" }}
    >
      {children}
    </MotionTag>
  )
}

export function RevealItem({
  children,
  className,
  as = "div",
}: {
  children: React.ReactNode
  className?: string
  as?: "div" | "li"
}) {
  const reduce = useReducedMotion()
  const MotionTag = motion[as] as typeof motion.div

  if (reduce) {
    const Tag = as
    return <Tag className={className}>{children}</Tag>
  }

  return (
    <MotionTag className={className} variants={itemVariants}>
      {children}
    </MotionTag>
  )
}
