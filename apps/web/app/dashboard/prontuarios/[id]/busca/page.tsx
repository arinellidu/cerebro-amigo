"use client"

import { useParams } from "next/navigation"
import { BuscaSemantica } from "@/components/rag/BuscaSemantica"

export default function BuscaPage() {
  const { id } = useParams<{ id: string }>()
  return <BuscaSemantica pacienteId={id} />
}
