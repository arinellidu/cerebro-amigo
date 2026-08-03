# ADR-029: Monitoramento de exames laboratoriais e segurança farmacológica

**Status:** Accepted
**Data:** 2026-06-04
**Decisores:** Equipe de engenharia + psiquiatra responsável clínico
**Categoria:** Produto / Segurança clínica

> Nota de numeração: ADR-028 ficou com o RAG (pgvector), trabalho paralelo. Este
> é o 029; a migration é a **0023** (a 0022 é do RAG).

## Contexto

Psiquiatria exige monitoramento laboratorial obrigatório que estava 100% ausente:
litemia (lítio), hemograma seriado (clozapina — agranulocitose), perfil
metabólico/peso (antipsicóticos), função hepática (valproato), ECG/QT. É segurança
do paciente + proteção médico-legal, e nenhum concorrente genérico faz. Item S2.

Achado de implementação: `prescricoes.medicamento` é **TEXT livre** (sem FK ao
catálogo `medicamentos`), então o casamento medicamento→protocolo não pode
depender de FK.

## Decisão

Scheduler **determinístico** dirigido pelas prescrições ativas. **Sem LLM**: o
protocolo é conhecimento clínico padronizado, versionado; as faixas de referência
são dado factual; a decisão é sempre do médico (regra #1).

1. **Catálogo de protocolo versionado** (`agents-py/app/jobs/exame_protocolo.py`,
   `exames-v1`): mapeia o medicamento → exames exigidos + cadência + faixa de
   referência. Casamento por **palavra-chave** no nome (normalizado, sem acento),
   robusto ao texto livre. v1 cobre: lítio→litemia (0,6–1,2 mEq/L); clozapina→
   hemograma/neutrófilos (≥1,5 ×10⁹/L); valproato→TGP (7–56 U/L); antipsicóticos
   atípicos→glicemia (70–99 mg/dL) + peso; ziprasidona/haloperidol→QTc (≤460 ms).

2. **Migration 0023** (`exames_agenda`): a faixa de referência é **copiada para a
   linha** no agendamento (factual, auditável). Dedup por índice parcial único
   (paciente, tipo, prescrição, status='agendado').

3. **Job `gerador_exames`** (agents-py): das prescrições ativas, cria a agenda via
   catálogo (idempotente; reagenda o próximo ciclo a partir do último resultado +
   periodicidade, senão um basal com carência). Respeita `automacao_pausada`. Não
   contata o paciente → sem gate de SHADOW_MODE (como o gerador de check-ins).

4. **Job `alerta_exames_vencidos`** (agents-py): exame `agendado` com `devido_em`
   no passado → `notificacoes_medico` (factual: "exame X vencido há N dias", sem
   conduta). Dedup por `alerta_atraso_em` (≤1 a cada 7 dias). Respeita
   `SHADOW_MODE` e `automacao_pausada` (como `alerta_nao_adesao`). Hemograma
   atrasado (clozapina) entra como `urgente`; os demais `atencao`.

5. **Gateway** (`ExamesEndpoints`): `GET /api/v1/pacientes/{id}/exames` (agenda,
   tenant) e `POST /api/v1/exames/{id}/resultado` — compara o valor com a faixa
   **armazenada na linha** (aritmética pura, sem protocolo no C#) → grava
   `fora_faixa`; se fora, `notificacoes_medico` (`exame_fora_faixa`, factual).
   `POST /api/v1/exames/{id}/cancelar`.

6. **UI**: aba **"Exames"** do prontuário (`ExamesPanel`) — pendentes/atrasados +
   registrar resultado + selo na-faixa/fora-da-faixa. Substitui o placeholder.

### clinical-safety

- **#1 IA não pratica medicina:** protocolo, faixas, agenda, alertas e o flag
  fora-de-faixa são determinísticos/factuais. Nenhuma conduta/dose é sugerida.
- **#4 LGPD:** alertas/logs só com metadados (tipo, contagem, datas, valor); sem
  conteúdo conversacional.
- **#5 Auditoria:** `notificacoes_medico` append-only (trigger 0007); a agenda é
  estado operacional.
- **Tenant:** JOIN `pacientes.medico_responsavel_id` em toda leitura/escrita.
- **SHADOW_MODE / automacao_pausada:** alerta de atraso respeita ambos; o gerador
  respeita `automacao_pausada` (circuit-breaker de crise).

## Consequências

- Sem alteração no fluxo de prescrição; o monitoramento "lê" as prescrições ativas.
- O protocolo vive **uma vez** (Python); o gateway só compara contra a faixa
  gravada → zero duplicação de protocolo em C#.
- `medicamento` é TEXT livre → matching por keyword. **Futuro:** `medicamento_id`
  FK no `prescricoes` para casamento robusto; hoje o keyword cobre os casos-alvo.
- Faixas de referência v1 são conservadoras (valor primário por exame) e devem ser
  revisadas com o psiquiatra responsável antes de produção.
- **Fora desta v1 (futuro):** lembrete/check-in de exame ao PACIENTE no portal
  (rail de notifier já existe — `exame_copy.py` + dispatcher); múltiplos valores
  por exame (hemograma completo); painel agregado de adesão a exames (B5).
