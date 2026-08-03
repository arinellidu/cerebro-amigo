/**
 * Helpers de planilha (.xlsx) para import/export de pacientes — SheetJS.
 * Client-side only (usa File / download no browser). Sem PII além do necessário:
 * o export NÃO inclui CPF (minimização LGPD).
 */

import * as XLSX from "xlsx"

// Colunas exatas do modelo de importação.
export const COLUNAS_MODELO = ["nome", "email", "whatsapp", "cpf", "data_nascimento"] as const

export interface LinhaImport {
  nome: string
  email: string
  whatsapp: string
  cpf?: string
  dataNascimento?: string // YYYY-MM-DD
}

export interface LinhaValidada extends LinhaImport {
  linha: number // linha original na planilha (1-based, ignorando o cabeçalho)
  valida: boolean
  erros: string[]
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function so_digitos(s: string): string {
  return (s.match(/\d/g) ?? []).join("")
}

function normalizarData(valor: unknown): string | undefined {
  if (valor == null || valor === "") return undefined
  if (valor instanceof Date && !isNaN(valor.getTime())) {
    return valor.toISOString().slice(0, 10)
  }
  const s = String(valor).trim()
  // ISO já no formato esperado
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  // DD/MM/AAAA (formato brasileiro comum em planilha)
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (br) {
    const [, d, m, a] = br
    return `${a}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`
  }
  return s // deixa passar; o gateway valida/ignora se não for data válida
}

/** Mapeia uma chave de cabeçalho (qualquer caixa/acentos de espaço) para o campo canônico. */
function chaveCanonica(k: string): string {
  return k.trim().toLowerCase().replace(/\s+/g, "_")
}

/** Lê a 1ª aba da planilha e devolve as linhas mapeadas para LinhaImport. */
export async function parsePlanilha(file: File): Promise<LinhaImport[]> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: "array", cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) return []

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    raw: false,
    defval: "",
  })

  return rows.map((row) => {
    const canon: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(row)) canon[chaveCanonica(k)] = v

    const get = (k: string) => String(canon[k] ?? "").trim()
    return {
      nome: get("nome"),
      email: get("email").toLowerCase(),
      whatsapp: so_digitos(get("whatsapp")),
      cpf: so_digitos(get("cpf")) || undefined,
      dataNascimento: normalizarData(canon["data_nascimento"]),
    }
  })
}

/** Valida uma linha (espelha as regras do gateway). */
export function validarLinha(l: LinhaImport): { valida: boolean; erros: string[] } {
  const erros: string[] = []
  if (!l.nome) erros.push("nome obrigatório")
  if (!l.email) erros.push("e-mail obrigatório")
  else if (!EMAIL_RE.test(l.email)) erros.push("e-mail inválido")
  if (!l.whatsapp) erros.push("WhatsApp obrigatório")
  else if (l.whatsapp.length < 10 || l.whatsapp.length > 15)
    erros.push("WhatsApp precisa ter 10–15 dígitos")
  return { valida: erros.length === 0, erros }
}

/** Baixa um modelo .xlsx com as colunas exatas + 1 linha de exemplo. */
export function baixarModelo(): void {
  const exemplo = {
    nome: "Maria Santos",
    email: "maria@exemplo.com",
    whatsapp: "11999998888",
    cpf: "",
    data_nascimento: "1990-05-20",
  }
  const ws = XLSX.utils.json_to_sheet([exemplo], { header: [...COLUNAS_MODELO] })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "pacientes")
  XLSX.writeFile(wb, "modelo-pacientes.xlsx")
}

export interface PacienteExport {
  numero: number
  nome: string
  email: string | null
  prescricoesAtivas: number
  ultimaMsg: string | null
}

/**
 * Exporta a lista filtrada para .xlsx.
 * Colunas: numero, nome, email, prescricoes_ativas, ultima_msg.
 * NÃO inclui CPF (minimização LGPD — a tela nem carrega CPF).
 */
export function exportarPacientes(rows: PacienteExport[]): void {
  const dados = rows.map((p) => ({
    numero: p.numero,
    nome: p.nome,
    email: p.email ?? "",
    prescricoes_ativas: p.prescricoesAtivas,
    ultima_msg: p.ultimaMsg ? new Date(p.ultimaMsg).toLocaleDateString("pt-BR") : "",
  }))
  const ws = XLSX.utils.json_to_sheet(dados, {
    header: ["numero", "nome", "email", "prescricoes_ativas", "ultima_msg"],
  })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "pacientes")
  const hoje = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `pacientes-${hoje}.xlsx`)
}
