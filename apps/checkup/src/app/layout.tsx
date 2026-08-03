import type { Metadata } from "next";
import { inter, playfair } from "@/lib/fonts";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { JsonLd } from "@/components/seo-blocks";
import { orgJsonLd, webSiteJsonLd } from "@/lib/seo/jsonld";
import "./globals.css";

const SITE_URL = "https://checkup.cerebroamigo.com.br";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Check-up Mental Gratuito — PHQ-9, GAD-7 e ASRS-18",
    template: "%s — Check-up Mental",
  },
  description:
    "Faça uma triagem gratuita e anônima de saúde mental com instrumentos validados. Receba uma devolutiva personalizada e um relatório para levar ao seu médico.",
  keywords: [
    "teste de ansiedade",
    "teste de depressão",
    "teste TDAH adulto",
    "PHQ-9 português",
    "GAD-7 português",
    "triagem saúde mental",
    "check-up mental",
    "saúde mental online",
  ],
  authors: [{ name: "Cérebro Amigo", url: "https://cerebroamigo.com.br" }],
  robots: { index: true, follow: true },
  // Favicon do Cérebro Amigo, mesmo do site principal (cerebroamigo.com.br).
  icons: {
    icon: [
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-48.png", sizes: "48x48", type: "image/png" },
    ],
    shortcut: "/favicon-32.png",
    apple: "/apple-icon.png",
  },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    url: SITE_URL,
    siteName: "Check-up Mental",
    title: "Check-up Mental Gratuito — Triagem de Saúde Mental",
    description:
      "Triagem gratuita e anônima com instrumentos clínicos validados. Resultado instantâneo + relatório PDF.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Check-up Mental Gratuito",
    description: "Triagem gratuita e anônima de saúde mental.",
  },
  alternates: { canonical: SITE_URL },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="pt-BR"
      className={`${inter.variable} ${playfair.variable}`}
    >
      <body className={`${inter.className} theme-noir antialiased flex min-h-screen flex-col`}>
        <JsonLd data={orgJsonLd()} />
        <JsonLd data={webSiteJsonLd()} />
        {/* Atmosfera global (só CSS): aurora + malha neural, atrás de tudo.
            /crise pinta a própria ilha clara por cima — não é afetada. */}
        <div className="noir-backdrop" aria-hidden />
        <div className="noir-grid" aria-hidden />
        <SiteHeader />
        <div className="relative flex-1">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
