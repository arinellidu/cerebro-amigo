"use client"

import { useParams } from "next/navigation"
import { EvolucaoEscalasPanel } from "@/components/escalas/EvolucaoEscalasPanel"

export default function EscalasPage() {
  const { id } = useParams<{ id: string }>()
  return <EvolucaoEscalasPanel pacienteId={id} />
}
