# Runbook — Ingestão ANVISA → catálogo `medicamentos` (exibição)

Expande a tabela `medicamentos` (busca + picker de "Medicações em uso", ADR-062) a
partir dos Dados Abertos da ANVISA. **Catálogo de EXIBIÇÃO** — não é o motor de
interações.

## Escopo e segurança clínica (ler antes)

- Escreve **só fatos de registro** do arquivo oficial da ANVISA: princípio ativo,
  nome do produto, classe terapêutica, nº de registro, laboratório.
- **NÃO toca** o motor de interações A5 (`medicamento_dicionario` /
  `interacao_catalogo`, migration 0029) — esse segue **curado e atestado pelo Dr.
  Adonai**. (clinical-safety regra #1: a IA não inventa dado clínico.)
- **NÃO grava** dose, indicação, interação ou conduta. `dosagens` /
  `indicacoes_resumo` ficam vazios (pendentes de Adonai, DEBT G-10).
- Os dados vêm do CSV da ANVISA — o script não fabrica linhas de catálogo.

## Fonte

- CSV: `https://dados.anvisa.gov.br/dados/DADOS_ABERTOS_MEDICAMENTOS.csv`
- Dicionário: `https://dados.anvisa.gov.br/dados/Documentacao_e_Dicionario_de_Dados_Registros_Validos_Medicamento_V1.pdf`
- Atualiza D-1 (dia útil anterior). Inclui registros válidos e cancelados/vencidos
  (filtramos por `SITUACAO_REGISTRO`).

## Pré-requisitos

1. Migration **0056** aplicada (`origem` + `chave_anvisa` + índices).
2. Acesso ao box clínico via Session Manager (RDS é privado).
3. DSN do Postgres clínico em `POSTGRES_DSN_URL` (DB **cerebro_v3**).
4. Python 3 + `asyncpg` (já presentes nos serviços Python do box).

## Passos

### 1. Aplicar a migration 0056

Via SSM, forçando o DB correto (o `.env` do box é stale — ver runbook de migrations):

```bash
PGDATABASE=cerebro_v3 psql "$POSTGRES_DSN_URL" -f infra/migrations/0056_medicamentos_origem_anvisa.sql
```

### 2. Baixar o CSV no box

```bash
curl -fsSL -o /tmp/anvisa.csv \
  https://dados.anvisa.gov.br/dados/DADOS_ABERTOS_MEDICAMENTOS.csv
```

### 3. Dry-run — CONFERIR o mapeamento antes de escrever

```bash
python3 infra/scripts/import_anvisa_medicamentos.py --file /tmp/anvisa.csv --dry-run
```

Confira no output:
- **Cabeçalho** e **Mapeamento** (alvo → índice) fazem sentido. Se a ANVISA mudou
  nomes de coluna, ajuste o dict `COLUNAS` no script e repita o dry-run.
- Delimitador/encoding detectados batem (esperado: `;` + `utf-8-sig`/`latin-1`).
- Contagens: linhas, puladas (sem princípio), fora-da-situação, duplicatas, únicos.

### 4. Rodar de verdade (idempotente)

```bash
export POSTGRES_DSN_URL="postgresql://.../cerebro_v3"
python3 infra/scripts/import_anvisa_medicamentos.py --file /tmp/anvisa.csv
```

UPSERT por `chave_anvisa`; `origem='anvisa-dados-abertos'`, `em_destaque=FALSE`.
Rodar 2x não duplica.

### 5. Verificar

```sql
SELECT origem, count(*) FROM medicamentos GROUP BY origem;
-- esperado: 'seed-a5' ~50  |  'anvisa-dados-abertos' (milhares)
```

Spot-check na UI: busca em `/api/v1/medicamentos?q=...` e o picker de "Medicações
em uso" no prontuário.

## Rollback

```sql
DELETE FROM medicamentos WHERE origem = 'anvisa-dados-abertos';
```

(As ~50 linhas `seed-a5` e o motor A5 ficam intactos.)

## Atualização periódica

Re-rodar os passos 2–4 (a ANVISA atualiza D-1). O UPSERT atualiza dados que
mudaram e insere novos; não remove registros que saíram do arquivo (limpeza
manual via rollback + re-run, se necessário).

## Limitação conhecida (follow-up)

`GET /api/v1/medicamentos/agrupado` (browse-all do picker) usa `LIMIT 1000`. Com
milhares de fármacos, o browse-all trunca. A busca por texto
(`GET /api/v1/medicamentos?q=`) continua correta. Avaliar paginação no `/agrupado`
ou priorizar a busca na UI — anotar em DEBT se virar incômodo.
