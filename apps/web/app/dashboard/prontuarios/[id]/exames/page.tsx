"use client"

import { useParams } from "next/navigation"
import { ExamesPanel } from "@/components/exames/ExamesPanel"

export default function ExamesPage() {
  const { id } = useParams<{ id: string }>()
  return <ExamesPanel pacienteId={id} />
}
