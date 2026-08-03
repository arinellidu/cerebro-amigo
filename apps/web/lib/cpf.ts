/** Retorna somente os dígitos do CPF. */
export function cpfDigits(v: string): string {
  return v.replace(/\D/g, "")
}

/** Formata CPF como 000.000.000-00 (entrada pode ter ou não formatação). */
export function cpfMask(v: string): string {
  const d = cpfDigits(v).slice(0, 11)
  if (d.length <= 3) return d
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}

/**
 * Valida CPF pelo algoritmo dos dígitos verificadores.
 * Aceita com ou sem pontuação. Retorna true se válido.
 */
export function cpfValido(v: string): boolean {
  const d = cpfDigits(v)
  if (d.length !== 11) return false
  // todos dígitos iguais são inválidos (ex.: 111.111.111-11)
  if (/^(\d)\1{10}$/.test(d)) return false

  const calcDig = (base: string, len: number): number => {
    let sum = 0
    for (let i = 0; i < len; i++) sum += parseInt(base[i]) * (len + 1 - i)
    const rem = (sum * 10) % 11
    return rem === 10 ? 0 : rem
  }

  return (
    calcDig(d, 9) === parseInt(d[9]) &&
    calcDig(d, 10) === parseInt(d[10])
  )
}
