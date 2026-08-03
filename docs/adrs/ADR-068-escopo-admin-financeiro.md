# ADR-068 — Escopo `admin_financeiro`: separar o admin de suporte do owner clínico

- **Status:** Accepted
- **Data:** 2026-06-19
- **Relacionado:** ADR-042 (isolamento de tenant — least-privilege + RLS), DEBT.md T0-6,
  clinical-safety regra #3 (minimização LGPD)

## Contexto

Até aqui, o `TenantSessionMiddleware` setava o GUC `app.tenant_bypass='on'` para
**qualquer** `role in ('owner','admin')`. Esse bypass destrava toda a RLS (ADR-042)
das 25 tabelas clínicas — prontuário, mensagens, protocolo de crise, trilha de acesso.

Para o **owner** (admin principal da plataforma, hoje 1 só) isso é correto e necessário:
ele faz supervisão de crise, trilha LGPD e drill-down por médico.

O risco é **latente**: no dia em que se criar um `admin` de suporte/financeiro (o painel
já permite o owner criar role=admin), essa conta **herdaria acesso ao conteúdo clínico de
todos os tenants** — categoria especial de dado de saúde mental, ferindo a minimização
(clinical-safety regra #3, LGPD art. 11). Risco latente porque hoje só existe o owner;
fechar antes de contratar suporte é o momento certo (custo zero, sem usuário afetado).

## Decisão

Criar o escopo **`admin_financeiro`** = `role=admin` enxerga só dado administrativo/
financeiro, **nunca** clínico. Defesa em profundidade, duas camadas independentes:

### Camada 1 — RLS (data layer)

`TenantSessionMiddleware`: **só `owner`** recebe `app.tenant_bypass='on'`. `role=admin`
não seta GUC nenhum → cai no caminho fail-closed. Como:

- as 25 tabelas **clínicas** têm RLS (ADR-042) cuja policy só libera com
  `app.tenant_bypass='on'` (ou o tenant do médico/paciente) → sem o GUC, o `admin` vê
  **zero** de tenant nenhum;
- as tabelas **administrativas** (`assinaturas`, `pagamentos_manuais`, `cobrancas`,
  `medico_asaas_config`, `newsletter_inscricoes`, `usuarios`, `medicos`) **não têm RLS**
  → o role do gateway (NOBYPASSRLS) as lê normalmente, sem precisar de bypass.

Não foi preciso migration nem GUC novo: a fronteira já existe no schema (clínico = RLS,
administrativo = sem RLS). Escolhemos a opção (b)/(c) do T0-6 na prática — "sem bypass"
em vez de um GUC `app.tenant_bypass_admin` inerte que nenhuma policy honraria hoje.

### Camada 2 — Autorização dos endpoints

Os endpoints que tocam dado clínico ou poder de plataforma passam a exigir a policy
**`owner`** (antes `admin_geral` = owner+admin), para o admin receber **403 limpo** em vez
de dado vazio:

- `AdminEndpoints`: `GET /api/v1/admin/{metricas,crises,acessos,medicos/{id}}`;
- editor de prompts: `/api/v1/agentes` e `/api/v1/prompts` (poder sobre a salvaguarda de
  crise/auditoria — ADR-035);
- catálogo clínico de interações: `/api/v1/admin/interacoes/*`.

Seguem em `admin_geral` (owner+admin): assinaturas, pagamentos, cobranças, cockpit,
reconciliação, CRUD de usuários (troca de role permanece owner-only), onboarding,
aquisição, custos-LLM, saúde dos agentes, solicitações LGPD.

## Consequências

- **LGPD:** o admin_financeiro não enxerga conteúdo clínico de tenant algum — minimização
  satisfeita, mesmo se um endpoint esquecer o filtro (a RLS barra por baixo).
- **owner inalterado:** mantém bypass + acesso total (supervisão, LGPD, drill-down).
- **Risco zero na entrega:** hoje só existe o owner; nenhum usuário admin é afetado.
- **Cofre de documentos** (`MedicoDocumentosEndpoints`) ficou deliberadamente em
  `admin_geral` (revisão de credencial de onboarding pode ser tarefa de suporte). Reavaliar
  se contiver documento de paciente.
- **Testes (gate no CI):** `AdminScopeTests` (api-gateway-tests, Testcontainers) cobre as
  duas camadas — admin 403 nos clínicos / 200 nos financeiros; owner 200 nos clínicos; e o
  data-layer (conexão sem bypass = fail-closed clínico, lê administrativo).

## Alternativas descartadas

- **GUC `app.tenant_bypass_admin`** que as policies clínicas não honrariam: hoje nenhuma
  tabela administrativa tem RLS, então o GUC seria inerte e induziria a uma falsa
  capacidade. Reabrir só se/quando uma tabela administrativa ganhar RLS.
- **Role PG distinta (`cerebro_admin_financeiro`)**: overkill — a fronteira clínico/
  administrativo já é "RLS / sem RLS"; a separação por role do app (owner vs admin) basta.
