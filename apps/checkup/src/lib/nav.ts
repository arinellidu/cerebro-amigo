// Triagens agrupadas — fonte única da navegação (TestsMenu desktop + MobileNav).
// Mudou triagem? Edite só aqui. As 8 cobertas; ordem = relevância de busca.
export const TRIAGEM_GROUPS = [
  {
    label: "Humor",
    items: [
      { href: "/depressao", label: "Depressão" },
      { href: "/bipolaridade", label: "Bipolaridade" },
    ],
  },
  { label: "Ansiedade", items: [{ href: "/ansiedade", label: "Ansiedade" }] },
  { label: "Atenção", items: [{ href: "/tdah-adulto", label: "TDAH adulto" }] },
  { label: "Personalidade", items: [{ href: "/borderline", label: "Borderline" }] },
  {
    label: "Uso de substâncias",
    items: [
      { href: "/alcool", label: "Álcool" },
      { href: "/tabagismo", label: "Tabagismo" },
      { href: "/drogas", label: "Drogas" },
    ],
  },
] as const
