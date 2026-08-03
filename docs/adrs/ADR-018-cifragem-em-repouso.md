# ADR-018: Cifragem em repouso de dados clínicos

**Status:** Accepted
**Data:** 2026-06-02
**Decisores:** Equipe de engenharia
**Categoria:** Segurança clínica / Compliance / LGPD

## Contexto

LGPD categoria especial (saúde mental) exige medidas técnicas de proteção ao
dado sensível. Atualmente, o sistema conta com:

1. **RDS encryption at rest** (storage-level via AWS KMS) — presumivelmente ativo
   (padrão AWS para instâncias modernas), protege contra acesso físico aos
   discos e snapshots.
2. **TLS nas conexões** — RDS força SSL por padrão; drivers (.NET Npgsql,
   Python asyncpg/psycopg) negociam TLS automaticamente. Protege dados em
   trânsito.
3. **pgcrypto** — extensão carregada no Postgres (`CREATE EXTENSION pgcrypto`)
   mas **NÃO utilizada** para cifragem de coluna. Nenhuma coluna sensível é
   cifrada.

O gap é a **cifragem de coluna** (column-level encryption): protege contra
acesso ao banco com credenciais vazadas, queries ad-hoc por DBA, ou backups
copiados sem a chave de cifra.

Colunas candidatas à cifragem (por criticidade):
- `mensagens.conteudo` — conversa paciente↔IA (texto clínico)
- `diario_entradas.nota` / `diario_entradas.audio_transcricao` — notas do paciente
- `sintomas.nota` — paráfrase clínica
- `prescricoes.observacoes` — observações médicas
- `notificacoes_medico.mensagem` — notificações (podem conter resumo clínico)

## Decisão

**Implementar cifragem de aplicação (application-level encryption), NÃO cifragem
no banco com pgcrypto.**

### Por que não pgcrypto

1. **Chave no banco.** `pgp_sym_encrypt` requer a chave no contexto do Postgres
   (`current_setting` ou passada em cada query). Isso expõe a chave em logs de
   query do Postgres e a mantém no mesmo ambiente dos dados.
2. **Performance.** Cifra/decifra por linha no banco é mais lenta que na
   aplicação (especialmente em queries com JOINs e filtros).
3. **Alteração de schema.** Colunas cifradas com pgcrypto precisam ser `bytea`,
   exigindo `ALTER COLUMN TYPE` em tabelas potencialmente grandes.
4. **Perda de índices.** Índices textuais (GIN, trigram) em colunas cifradas
   param de funcionar.

### Por que cifragem de aplicação

1. **Chave fora do banco.** A chave de cifra (`ENCRYPTION_KEY`) vive como
   variável de ambiente/secreto nos serviços (.NET gateway, Python services),
   nunca no Postgres.
2. **Algoritmo moderno.** Usamos AES-256-GCM via bibliotecas consolidadas
   (Python: `cryptography`; .NET: `System.Security.Cryptography`).
3. **Schema inalterado.** Colunas permanecem `TEXT`; o valor cifrado é
   base64-encoded antes do INSERT. Queries SELECT recebem base64 e a aplicação
   decifra.
4. **Controle de granularidade.** Podemos cifrar apenas as colunas que precisam,
   sem afetar o restante do schema.
5. **Portabilidade.** Se migrarmos de Postgres para outro banco, os dados
   cifrados acompanham sem alteração.

### Arquitetura

```
Aplicação (.NET / Python)
  ↓ cifra com AES-256-GCM + ENCRYPTION_KEY
  ↓ base64 do ciphertext
Postgres (coluna TEXT)
  ↑ base64 do ciphertext
Aplicação (.NET / Python)
  ↑ decifra com AES-256-GCM + ENCRYPTION_KEY
```

- `ENCRYPTION_KEY` = 32 bytes (256 bits), gerado via `openssl rand -hex 32`.
- Formato do ciphertext: `base64(nonce + tag + ciphertext)` usando AES-GCM.
- Nonce = 12 bytes, gerado aleatoriamente por mensagem (nunca reutilizado).

### Escopo incremental

Não ciframos TUDO de uma vez. Ordem de prioridade:

| Fase | Tabelas/Colunas | Serviço responsável |
|---|---|---|
| 1 | `mensagens.conteudo` | orchestrator-py + gateway (.NET) |
| 2 | `diario_entradas.nota`, `audio_transcricao` | gateway (.NET) |
| 3 | `sintomas.nota` | orchestrator-py |
| 4 | `prescricoes.observacoes` | gateway (.NET) |
| 5 | `notificacoes_medico.mensagem` | gateway (.NET) + orchestrator-py |

Fase 1 é o MVP — prova o padrão e protege a conversa paciente↔IA, que é o dado
mais sensível e volume mais alto.

### Backward compatibility

- Nova variável: `ENCRYPTION_KEY` (opcional em dev, obrigatória em prod).
- Se `ENCRYPTION_KEY` não estiver definida, o sistema opera em **modo legacy**
  (não cifra; lê como plaintext). Isso permite deploy gradual sem quebrar
  instalações existentes.
- Migration de transição: detecta se `mensagens.conteudo` está em plaintext
  (não começa com o prefixo de versão do ciphertext) e aplica cifra via script
  one-off, OFF-LINE, fora do fluxo de aplicação.

## Alternativas consideradas

### A — pgcrypto no banco
Rejeitada: chave no banco, performance pior, schema muda, índices quebram.

### B — AWS RDS encryption at rest apenas (status quo)
Rejeitada: protege só contra acesso físico aos discos. Não protege contra
 credenciais vazadas, DBA malicioso, ou query ad-hoc. LGPD categoria especial
 exige defesa em profundidade.

### C — AWS CloudHSM / KMS envelope encryption
Futura consideração. KMS envelope encryption (data key cifrada por master key)
 é mais seguro que chave estática, mas adiciona latência de rede e custo.
 Pode ser adotado como evolução do ADR-018 em fase posterior.

## Consequências aceitas

1. Queries que precisam filtrar por conteúdo textual (ex.: busca em mensagens)
   não funcionam diretamente sobre colunas cifradas. Solução: busca em vetor
   (`pgvector`) sobre embeddings (sempre desacoplada do texto original) ou
   busca em índice separado (coluna de hash/keywords não cifrada).
2. Custo de CPU na aplicação para cifra/decifra. AES-256-GCM em hardware
   moderno é rápido (~GB/s); para volume clínico típico, impacto é negligenciável.
3. Backups do banco contêm dados cifrados — só recuperáveis com `ENCRYPTION_KEY`.
   Isso é uma feature (proteção), mas exige que o secret seja backup-ado
   separadamente (ex.: AWS Secrets Manager com cross-region replication).

## Gatilhos de revisão

- Migração para KMS envelope encryption (CloudHSM ou AWS KMS).
- Necessidade de busca textual direta em colunas cifradas (ex.: full-text search
  em mensagens) — pode exigir redesign do índice.
- Auditoria regulatória que questione a ausência de cifragem de coluna.

## Status de implementação

- [x] ADR registrado
- [ ] Variável `ENCRYPTION_KEY` adicionada ao `.env.example`
- [ ] Funções de cifra/decifra implementadas em .NET e Python
- [ ] Fase 1 (`mensagens.conteudo`) implementada
- [ ] Script one-off de migração de dados legados
