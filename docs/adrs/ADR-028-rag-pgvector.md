# ADR-028: RAG com pgvector — busca semântica doctor-facing (A + B)

**Status:** Accepted
**Data:** 2026-06-04
**Decisores:** Equipe de engenharia + psiquiatra responsável clínico
**Categoria:** Produto / IA / Segurança clínica

## Contexto

pgvector e a tabela `conhecimento` existem desde `0001_init.sql`, mas nunca foram
usados — comentário "RAG futuro", zero código. O roadmap pede recuperação
semântica para dois usos doctor-facing:

- **A — base de conhecimento do médico:** catálogo `medicamentos` (e, no futuro,
  docs que o médico subir). "Buscar na minha base."
- **B — prontuário do paciente:** mensagens do paciente, diário, sintomas, eventos,
  notas de consulta. "Quando ele relatou insônia antes?"

Um terceiro uso — **C, memória do agente conversacional do paciente** — foi
**adiado** (ver Consequências): é patient-facing e herda toda a stack de
segurança clínica.

## Decisão

1. **Modelo de embedding = Cohere Multilingual v3 @ 1024, on-demand IN-REGION
   (sa-east-1).** Decisão de **compliance**, não de preferência: Cohere Embed v4
   (1536) só é invocável via inference profile `global.cohere.embed-v4:0`, que
   roteia a inferência cross-region — **viola a residência de dado** (ADR-008,
   regra clínica #4: dado/inferência de saúde mental ficam no Brasil). O v3 roda
   on-demand de fato em sa-east-1. A tabela estava vazia, então redimensionar
   `vector(1536) → vector(1024)` teve custo zero. Embedding é **sempre Bedrock**
   (Anthropic não tem API de embedding), independente de `LLM_PROVIDER`.

2. **Schema = `conhecimento` generalizado em chunk store** (`0022_rag_chunks.sql`):
   `paciente_id` NULL ⇒ KB do médico (A); preenchido ⇒ chunk de prontuário (B).
   Colunas de procedência `fonte_tipo`/`fonte_id`/`chunk_idx`, `metadata`,
   `modelo_embed`, `fonte_hash` (reindex incremental). Índice **HNSW cosine**.
   Catálogo `medicamentos` (referência não-PII, global) é indexado sob um **tenant
   sentinela** (`00000000-…-0`); só dado de referência não-PII pode usá-lo.

3. **Interplay com ADR-018 (cifragem em repouso).** Fontes clínicas sensíveis
   **não re-armazenam plaintext** no chunk store: guarda-se só o **vetor + ponteiro**
   (`fonte_tipo`, `fonte_id`); `conteudo` fica NULL. No read, o texto é re-buscado
   na fonte e **decifrado** para o médico autorizado. O embedding já é desacoplado
   do ciphertext (previsto no ADR-018).

4. **Retrieval-only, doctor-facing.** A busca devolve **trechos citados** (com link
   à fonte), **nunca conduta gerada** — não há passo de LLM produzindo recomendação
   (regra #1). Indexa-se `mensagens.papel = 'user'` (fala do paciente, fato
   relatado); **nunca `'assistant'`** — não ressurgir texto de IA como se fosse fato.

5. **Fronteira de serviço (cerebro-architecture).** Embedding, indexação e
   retrieval vivem no **agents-py** (LLM/embedding só em Python). O **gateway .NET**
   apenas faz **proxy** e injeta `medico_id` do JWT como tenant — **server-side,
   nunca do body do cliente**. BFF cuida do cookie; a UI é só do médico.

### clinical-safety

- **#1 IA não pratica medicina:** retrieval factual; devolve trechos, não opinião.
  Sem geração de conduta/dose/diagnóstico.
- **#3 Médico no loop:** v1 é 100% doctor-facing; não há caminho que entregue
  resultado da busca ao paciente.
- **#4 LGPD:** filtro de tenant é a **primeira cláusula** de toda query; inferência
  in-region; `texts` nunca é logado (só contagem/dimensão); fontes sensíveis ficam
  pointer-only (decifradas só no read).
- **#5 Auditoria imutável:** `conhecimento` **não** é trilha de auditoria — reindex
  pode UPDATE/DELETE nela. O indexador **nunca** toca `protocolos_crise_acionados`,
  `notificacoes_medico`, `agente_execucoes`.

## Consequências

- **Migration `0022`:** `conhecimento` vira chunk store (1024-dim, HNSW, procedência).
- **agents-py:** `services/embeddings.py` (Cohere v3 via boto3), `services/chunking.py`,
  `services/retrieval.py`, `jobs/indexador_rag.py` (+ registro no scheduler),
  endpoints `/internal/rag/{index/kb,index/paciente/{id},buscar}`. Config nova:
  `EMBEDDINGS_ENABLED`, `BEDROCK_EMBED_MODEL`, `RAG_TOP_K`, `RAG_INDEX_INTERVAL_HOURS`.
- **Gateway:** `RagEndpoints.cs` (proxy, tenant do JWT). **Web:** BFF
  `/api/rag/buscar` + componente `BuscaSemantica` no prontuário.
- **C adiado (futuro):** memória do agente conversacional do paciente. Quando
  entrar, é patient-facing → passa por `audit_response` + protocolo de crise +
  **SHADOW_MODE** antes de qualquer ação real.
- **Flag fora deste ADR:** os *chat models* usam `global.anthropic.*` (mesma tensão
  de residência cross-region do v4). Em sa-east-1 não há on-demand Anthropic
  in-region — decisão/risco a revisitar separadamente do embedding.
