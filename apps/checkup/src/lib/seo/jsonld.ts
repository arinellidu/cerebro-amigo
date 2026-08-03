// Builders de JSON-LD (Schema.org) do checkup. Conteúdo SEMPRE factual:
// triagem ≠ diagnóstico, sem promessa de cura (clinical-safety + CFM).
import { REVIEWER } from "./reviewer";

export const SITE_URL = "https://checkup.cerebroamigo.com.br";
export const MAIN_SITE_URL = "https://www.cerebroamigo.com.br";

export function orgJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${MAIN_SITE_URL}/#org`,
    name: "Cérebro Amigo",
    url: MAIN_SITE_URL,
    logo: `${SITE_URL}/brain-logo.png`,
    description:
      "Plataforma que ajuda psiquiatras a acompanhar pacientes entre as consultas.",
    sameAs: [MAIN_SITE_URL, SITE_URL],
  };
}

export function webSiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    name: "Check-up Mental",
    url: SITE_URL,
    inLanguage: "pt-BR",
    publisher: { "@id": `${MAIN_SITE_URL}/#org` },
  };
}

export function medicalWebPageJsonLd({
  name,
  url,
  description,
  conditionName,
  citations,
}: {
  name: string;
  url: string;
  description: string;
  conditionName: string;
  citations: string[];
}) {
  return {
    "@context": "https://schema.org",
    "@type": "MedicalWebPage",
    name,
    url,
    description,
    inLanguage: "pt-BR",
    about: { "@type": "MedicalCondition", name: conditionName },
    medicalAudience: { "@type": "Patient" },
    citation: citations,
    publisher: { "@id": `${MAIN_SITE_URL}/#org` },
    ...(REVIEWER
      ? {
          reviewedBy: {
            "@type": "Physician",
            name: REVIEWER.name,
            description: [REVIEWER.title, REVIEWER.crm, REVIEWER.rqe]
              .filter(Boolean)
              .join(" · "),
            ...(REVIEWER.url ? { sameAs: [REVIEWER.url] } : {}),
          },
        }
      : {}),
  };
}

export interface FaqItem {
  q: string;
  a: string;
}

// FAQPage só é válido se as perguntas estiverem VISÍVEIS na página
// (renderizar junto com <FaqSection items={...}>).
export function faqJsonLd(items: FaqItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

export function breadcrumbJsonLd(items: { name: string; url: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  };
}
