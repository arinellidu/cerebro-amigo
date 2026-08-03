-- =============================================================================
-- 0056 — Procedência do catálogo `medicamentos` + chave p/ ingestão ANVISA
-- =============================================================================
-- Objetivo: permitir EXPANDIR a tabela `medicamentos` (catálogo de EXIBIÇÃO: busca
-- e picker de "Medicações em uso") a partir dos Dados Abertos da ANVISA
-- (DADOS_ABERTOS_MEDICAMENTOS.csv) de forma factual e idempotente, via o script
-- infra/scripts/import_anvisa_medicamentos.py.
--
-- ESCOPO (clinical-safety #1 — a IA não inventa dado clínico): esta tabela é SÓ
-- exibição/reconciliação. O motor de alerta de interações A5
-- (medicamento_dicionario + interacao_catalogo, migration 0029) NÃO é tocado por
-- esta via e segue CURADO/ATESTADO pelo médico (Dr. Adonai). Nenhum dado clínico
-- (dose, interação, conduta, indicação) entra por aqui — só fatos de registro
-- vindos do arquivo oficial da ANVISA: princípio ativo, nome do produto, classe
-- terapêutica, número de registro, laboratório detentor.
--
-- Adiciona:
--   - origem        : procedência da linha ('seed-a5' | 'anvisa-dados-abertos')
--   - chave_anvisa  : chave natural normalizada, alvo do UPSERT idempotente
-- Idempotente (IF NOT EXISTS / WHERE origem IS NULL).
-- =============================================================================

ALTER TABLE medicamentos ADD COLUMN IF NOT EXISTS origem       TEXT;
ALTER TABLE medicamentos ADD COLUMN IF NOT EXISTS chave_anvisa TEXT;

-- Marca as ~50 linhas semeadas do dicionário A5 (migration 0047) como tal, para
-- distinguir do que vier da ANVISA. Só onde ainda não classificado (idempotente).
UPDATE medicamentos SET origem = 'seed-a5' WHERE origem IS NULL;

-- Alvo do UPSERT da ingestão ANVISA: uma linha por chave natural.
-- NUMERO_REGISTRO_PRODUTO se REPETE no dataset (multi-fabricante / multi-país),
-- então a chave NÃO é só o registro — o script compõe nome do produto + princípio
-- ativo normalizados (colapsa duplicatas de fabricante p/ um picker limpo).
CREATE UNIQUE INDEX IF NOT EXISTS medicamentos_chave_anvisa_uidx
    ON medicamentos (chave_anvisa)
    WHERE chave_anvisa IS NOT NULL;

-- Lookup por registro (consulta/auditoria).
CREATE INDEX IF NOT EXISTS medicamentos_registro_anvisa_idx
    ON medicamentos (registro_anvisa)
    WHERE registro_anvisa IS NOT NULL;
