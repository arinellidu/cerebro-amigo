#!/usr/bin/env python3
"""Ingestão dos Dados Abertos da ANVISA -> tabela `medicamentos` (EXIBIÇÃO/picker).

Expande o catálogo de medicamentos usado na busca e no picker de "Medicações em
uso" (reconciliação, ADR-062) a partir do arquivo oficial da ANVISA:

    https://dados.anvisa.gov.br/dados/DADOS_ABERTOS_MEDICAMENTOS.csv

ESCOPO E SEGURANÇA CLÍNICA (clinical-safety regra #1 — a IA não inventa dado
clínico):
  - Escreve SÓ FATOS DE REGISTRO vindos do arquivo da ANVISA (princípio ativo,
    nome do produto, classe terapêutica, nº de registro, laboratório).
  - NÃO toca o motor de interações A5 (medicamento_dicionario / interacao_catalogo,
    migration 0029) — esse segue curado e ATESTADO pelo médico (Dr. Adonai).
  - NÃO grava dose, interação, indicação ou qualquer conduta. Esses campos
    (dosagens, indicacoes_resumo) permanecem como estão (pendentes de Adonai).
  - Os dados vêm do CSV oficial — este script NÃO fabrica linhas de catálogo.

DESIGN:
  - Schema-driven: lê o CABEÇALHO real do CSV em runtime e mapeia por NOME de
    coluna (case-insensitive), com candidatos default + fallback. Não depende da
    ordem das colunas. Em --dry-run imprime o cabeçalho detectado + amostra
    mapeada para você CONFERIR o mapeamento antes de escrever.
  - Idempotente: UPSERT por `chave_anvisa` (nome do produto + princípio ativo
    normalizados). Rodar 2x não duplica.
  - Filtra por situação de registro válida (configurável).

USO:
    # 1) baixe o CSV no host (o domínio da ANVISA atualiza D-1):
    curl -fsSL -o /tmp/anvisa.csv \\
        https://dados.anvisa.gov.br/dados/DADOS_ABERTOS_MEDICAMENTOS.csv

    # 2) CONFIRA o mapeamento sem escrever nada:
    python3 infra/scripts/import_anvisa_medicamentos.py --file /tmp/anvisa.csv --dry-run

    # 3) rode de verdade (precisa do DSN do Postgres clínico):
    export POSTGRES_DSN_URL="postgresql://.../cerebro_v3"
    python3 infra/scripts/import_anvisa_medicamentos.py --file /tmp/anvisa.csv

Rollback: DELETE FROM medicamentos WHERE origem = 'anvisa-dados-abertos';
Runbook:  docs/runbooks/import-anvisa-medicamentos.md
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import os
import sys
import unicodedata

ORIGEM = "anvisa-dados-abertos"
BATCH_SIZE = 500
DEFAULT_URL = "https://dados.anvisa.gov.br/dados/DADOS_ABERTOS_MEDICAMENTOS.csv"

# Candidatos de cabeçalho ANVISA -> coluna alvo. Primeiro presente vence.
# (case-insensitive; o dataset usa MAIÚSCULAS_COM_UNDERSCORE.)
COLUNAS = {
    "nome_comercial":     ["NOME_PRODUTO", "PRODUTO", "NOME_COMERCIAL"],
    "nome_generico":      ["PRINCIPIO_ATIVO", "PRINCIPIOS_ATIVOS", "SUBSTANCIA"],  # obrigatório
    "classe_terapeutica": ["CLASSE_TERAPEUTICA", "CLASSES_TERAPEUTICAS"],
    "registro_anvisa":    ["NUMERO_REGISTRO_PRODUTO", "REGISTRO", "NUMERO_REGISTRO"],
    "laboratorio":        ["EMPRESA_DETENTORA_REGISTRO", "NOME_EMPRESA", "EMPRESA_DETENTORA", "EMPRESA"],
    "situacao":           ["SITUACAO_REGISTRO", "SITUACAO"],
    "categoria":          ["CATEGORIA_REGULATORIA", "CATEGORIA"],
}


def _strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def _norm_key(s: str) -> str:
    """Normaliza p/ chave/dedupe: sem acento, minúsculo, espaços colapsados."""
    s = _strip_accents((s or "").strip().lower())
    return " ".join(s.split())


def _norm_situacao(s: str) -> str:
    return _strip_accents((s or "").strip().upper())


def _sniff(path: str) -> tuple[str, str]:
    """Detecta encoding (utf-8-sig -> latin-1) e delimitador (; ou ,)."""
    raw = open(path, "rb").read(8192)
    encoding = "utf-8-sig"
    try:
        head = raw.decode(encoding)
    except UnicodeDecodeError:
        encoding = "latin-1"
        head = raw.decode(encoding)
    first_line = head.splitlines()[0] if head.splitlines() else ""
    delimiter = ";" if first_line.count(";") >= first_line.count(",") else ","
    return encoding, delimiter


def _build_index(header: list[str]) -> dict[str, int]:
    """Mapeia coluna-alvo -> índice no CSV, pelo nome do cabeçalho."""
    upper = {h.strip().upper(): i for i, h in enumerate(header)}
    idx: dict[str, int] = {}
    for alvo, candidatos in COLUNAS.items():
        for c in candidatos:
            if c in upper:
                idx[alvo] = upper[c]
                break
    return idx


def _cell(row: list[str], idx: dict[str, int], alvo: str) -> str:
    i = idx.get(alvo)
    if i is None or i >= len(row):
        return ""
    return (row[i] or "").strip()


def parse_csv(path: str, situacao_valida: str, limit: int | None):
    """Lê o CSV e devolve (registros_dedup, stats, header, encoding, delimiter)."""
    encoding, delimiter = _sniff(path)
    vistos: dict[str, dict] = {}
    stats = {"linhas": 0, "sem_principio": 0, "fora_situacao": 0, "duplicatas": 0}
    header: list[str] = []
    idx: dict[str, int] = {}

    with open(path, encoding=encoding, newline="") as f:
        reader = csv.reader(f, delimiter=delimiter)
        for n, row in enumerate(reader):
            if n == 0:
                header = row
                idx = _build_index(header)
                if "nome_generico" not in idx:
                    raise SystemExit(
                        f"ERRO: não achei coluna de princípio ativo no cabeçalho.\n"
                        f"Cabeçalho: {header}\n"
                        f"Ajuste COLUNAS['nome_generico'] no script."
                    )
                continue
            if not row:
                continue
            stats["linhas"] += 1

            principio = _cell(row, idx, "nome_generico")
            if not principio:
                stats["sem_principio"] += 1
                continue

            situacao = _cell(row, idx, "situacao")
            if situacao and situacao_valida and situacao_valida not in _norm_situacao(situacao):
                stats["fora_situacao"] += 1
                continue

            nome_prod = _cell(row, idx, "nome_comercial")
            chave = f"{_norm_key(nome_prod)}|{_norm_key(principio)}"
            if chave in vistos:
                stats["duplicatas"] += 1
                continue

            classe = _cell(row, idx, "classe_terapeutica") or "Não informado"
            categoria = _cell(row, idx, "categoria")
            vistos[chave] = {
                "chave_anvisa": chave,
                "nome_comercial": nome_prod or None,
                "nome_generico": principio,
                "classe_terapeutica": classe,
                "registro_anvisa": _cell(row, idx, "registro_anvisa") or None,
                "laboratorio": _cell(row, idx, "laboratorio") or None,
                "observacoes": (f"Categoria ANVISA: {categoria}" if categoria else None),
            }
            if limit and len(vistos) >= limit:
                break

    return list(vistos.values()), stats, header, encoding, delimiter


async def upsert(dsn: str, registros: list[dict]) -> int:
    import asyncpg  # import tardio: só no caminho real (dry-run não precisa)

    sql = """
        INSERT INTO medicamentos
            (nome_comercial, nome_generico, classe_terapeutica, registro_anvisa,
             laboratorio, observacoes, origem, chave_anvisa, em_destaque, ativo)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE, TRUE)
        ON CONFLICT (chave_anvisa) WHERE chave_anvisa IS NOT NULL
        DO UPDATE SET
            nome_comercial     = EXCLUDED.nome_comercial,
            classe_terapeutica = EXCLUDED.classe_terapeutica,
            registro_anvisa    = EXCLUDED.registro_anvisa,
            laboratorio        = EXCLUDED.laboratorio,
            observacoes        = EXCLUDED.observacoes,
            origem             = EXCLUDED.origem,
            ativo              = TRUE
    """
    pool = await asyncpg.create_pool(dsn, min_size=1, max_size=2)
    assert pool is not None
    afetados = 0
    try:
        async with pool.acquire() as conn:
            for i in range(0, len(registros), BATCH_SIZE):
                lote = registros[i : i + BATCH_SIZE]
                async with conn.transaction():
                    await conn.executemany(
                        sql,
                        [
                            (
                                r["nome_comercial"], r["nome_generico"], r["classe_terapeutica"],
                                r["registro_anvisa"], r["laboratorio"], r["observacoes"],
                                ORIGEM, r["chave_anvisa"],
                            )
                            for r in lote
                        ],
                    )
                afetados += len(lote)
                print(f"  ... {afetados}/{len(registros)} upserted", flush=True)
    finally:
        await pool.close()
    return afetados


def main() -> None:
    ap = argparse.ArgumentParser(description="Ingestão ANVISA -> medicamentos (exibição).")
    src = ap.add_mutually_exclusive_group()
    src.add_argument("--file", help="caminho do CSV já baixado (recomendado)")
    src.add_argument("--url", default=DEFAULT_URL, help=f"URL do CSV ANVISA (default: {DEFAULT_URL})")
    ap.add_argument("--dry-run", action="store_true", help="parseia e mostra, sem escrever no banco")
    ap.add_argument("--situacao-valida", default="VALIDO",
                    help="substring (sem acento, maiúsc.) de SITUACAO_REGISTRO p/ aceitar (default: VALIDO)")
    ap.add_argument("--limit", type=int, default=None, help="máx. de registros (teste)")
    args = ap.parse_args()

    path = args.file
    if not path:
        if args.dry_run:
            raise SystemExit("Em --dry-run passe --file (não baixo a rede no dry-run). Baixe o CSV antes.")
        import urllib.request
        path = "/tmp/anvisa_medicamentos.csv"
        print(f"Baixando {args.url} -> {path} ...", flush=True)
        urllib.request.urlretrieve(args.url, path)  # noqa: S310 (URL fixa da ANVISA)

    registros, stats, header, encoding, delimiter = parse_csv(path, args.situacao_valida, args.limit)

    print("=== Ingestão ANVISA -> medicamentos (catálogo de exibição) ===")
    print(f"Arquivo:     {path}")
    print(f"Encoding:    {encoding}   Delimitador: {delimiter!r}")
    print(f"Cabeçalho:   {header}")
    print(f"Mapeamento:  {_build_index(header)}  (alvo -> índice de coluna)")
    print(f"Linhas lidas:        {stats['linhas']}")
    print(f"  sem princípio:     {stats['sem_principio']} (puladas — nome_generico é NOT NULL)")
    print(f"  fora da situação:  {stats['fora_situacao']} (SITUACAO != {args.situacao_valida!r})")
    print(f"  duplicatas:        {stats['duplicatas']} (mesma chave nome+princípio)")
    print(f"Registros únicos:    {len(registros)}")
    print("Amostra (até 5):")
    for r in registros[:5]:
        print(f"  - {r['nome_comercial']!r} | {r['nome_generico']!r} | {r['classe_terapeutica']!r}"
              f" | reg={r['registro_anvisa']!r} | lab={r['laboratorio']!r}")

    if args.dry_run:
        print("\n[dry-run] nada escrito. Confira o mapeamento acima e rode sem --dry-run.")
        return

    if not registros:
        raise SystemExit("Nenhum registro válido p/ inserir. Abortando.")

    dsn = os.environ.get("POSTGRES_DSN_URL") or os.environ.get("POSTGRES_DSN")
    if not dsn:
        raise SystemExit("Defina POSTGRES_DSN_URL (ou POSTGRES_DSN) com o DSN do Postgres clínico.")

    print(f"\nEscrevendo {len(registros)} registros (UPSERT por chave_anvisa, origem={ORIGEM!r}) ...")
    afetados = asyncio.run(upsert(dsn, registros))
    print(f"OK: {afetados} registros upserted. (motor A5 NÃO foi tocado.)")


if __name__ == "__main__":
    main()
