# ADR-017: Imutabilidade do audit trail garantida no banco

**Status:** Accepted
**Data:** 2026-06-02
**Decisores:** Equipe de engenharia
**Categoria:** Segurança clínica / Compliance

## Contexto

Três tabelas são trilhas de auditoria do produto e estão sujeitas à regra
inegociável "append-only" (CLAUDE.md, CONTEXT.md, ADR-005, ADR-006):

- `protocolos_crise_acionados` — todo acionamento do protocolo de crise.
- `notificacoes_medico` — notificações ao médico (incl. severidade crítica).
- `agente_execucoes` — registro de execuções dos agentes analíticos.

Até aqui, "append-only" era apenas uma **convenção de código**: o orchestrator
e os agentes só faziam `INSERT` (e alguns `UPDATE` legítimos). Mas nada no
banco impedia que um bug, uma migration distraída, um script ad-hoc ou um
acesso direto via `psql` apagasse ou adulterasse uma linha. Em um sistema de
saúde mental com responsabilidade clínica delegada e auditabilidade
regulatória (LGPD categoria especial), perder ou alterar um registro de crise
é inaceitável.

Complicação: nem todo `UPDATE` é ilegítimo.
- `notificacoes_medico` tem `lida`/`lida_em`, que mudam quando o médico marca
  como lida/não-lida (gateway `PrescricoesEndpoints.cs`). Estado de leitura é
  mutável por design.
- `agente_execucoes` registra o ciclo de vida do job: inicia com `iniciado_em`
  e depois `_finalize_execution` preenche `concluido_em`, `sucesso`, `erro`,
  `insight_id`, tokens, custo e modelo. Esses `UPDATE`s são legítimos.

## Decisão

**Mover a garantia de imutabilidade para o banco, via triggers `BEFORE`
(migration `0007_audit_trail_imutavel.sql`), com política por tabela:**

- `protocolos_crise_acionados` → **totalmente imutável**: qualquer `UPDATE` ou
  `DELETE` levanta exceção. Só `INSERT`.
- `notificacoes_medico` → `DELETE` proibido; `UPDATE` permitido **apenas** se
  somente `lida`/`lida_em` mudarem.
- `agente_execucoes` → `DELETE` proibido; `UPDATE` permitido **apenas** nas
  colunas de resultado da execução (`concluido_em`, `sucesso`, `erro`,
  `insight_id`, `tokens_in`, `tokens_out`, `custo_usd`, `modelo`). Identidade
  (`id`, `paciente_id`, `agente`, `iniciado_em`) e `metadata` são imutáveis.

A detecção de "o que mudou" usa `to_jsonb(NEW)`/`to_jsonb(OLD)` menos as chaves
mutáveis, comparados com `IS DISTINCT FROM`. Remover uma chave inexistente de
`jsonb` é no-op, então a política continua válida mesmo que migrations futuras
adicionem colunas — qualquer coluna nova é, por padrão, imutável (fail-safe).

Verificação: `infra/migrations/tests/test_audit_imutavel.sh` sobe um Postgres
efêmero (Docker), aplica os triggers e assere os 10 casos (INSERT/UPDATE/DELETE
permitidos e bloqueados por tabela). Não toca em banco real.

## Alternativas consideradas

### A — Manter só convenção de código (status quo)
Rejeitada: não protege contra bug, migration, script ad-hoc ou acesso direto.
A regra é "inegociável"; uma garantia que depende de ninguém errar não é
garantia.

### B — `REVOKE UPDATE, DELETE` no role da aplicação
Bloquearia também os `UPDATE`s legítimos (marcar lida, finalizar execução).
Para liberá-los precisaríamos de colunas em tabelas separadas ou de um segundo
role — mais complexo e ainda sem proteger contra superusuário. Triggers
expressam a política com a granularidade de coluna que o domínio exige.
Pode ser somado no futuro como camada extra (não exclui esta decisão).

### C — Tabela de histórico/event sourcing
Sobre-engenharia para o momento. As três tabelas já são, na prática, o log
de eventos. O custo de migrar o modelo não se justifica agora.

## Consequências aceitas

1. Tentativas de `DELETE`/`UPDATE` proibido falham com `ERRCODE
   check_violation` — o chamador (app ou humano) recebe erro explícito. Código
   de aplicação que dependa silenciosamente de apagar essas tabelas vai quebrar
   (é o efeito desejado).
2. Migrations futuras que **precisem** alterar a estrutura dessas tabelas devem
   considerar os triggers (ex.: `ALTER TABLE` é DDL, não afetado; mas backfills
   via `UPDATE` serão bloqueados e exigem decisão explícita — provavelmente um
   novo ADR).
3. Colunas adicionadas no futuro são imutáveis por padrão. Se uma nova coluna
   precisar ser mutável, a lista de chaves mutáveis no trigger correspondente
   deve ser atualizada conscientemente.

## Gatilhos de revisão

- Necessidade legítima de editar conteúdo de uma trilha (ex.: correção
  regulatória obrigatória) → exige novo ADR e procedimento auditável, não
  remoção do trigger.
- Adoção de role/REVOKE como camada adicional de defesa.
- Migração para modelo de event sourcing dedicado.
