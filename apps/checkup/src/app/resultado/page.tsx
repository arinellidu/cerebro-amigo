import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { getResultShareMeta } from "@/lib/seo/result-og";
import ResultadoClient from "./ResultadoClient";

type Props = {
  searchParams: Promise<{ scale?: string }>;
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { scale } = await searchParams;
  const meta = getResultShareMeta(scale);
  const ogPath = `/api/og/result?scale=${encodeURIComponent(scale ?? "")}`;

  return {
    title: meta.title,
    description: meta.description,
    openGraph: {
      title: meta.title,
      description: meta.description,
      images: [{ url: ogPath, width: 1200, height: 630, alt: meta.ogAlt }],
    },
    twitter: {
      card: "summary_large_image",
      title: meta.title,
      description: meta.description,
      images: [ogPath],
    },
  };
}

export default function ResultadoPage() {
  return (
    <Suspense fallback={<PageSkeleton label="Carregando resultado…" />}>
      <ResultadoClient />
    </Suspense>
  );
}
