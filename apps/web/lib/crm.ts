/** Retorna somente os caracteres alfanuméricos do CRM (remove espaços, hifens etc.). */
export function crmDigits(v: string): string {
  return v.replace(/[^0-9a-zA-Z]/g, "").toUpperCase()
}

/**
 * Máscara de CRM — mantém só alfanuméricos, uppercase, máx 10 chars.
 * CRM brasileiro é principalmente numérico; alguns estados aceitam letras.
 */
export function crmMask(v: string): string {
  return crmDigits(v).slice(0, 10)
}

/**
 * Validação de formato de CRM.
 * Não valida se o CRM existe no CFM — isso é responsabilidade do servidor
 * (CfmClient via Infosimples). Esta função valida só formato local (4-10 chars).
 */
export function crmValido(v: string): boolean {
  const clean = crmDigits(v)
  return clean.length >= 4 && clean.length <= 10
}
