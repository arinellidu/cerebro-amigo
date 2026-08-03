#!/usr/bin/env python3
"""
Rebaixa o usuário demo de owner/admin para medico.
Uso: python3 infra/seed/demote_demo.py
"""

import os
import sys

DB_URL = os.environ.get("POSTGRES_DSN_URL", "")
if not DB_URL:
    env_path = os.path.join(os.path.dirname(__file__), "../..", ".env")
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                if line.startswith("POSTGRES_DSN_URL="):
                    DB_URL = line.split("=", 1)[1].strip()
                    break

if not DB_URL:
    print("Erro: POSTGRES_DSN_URL não encontrado")
    sys.exit(1)

try:
    import psycopg
except ImportError:
    print("Erro: psycopg não instalado. Rode: pip install psycopg[binary]")
    sys.exit(1)

# Rebaixa o usuário demo (criado pelo seed) de owner/admin para medico
with psycopg.connect(DB_URL) as conn:
    with conn.cursor() as cur:
        # Lista usuários com role owner/admin antes
        cur.execute("SELECT id, email, nome, role FROM usuarios WHERE role IN ('owner', 'admin')")
        rows = cur.fetchall()
        print("Usuários owner/admin antes:")
        for r in rows:
            print(f"  {r[1]} ({r[2]}) -> role={r[3]}")

        # Rebaixa o demo para medico
        cur.execute(
            "UPDATE usuarios SET role = 'medico' WHERE email = 'demo@cerebroamigo.com'"
        )
        if cur.rowcount == 0:
            print("\nAviso: demo@cerebroamigo.com não encontrado.")
        else:
            print(f"\n✓ demo@cerebroamigo.com rebaixado para 'medico'.")

        # Também tenta pelo nome, caso o email seja diferente
        cur.execute(
            "UPDATE usuarios SET role = 'medico' WHERE nome ILIKE '%adonai%' AND role IN ('owner', 'admin')"
        )
        if cur.rowcount > 0:
            print(f"✓ {cur.rowcount} usuário(s) com nome 'Adonai' rebaixado(s) para 'medico'.")

        conn.commit()

        # Verifica restantes
        cur.execute("SELECT id, email, nome, role FROM usuarios WHERE role IN ('owner', 'admin')")
        remaining = cur.fetchall()
        print(f"\nUsuários owner/admin agora ({len(remaining)}):")
        for r in remaining:
            print(f"  {r[1]} ({r[2]}) -> role={r[3]}")

print("\nPronto. O usuário demo não é mais owner/admin.")
