# ADR-030: Rede Social Cérebro Amigo (médicos verificados)

**Status:** Proposed
**Data:** 2026-06-04
**Categoria:** Produto / Arquitetura / Compliance
**Decisão:** Construir uma rede social *interna ao Cérebro Amigo*, exclusiva
para médicos verificados por CRM, como feature do gateway .NET + BFF + web —
sem novo serviço e sem LLM. Esta ADR cobre a **Onda 0 + feed básico**.

## Contexto

O Cérebro Amigo já tem as três peças mais difíceis de qualquer rede médica:
verificação de CRM (`medicos.crm_situacao`, ADR/migration 0017), identidade/login
(`usuarios` + cookie `auth_token`) e cobrança (`assinaturas`). O objetivo do
produto é triplo — retenção, marketing e monetização — além de dar aos médicos
um espaço para trocar experiências. Decidiu-se construir uma rede social
completa por **ondas**, começando pela fundação + feed.

## Decisão

1. **Onde mora (regra de fronteira):** CRUD social é transacional e **não usa
   LLM** → vive no **api-gateway (.NET 10)**, exposto ao front apenas via **BFF**
   (`app/api/rede/*`). O cliente nunca fala com o gateway direto. Tempo real
   (chat) virá em onda posterior via SignalR no próprio gateway.
2. **Segregação de dados:** tabelas `social_*` são separadas do dado clínico. O
   perfil social estende `medicos` numa tabela `social_perfis` (1:1) em vez de
   poluir a tabela clínica.
3. **Escopo de tenant — diferente do clínico (importante):** dado social é
   **público entre médicos verificados** por design (feed/perfis/seguir). Logo
   **não** é escopado por `medico_responsavel_id` como o dado de paciente. O
   isolamento por tenant continua valendo integralmente para tudo que é clínico;
   a rede social é uma superfície intencionalmente cross-tenant entre médicos.
4. **Gate de verificação:** só `medicos.crm_situacao = 'Regular'` pode **escrever**
   (postar, comentar, curtir, seguir). Não-verificados leem o feed. O gate é
   aplicado no gateway antes de qualquer INSERT (`403 crm_nao_verificado`).
5. **LGPD — guard de PII:** posts/comentários passam por um guard mínimo que
   bloqueia padrões óbvios de PII de paciente (CPF, telefone) → `422 pii_bloqueada`.
   O conteúdo **não é logado**. A UI orienta anonimização. Moderação completa
   (denúncias, audit log) fica para a Onda 4.

## Schema (migration `0024_social.sql`)

`social_perfis` (perfil 1:1 com handle único), `social_follows` (grafo),
`social_comunidades` (espaços por tema, com seed inicial), `social_posts`,
`social_comentarios`, `social_reacoes` (curtir/útil, genérico via alvo_tipo),
`social_salvos`. Posts/comentários usam *soft delete* (`status`).

## Endpoints (gateway, `/api/v1/rede`)

`GET/PUT perfil`, `GET perfil/{handle}`, `POST/DELETE perfil/{id}/seguir`,
`GET comunidades`, `GET feed?escopo=descobrir|seguindo`, `POST/DELETE posts`,
`POST/DELETE posts/{id}/curtir`, `GET/POST posts/{id}/comentarios`.

## Alternativas consideradas

- **Produto/serviço separado:** rejeitado no MVP — perderia o reúso de CRM/login/
  billing e a verificação (o maior diferencial). Pode ser reavaliado se a rede
  ganhar escala própria.
- **Incluir pacientes:** rejeitado — saúde mental é LGPD categoria especial e
  interação aberta entre pacientes colide com as regras inegociáveis (protocolo
  de crise, médico no loop). A superfície de paciente continua sendo o portal 1:1.
- **Tabela única "feed" polimórfica:** rejeitada — normalização explícita
  (posts/comentários/reações) é mais simples de moderar e auditar.

## Consequências aceitas

- Mais tabelas e endpoints, porém isolados e sem impacto no núcleo clínico.
- Guard de PII por regex é heurístico (pode ter falsos positivos/negativos); é
  uma rede de segurança, não substitui moderação humana (Onda 4).
- Sem chat/busca/moderação/premium nesta onda (ondas seguintes).

## Gatilhos de revisão

- Se a rede precisar escalar de forma independente do SaaS → reavaliar serviço
  separado.
- Ao entrar a Onda 2 (chat) → ADR específico de SignalR/presence.
- Ao entrar moderação → ADR de audit log append-only de ações de moderação.

## Regras respeitadas

- **Fronteira:** sem LLM no gateway/BFF; CRUD no .NET; agregação no BFF.
- **#3 (LGPD):** segregação de dados, guard de PII, sem log de conteúdo.
- **#5 (auditoria):** não toca tabelas append-only existentes.
