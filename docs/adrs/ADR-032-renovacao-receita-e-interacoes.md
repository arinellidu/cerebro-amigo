# ADR-032: Renovação de receita controlada (A4) e rede de segurança de interações (A5)

**Status:** Aceito
**Data:** 2026-06-05
**Decisores:** Equipe de engenharia + dono do produto (Dr. Adonai)
**Categoria:** Clínico-operacional / Prescrição
**Relacionados:** ADR-024 (MEMED), ADR-029 (monitoramento de exames — mesmo padrão determinístico), ADR-021 (escopo administrativo da IA), ADR-005 (texto clínico versionado)

## Contexto

Dois ganhos rápidos do roadmap (Tier A), ambos **puramente determinísticos** e de
baixo risco clínico, complementando o MEMED (ADR-024):

- **A4 — Renovação de receita controlada.** Receituário de controle especial no
  Brasil tem validade legal curta (~30 dias). Sem aviso, o tratamento sofre
  ruptura por receita vencida.
- **A5 — Rede de segurança de interações/duplicidade.** Uma **segunda barreira**
  factual ao MEMED no momento de prescrever.

Ambos respeitam a regra inegociável: **a IA não pratica medicina**. Não há LLM em
nenhum dos dois — são SQL + catálogos versionados, exatamente como o S2 (ADR-029).

## Decisão

### A4 — Renovação determinística

- Job `gerador_renovacao_receita` (agents-py, `BaseJob`, sem LLM) varre as
  `prescricoes` ativas com `receita_validade` preenchida e, quando o vencimento
  está dentro da antecedência (`RENOVACAO_ANTECEDENCIA_DIAS`, default 7), cria uma
  linha em `receita_renovacoes` (migration 0028) e **notifica o médico**
  (`notificacoes_medico`, tipo `renovacao_receita`).
- **Doctor-facing apenas.** A reemissão legal é do médico, via MEMED. A IA não
  renova, não ajusta, **não contata o paciente** (decisão de produto desta fase).
- Respeita `pacientes.automacao_pausada` (circuit-breaker de crise) e `SHADOW_MODE`
  para a notificação. Idempotente: 1 renovação por (prescrição, vencimento).
- Gateway `RenovacoesEndpoints`: listar pendentes + marcar `renovada`/`dispensada`
  (tenant por JOIN `pacientes.medico_responsavel_id`). Web: widget no dashboard.

### A5 — Interações/duplicidade por base local versionada

- Base local em **duas tabelas versionadas** (migration 0029):
  `medicamento_dicionario` (texto livre → genérico + classe via substring de
  sinônimos) e `interacao_catalogo` (pares genérico/classe + severidade +
  mecanismo + recomendação factual + fonte). **NÃO depende** da tabela
  `medicamentos` (que não é semeada).
- Gateway `POST /api/v1/prescricoes/checar-interacoes`: resolve os medicamentos
  (propostos + ativos do paciente, escopados por tenant) e cruza os pares contra
  o catálogo + duplicidade (mesmo genérico/classe). Comparação aritmética/de
  conjunto, **sem LLM**.
- Web: painel "Interações (2ª barreira)" no prontuário, junto do botão MEMED —
  avalia o conjunto ativo do paciente e permite testar um medicamento candidato
  antes de prescrever. **Desacoplado dos internos do MEMED** (o evento de
  conclusão do SDK é incerto — ver `botao-receita-memed`).

## clinical-safety

- **Sem IA clínica.** A4 e A5 são determinísticos; A5 nunca gera texto/condut a por
  LLM — é leitura de uma base factual versionada (filosofia do ADR-005/021).
- **A base do A5 é DRAFT e requer revisão clínica (Dr. Adonai) antes de confiar.**
  É **não-exaustiva**: a ausência de alerta **não** significa ausência de
  interação. Não substitui a checagem oficial do MEMED nem a bula. O disclaimer é
  exibido sempre na UI e gravado no seed.
- **Sem contraindicação por condição/diagnóstico** nesta fase: não existe tabela de
  diagnósticos/CID no schema. A5 cobre **interação** e **duplicidade**; a
  contraindicação por condição fica para quando houver fonte de dado estruturada.
- **A decisão é sempre do médico.** Os alertas informam; não bloqueiam, não
  prescrevem, não ajustam dose.
- Multi-tenant: prescrições do paciente só entram via JOIN `pacientes`
  (`medico_responsavel_id`). Recomendações são factuais — nunca dose.

## Consequências

- Migrations novas: **0028** (`receita_renovacoes`), **0029**
  (`medicamento_dicionario` + `interacao_catalogo`, seed idempotente DRAFT).
- agents-py: job `gerador_renovacao_receita` no `JOB_REGISTRY` (slot automático no
  scheduler) + setting `renovacao_antecedencia_dias`.
- Gateway: `RenovacoesEndpoints` + `InteracoesEndpoints`.
- Web: `RenovacoesWidget` (dashboard) + `VerificadorInteracoes` (prontuário) + BFF.
- **Manutenção do catálogo A5** é responsabilidade clínica contínua (revisar,
  ampliar, versionar via `catalogo_versao`). Próximos: contraindicação por
  condição (requer modelo de diagnóstico); integrar a checagem A5 ao retorno do
  MEMED quando o evento de conclusão for confirmado.
