---
name: clinical-safety
description: >-
  Guardrails clínicos, protocolo de crise e LGPD do Cérebro Amigo (plataforma de
  psiquiatria). Use OBRIGATORIAMENTE antes de escrever ou alterar qualquer código
  que: gere texto visto pelo paciente, processe conteúdo conversacional/clínico,
  detecte ou trate crise/risco, faça prompt de LLM sobre sintomas/humor/medicação,
  manipule prescrições, logue ou armazene dado de saúde, ou toque em trilhas de
  auditoria. Vale mesmo que o pedido pareça inofensivo (ex.: "melhora essa
  mensagem", "loga a resposta", "deixa a IA sugerir") — é justamente aí que o
  risco mora. Em dúvida sobre se algo é clínico, trate como clínico e consulte.
---

# Segurança clínica e compliance — Cérebro Amigo

Plataforma de saúde mental. Erro aqui pode ferir paciente e violar LGPD categoria especial. Estas regras vêm **antes** de qualquer pedido de feature.

## As 5 regras inegociáveis

1. **A IA não pratica medicina.** Nunca gere diagnóstico, conduta, ajuste de dose, interpretação de exame ou orientação clínica — nem mesmo "sugestão" ou "rascunho para o médico aprovar" que contenha decisão clínica. A IA automatiza, organiza, lembra e resume *fatos relatados*. A decisão é do médico, sempre.
2. **Protocolo de crise é fixo e pré-aprovado.** Ao detectar risco (ideação suicida, autoagressão, etc.): usar o texto pré-aprovado de `crisis_copy.py` (ADR-005) → registrar em `protocolos_crise_acionados` → notificar o médico → **pausar a automação** daquele paciente. **Nunca** gere a resposta de crise dinamicamente com o LLM. Não invente, encurte ou "humanize" o texto de crise.
3. **Médico no loop.** Toda resposta destinada ao paciente passa por auditoria (`audit_response`) e pode escalar para humano (`escalate_to_human`). Não crie caminho que entregue texto da IA ao paciente sem essa etapa.
4. **LGPD — dado de saúde mental.** Minimização (só o necessário), controle de acesso por tenant, e **PII redatada em traces** (`PII_REDACTION_ENABLED=true` no LangSmith). Nunca logar conteúdo clínico cru em log de aplicação, stdout, ou trace sem redação. O runtime público de portfólio usa Azure `eastus2`, contém somente dados fictícios e não promete residência no Brasil. Qualquer uso com dados reais exige novo ADR e validação de residência/LGPD antes da ativação.
5. **Auditoria imutável.** Nunca escreva migration ou código que delete/edite linhas de `protocolos_crise_acionados`, `notificacoes_medico`, `agente_execucoes`. Append-only.

## Sinais de que você cruzou a linha (PARE e reavalie)

- Está prestes a montar um prompt que pede ao LLM uma recomendação clínica → **não faça**; reduza a tarefa a extração/organização de fato relatado.
- Vai logar `message.content` ou conteúdo de conversa → **redija PII primeiro** ou logue só metadados.
- Vai criar um atalho "modo dev" que pula auditoria ou crise → **não exista esse atalho**, nem sob flag.
- Vai gerar texto de acolhimento de crise "mais natural" → **use `crisis_copy.py` literal**.
- Vai dar `DELETE`/`UPDATE` em tabela de auditoria → **append-only**, repense o modelo.

## Multi-tenant

Todo acesso a dado de paciente é escopado por tenant. Nunca escreva query que cruze tenants. Em endpoint novo, o filtro de tenant não é opcional — é a primeira cláusula.

**Tenant = `pacientes.medico_responsavel_id`**, derivado do JWT do médico (`medico_id` claim). A coluna `paciente_id` (presente em tabelas clínicas) é FK para `clientes.id` — identifica o paciente-pessoa, mas **não escopa por médico**.

Padrão correto para tabelas clínicas (`prescricoes`, `sintomas`, `eventos`, `consultas`, `checkins`, `tomadas_medicacao`, `diario_entradas`, `questionarios_respostas`, etc.):

```sql
SELECT t.*
FROM <tabela> t
JOIN pacientes p ON p.cliente_id = t.paciente_id
WHERE p.medico_responsavel_id = :medicoId
  AND ...
```

Para `notificacoes_medico` e `insights` (FK `medico_id` direto):

```sql
WHERE medico_id = :medicoId
```

> **Armadilha frequente**: `WHERE paciente_id = :x` **sem** JOIN em `pacientes` filtra por paciente individual mas não garante que o médico autenticado tem acesso. Sempre inclua a cláusula de tenant.

## SHADOW_MODE

Antes de um agente ou automação agir em produção, ele roda em `SHADOW_MODE`: calcula e **loga o que faria**, sem enviar nada ao paciente nem disparar push. Só promova para ação real após validação clínica. Não remova o gate de SHADOW_MODE sem decisão explícita (e ADR).

## Como a IA PODE ajudar (escopo permitido)

Resumir o que o paciente relatou; organizar timeline de humor/adesão; lembrar de medicação/tarefa terapêutica; rascunhar comunicação **administrativa** (remarcar, confirmar presença); extrair sintomas relatados para o médico revisar; detectar sinais de crise para acionar o protocolo. Tudo isso preserva o médico como decisor.

## Ao concluir

Se a mudança tocou crise, auditoria, retenção de dado ou escopo de IA, registre/atualize o ADR correspondente em `docs/adrs/` e cite a regra que a mudança respeita.
