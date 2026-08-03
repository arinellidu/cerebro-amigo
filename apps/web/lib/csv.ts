/**
 * Exporta um CSV client-side a partir de dados já carregados (sem endpoint novo).
 * Usa `;` como separador e BOM UTF-8 — o Excel PT-BR abre com acentos e colunas
 * corretas por padrão.
 */
export function baixarCsv(
  nomeArquivo: string,
  colunas: string[],
  linhas: Array<Array<string | number | null | undefined>>,
) {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v)
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const conteudo = [colunas, ...linhas].map((l) => l.map(esc).join(";")).join("\r\n")
  const blob = new Blob(["﻿" + conteudo], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = nomeArquivo
  a.click()
  URL.revokeObjectURL(url)
}
