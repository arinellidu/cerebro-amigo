# ADR-037 — Sala de supervisão de crise (admin, read-only)

**Status:** aceito · 2026-06-06
**Contexto relacionado:** [[ADR-005]] (texto de crise), [[ADR-006]] (fail-safe classificador), [[ADR-007]] (audit trail imutável → 0007), [[ADR-022]] (notificação externa de crise), clinical-safety regras 2, 4 e 5

## Contexto

O protocolo de crise é a salvaguarda nº1 do produto: ao detectar risco, o
orchestrator usa o texto fixo de `crisis_copy.py`, registra em
`protocolos_crise_acionados`, notifica o médico e pausa a automação. Mas o admin
só via `crisesTotal` por médico (no perfil) — não existia nenhuma visão
**platform-wide** da regra "médico no loop": quantas crises sem notificação,
quanto tempo até o médico ser avisado, quantos pacientes com automação pausada.
A auditoria do `/admin` (2026-06-06) apontou isso como o gap de governança mais
crítico. É a evidência que um DPO/auditor (ANPD/CFM) pede primeiro.

## Decisão

Nova tela **`/admin/crises`** + endpoint **`GET /api/v1/admin/crises`** (gateway,
`admin_geral`), **somente leitura** sobre `protocolos_crise_acionados` (trilha
imutável — clinical-safety regra 5: nunca edita/apaga):

- **KPIs (30d):** total de crises, **sem médico notificado**, SLA médio até
  notificação (`medico_notificado_em − criado_em`), pacientes com automação pausada.
- **Eventos (últimos 100/30d):** quando, médico responsável, origem
  (`conversa`/`diario_*`), categoria de gatilho, confiança do classificador,
  notificado (sim/não) + SLA, automação pausada.

**Minimização (clinical-safety regra 4):** a tela expõe só **metadados**. NÃO
mostra conteúdo clínico cru — `gatilho`/`palavras_detectadas` são categorias do
classificador, nunca trechos do paciente; não há join com `mensagens`; **não há
PII do paciente** (mostra o médico, não identifica o paciente).

## Consequências

- Sem migration, sem write — risco zero de violar a imutabilidade da trilha.
- Transforma "médico no loop" de promessa em **métrica vigiável** (SLA de
  notificação, crises sem aviso).
- O acesso é do `admin_geral` (governança da plataforma), não cruza tenant de
  médico — é leitura agregada de governança, não acesso clínico a paciente.
- Próximos passos do eixo clínico (fora deste ADR): console de divergência
  SHADOW para promover prompt de crise; trilha de acesso a dados sensíveis
  (art. 37); console de direitos do titular.
