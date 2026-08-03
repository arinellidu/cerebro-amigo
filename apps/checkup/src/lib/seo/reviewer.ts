// Revisão clínica do conteúdo das landings (E-E-A-T / publicidade médica CFM).
//
// REGRA: preencher SOMENTE com dados reais e com o consentimento explícito do
// profissional. Publicidade médica no Brasil exige nome + CRM (e RQE quando
// houver especialidade registrada). Nunca preencher com placeholder/inventado —
// enquanto for null, nenhum bloco de revisor é renderizado nem entra no JSON-LD.
export interface Reviewer {
  name: string;
  /** ex.: "CRM-RJ 123456" */
  crm: string;
  /** ex.: "RQE 12345 (Psiquiatria)" */
  rqe?: string;
  /** ex.: "Psiquiatra" */
  title: string;
  /** perfil público (site, Lattes, etc.) — vira sameAs no JSON-LD */
  url?: string;
}

export const REVIEWER: Reviewer | null = null;
