import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { phq9, gad7, asrs18, audit, mdq, fagerstrom, msiBpd } from "@/lib/scales";
import { isScaleAvailable } from "@/lib/scales/gate";
import { QuizFlow } from "./QuizFlow";

export function generateStaticParams() {
  return [
    { scaleId: "phq9" },
    { scaleId: "gad7" },
    { scaleId: "asrs18" },
    { scaleId: "audit" },
    { scaleId: "mdq" },
    { scaleId: "fagerstrom" },
    { scaleId: "msi_bpd" },
  ];
}

interface Props {
  params: Promise<{ scaleId: string }>;
}

const SCALES = { phq9, gad7, asrs18, audit, mdq, fagerstrom, msi_bpd: msiBpd };
const SCALE_METADATA: Record<string, { title: string; description: string }> = {
  phq9: {
    title: "Triagem de Depressão — PHQ-9",
    description: "Responda 9 perguntas sobre como você tem se sentido nas últimas 2 semanas.",
  },
  gad7: {
    title: "Triagem de Ansiedade — GAD-7",
    description: "Responda 7 perguntas sobre como você tem se sentido nas últimas 2 semanas.",
  },
  asrs18: {
    title: "Triagem de TDAH Adulto — ASRS-18",
    description: "Responda 18 perguntas sobre como você se sentiu nos últimos 6 meses.",
  },
  audit: {
    title: "Triagem de Uso de Álcool — AUDIT",
    description: "Responda 10 perguntas sobre o seu consumo de álcool nos últimos 12 meses.",
  },
  mdq: {
    title: "Triagem de Bipolaridade — MDQ",
    description: "Responda 15 perguntas sobre períodos de humor e energia fora do habitual.",
  },
  fagerstrom: {
    title: "Dependência de Nicotina — Teste de Fagerström",
    description: "Responda 6 perguntas sobre o seu hábito de fumar.",
  },
  msi_bpd: {
    title: "Triagem de Traços Borderline — MSI-BPD",
    description: "Responda 10 perguntas sobre padrões de sentimentos e relações.",
  },
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { scaleId } = await params;
  const meta = SCALE_METADATA[scaleId];
  if (!meta) return {};
  return { title: meta.title, description: meta.description, robots: { index: false } };
}

export default async function TestePage({ params }: Props) {
  const { scaleId } = await params;
  const scale = SCALES[scaleId as keyof typeof SCALES];

  if (!scale) notFound();

  if (!isScaleAvailable(scale)) {
    return (
      <main className="flex min-h-[72vh] items-center justify-center px-4">
        <div className="glass-noir max-w-sm rounded-3xl p-8 text-center">
          <p className="mb-4 text-4xl">🔬</p>
          <h1 className="mb-2 font-display text-2xl font-semibold text-foreground">Em breve</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            A triagem de {scale.name} está em fase de validação e será disponibilizada em breve.
          </p>
        </div>
      </main>
    );
  }

  // QuizFlow renderiza no servidor (SSR) — lê ?series= via window pós-montagem, sem Suspense.
  return <QuizFlow scale={scale} />;
}
