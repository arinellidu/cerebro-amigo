/** Injeta JSON-LD estruturado num <script> na head (server-safe). */
export function Schema({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}

const SITE = "https://www.cerebroamigo.com.br"
const ORG_NAME = "Cérebro Amigo"

export const orgSchema = {
  "@context": "https://schema.org",
  // SaaS p/ psiquiatras — NÃO é provedor médico; manter Organization (não
  // MedicalBusiness/MedicalOrganization) p/ não overclaim de autoridade clínica.
  "@type": "Organization",
  name: ORG_NAME,
  url: SITE,
  logo: `${SITE}/brain-logo.png`,
  slogan: "O CRM que trabalha entre consultas.",
  areaServed: "BR",
  knowsAbout: [
    "Psiquiatria",
    "Saúde mental",
    "Acompanhamento entre consultas",
    "LGPD em saúde",
  ],
  sameAs: [],
  contactPoint: {
    "@type": "ContactPoint",
    email: "contato@cerebroamigo.com.br",
    contactType: "customer support",
    availableLanguage: "Portuguese",
  },
}

/** BreadcrumbList p/ rich result de navegação. items na ordem raiz→atual. */
export function breadcrumb(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: `${SITE}${it.path}`,
    })),
  }
}

export const softwareSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: ORG_NAME,
  applicationCategory: "HealthApplication",
  operatingSystem: "Web",
  offers: {
    "@type": "Offer",
    priceCurrency: "BRL",
    price: "397.00",
    priceValidUntil: "2026-12-31",
    description: "Planos mensais a partir de R$ 397, sem fidelidade.",
  },
  description:
    "Plataforma de psiquiatria para acompanhamento entre consultas: briefing pré-consulta com IA, diário por voz e protocolo de crise integrado.",
  url: `${SITE}/medico`,
}

export const websiteSchema = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: ORG_NAME,
  url: SITE,
  potentialAction: {
    "@type": "SearchAction",
    target: `${SITE}/medico`,
    "query-input": "required name=search_term_string",
  },
}
