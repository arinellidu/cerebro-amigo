#!/usr/bin/env python3
"""
Cria um usuário owner no sistema.
Uso: python3 infra/seed/create_owner.py

Requer: bcrypt (pip install bcrypt) ou psycopg3/asyncpg
"""

import os
import sys
import uuid

try:
    import bcrypt
except ImportError:
    print("Erro: bcrypt não instalado. Rode: pip install bcrypt")
    sys.exit(1)

# ─── Configuração ────────────────────────────────────────────────────────────
EMAIL = "arinelli@cerebroamigo.com.br"
SENHA = "bBhihi29#"
NOME = "Rafaela Arinelli"
ROLE = "owner"

DB_URL = os.environ.get("POSTGRES_DSN_URL", "")
if not DB_URL:
    # Tenta ler do .env
    env_path = os.path.join(os.path.dirname(__file__), "../..", ".env")
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                if line.startswith("POSTGRES_DSN_URL="):
                    DB_URL = line.split("=", 1)[1].strip()
                    break

if not DB_URL:
    print("Erro: POSTGRES_DSN_URL não encontrado (variável de ambiente ou .env)")
    sys.exit(1)

# ─── Gera hash bcrypt (work factor 12, igual ao gateway .NET) ────────────────
print(f"Gerando hash bcrypt para {EMAIL}...")
senha_bytes = SENHA.encode("utf-8")
senha_hash = bcrypt.hashpw(senha_bytes, bcrypt.gensalt(rounds=12)).decode("utf-8")

print(f"Hash gerado: {senha_hash[:30]}...")

# ─── Insere no banco ───────────────────────────────────────────────────────
try:
    import psycopg
except ImportError:
    print("Erro: psycopg não instalado. Rode: pip install psycopg[binary]")
    sys.exit(1)

usuario_id = str(uuid.uuid4())

with psycopg.connect(DB_URL) as conn:
    with conn.cursor() as cur:
        # Verifica se o email já existe
        cur.execute("SELECT id FROM usuarios WHERE email = %s", (EMAIL.lower(),))
        if cur.fetchone():
            print(f"Usuário {EMAIL} já existe. Atualizando role para 'owner' e senha...")
            cur.execute(
                "UPDATE usuarios SET senha_hash = %s, role = %s WHERE email = %s",
                (senha_hash, ROLE, EMAIL.lower()),
            )
        else:
            print(f"Criando usuário owner: {EMAIL}")
            cur.execute(
                "INSERT INTO usuarios (id, email, senha_hash, nome, role) VALUES (%s, %s, %s, %s, %s)",
                (usuario_id, EMAIL.lower(), senha_hash, NOME, ROLE),
            )
        conn.commit()

print(f"✓ Usuário owner criado/atualizado: {EMAIL}")
print(f"  Senha: {SENHA}")
print(f"  Role: {ROLE}")
print("")
print("Agora você pode fazer login em /login com essas credenciais.")
