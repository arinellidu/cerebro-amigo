# ADR-050 — Cockpit de Aquisição + Check-up longitudinal pseudonimizado

> **Cérebro Amigo** · site oficial: https://www.cerebroamigo.com.br · Check-up Mental: https://checkup.cerebroamigo.com.br

- **Status:** Parte 1 (Cockpit de Aquisição) **Accepted — implementado** (PR #38 mergeado/deployado 2026-06-13);
  Parte 2 (Check-up longitudinal pseudonimizado) **Proposed — design** (revisão clinical-safety CONDICIONAL
  aplicada 2026-06-13). Fases 1–6 **implementadas (dark/inerte, flag `NEXT_PUBLIC_CHECKUP_TRACKING_ENABLED` off)** — migration `0044`,
  opt-in `/api/tracking`, envio/unsubscribe/erasure, tela de evolução/re-rastreio, job de retenção, smoke E2E +
  **sign-off clinical-safety** (abaixo). Falta só **operacional p/ ligar**: SES prod-access (CK-4), envs no SSM,
  schedulers (cron + retention), flag `=true`.
- **Data:** 2026-06-13
- **Relacionados:** ADR-046 (signup externo + atribuição do Check-up), ADR-045 (Check-up em ASG/ALB próprio),
  ADR-042 (RLS de tenant), ADR-036 (least-privilege roles — schema `checkup` isolado), ADR-044 (LLM Anthropic),
  ADR-018 (cifragem em repouso — modelo do `email_enc`),
  `apps/checkup/CLAUDE.md`, `docs/CRISIS-PROTOCOL.md`, skill `clinical-safety`.

## Contexto

O Check-up Mental é o **motor de aquisição** do Cérebro Amigo: SEO de altíssimo volume do lado paciente
(8 escalas validadas, 9 landings) e, do lado médico, o PDF com QR que recruta psiquiatras. A **métrica norte**
é **médicos cadastrados por 1.000 testes concluídos** (`apps/checkup/CLAUDE.md`).

Dois fatos definem o momento:

1. **O loop de aquisição foi construído (ADR-046) mas ainda não rende.** QR → `/medico` → `/medicos/cadastro`
   → atribuição (`medicos.signup_source/checkup_rid` ⇄ `checkup.funnel_events.rid`). Porém: (a) a métrica norte
   **não tinha onde ser vista** (só por SQL manual); (b) o funil é de **um toque só** e depende de uma cadeia
   física improvável (paciente baixa PDF → leva ao médico → médico escaneia → cadastra).
2. **Há um descasamento de público.** O Check-up atrai **pacientes** em massa, mas a métrica e a monetização são
   de **médicos**. Hoje o ativo mais abundante que o Check-up gera — a intenção de alguém em sofrimento buscando
   ajuda — é **descartado num PDF** ao final. As 5 ideias de produto do roadmap (`docs/Cerebro_Amigo_5_Ideias_Oscar.md`)
   são todas do lado **clínico** (Scribe, Predição de Crise, DTx, FHIR, Outcomes) — nenhuma toca a aquisição.

Este ADR ataca os dois fatos: **Parte 1** torna a métrica norte visível e acionável (pré-condição de qualquer
otimização); **Parte 2** transforma o Check-up de evento único em relacionamento longitudinal pseudonimizado, movendo as
duas alavancas ao mesmo tempo (valor clínico + aquisição) e plantando a semente da ideia de maior impacto do
roadmap (Outcomes/RWE), que hoje depende de massa de dados.

---

## Parte 1 — Cockpit de Aquisição (Accepted, implementado)

### Decisão

Painel admin (`/admin/aquisicao`, policy `admin_geral`) que mostra o funil de ponta a ponta do motor de aquisição
e a métrica norte, **por escala/landing**:

```
testes iniciados → concluídos → PDFs gerados → QR escaneados → cadastros iniciados → médicos cadastrados → médicos ativos
└─────────────── Check-up (anônimo, schema `checkup`) ───────────────┘   └──── clínico (schema `public`) ────┘
```

### Arquitetura — o BFF junta duas fontes ISOLADAS

O gateway clínico (`cerebro_gateway`) **não tem grant no schema `checkup`** (ADR-036/migration 0036 só concede
`public`; ADR-042 isola o tenant). Logo o cockpit **não faz** — e não deve fazer — JOIN `medicos ⇄ funnel_events`
no banco. A junção é **lógica, no BFF** (regra de fronteira do projeto: "agregação para tela → web/BFF"), exatamente
como o ADR-046 já fez a web ler a API pública do Check-up:

- **Gateway** `GET /api/v1/admin/aquisicao` (schema `public`): médicos por `signup_source`, médicos do Check-up por
  status de assinatura, `rid`s distintos atribuídos, série temporal de cadastros, drill-down dos últimos médicos.
- **Check-up** `GET /api/funnel-metrics` (schema `checkup`): contagens **agregadas** de `funnel_events` por
  `event_type` e por escala + série de `test_completed`/mês. **Nunca** `session_id`, `rid` individual, e-mail ou
  conteúdo de triagem. Protegido por `CHECKUP_METRICS_TOKEN` (Bearer); **fail-closed** — sem token configurado,
  responde **503** (não expõe métricas de negócio em superfície pública). `Cache-Control: no-store`.
- **BFF** `GET /api/admin/aquisicao` (web): chama as duas em paralelo (gateway via cookie `auth_token`; Check-up via
  token) e calcula a métrica norte = `médicos do Check-up ÷ testes concluídos × 1.000`. Degrada com elegância: se o
  Check-up estiver indisponível, mostra só o lado clínico com aviso.

### Por que respeita as regras inegociáveis

- **Isolamento clínico ⇄ checkup** preservado: cada serviço lê só o seu schema; nenhuma FK cross-schema; o web
  nunca escreve `checkup`.
- **LGPD**: só agregados (contagens). `rid` (8 chars) não é PII; o nome do médico é dado profissional. Sem dado
  de paciente, sem conteúdo clínico.
- **Atribuição** (`rid`) reaproveitada do ADR-046; nada novo no modelo de tenancy.

### Dependência

Requer as migrations **0041/0042 aplicadas** (Fase 5 do ADR-046). O endpoint do gateway referencia
`medicos.signup_source/checkup_rid` — sem a 0041 a query falha (o mesmo já vale para o INSERT de onboarding).

### Env

`CHECKUP_METRICS_TOKEN` (SSM SecureString — **mesmo valor** no web/BFF e no Check-up) · `CHECKUP_METRICS_URL`
(web; default `https://checkup.cerebroamigo.com.br/api/funnel-metrics`). Deploy: token no SSM do Check-up (ASG) e
na env do web (Vercel + container do EC2).

---

## Parte 2 — Check-up longitudinal pseudonimizado (Proposed, design)

> **Revisão clinical-safety (2026-06-13): veredito CONDICIONAL.** A arquitetura (isolamento, scoring
> determinístico, texto fixo, crise first-class, opt-in, minimização) é sã. Três **blockers** foram corrigidos
> no design abaixo antes de qualquer código:
> 1. **Modelo de e-mail inviável e mal-rotulado** — não dá pra enviar um nudge dias depois a um `bcrypt(email)`
>    (hash é mão-única). Para disparar no `due_at` é preciso guardar o endereço de forma **recuperável**
>    (cifrado em repouso, padrão ADR-018). Isso torna a série **pseudônima, não anônima** — o rótulo "anônimo"
>    do rascunho original era otimista. Decisão (Patrick, 2026-06-13): **encrypt-and-own** — cifrar e assumir a
>    barra LGPD (consentimento + eliminação + retenção).
> 2. **Faltava via de eliminação (direito do titular, LGPD).** Unsubscribe ≠ erasure. Guardar escores de saúde
>    mental ligados a um e-mail (recuperável) sem rota de exclusão é violação. Resolvido: `deleted_at` + CASCADE +
>    TTL de retenção (job de purga).
> 3. **Preempção de crise no re-rastreio precisa ser explícita.** Resolvido no Fluxo: o gate validado roda em
>    TODO re-rastreio e crise preempta a tela de evolução.

### Decisão

Transformar o Check-up de **teste avulso** em **acompanhamento longitudinal pseudonimizado** (measurement-based
care público): ao fim do teste (fora de crise), a pessoa pode optar por **reagendar o re-rastreio** (e-mail opt-in)
e, ao voltar pelo link, ver a **evolução** do seu escore ao longo do tempo.

> **Por que pseudônimo e não anônimo:** o nudge é disparado dias depois, então o e-mail **é armazenado** (cifrado
> em repouso). Diferença deliberada vs `report_emails` (0039), que nunca guarda o e-mail porque envia na hora.
> A série é, portanto, dado de saúde **pseudonimizado** (categoria especial) — não anônimo.

### Por que move as duas alavancas

- **Valor ao Cérebro Amigo:** leva o *measurement-based care* (coração clínico do produto) à superfície de maior
  tráfego; começa a acumular **massa de dados longitudinais pseudonimizados** — o que destrava a ideia #5 do roadmap
  (Outcomes/RWE), hoje bloqueada por "depende de massa", pelo canal mais barato e volumoso, sem tocar o prontuário.
- **Captação via Check-up:** cada re-rastreio = **novo PDF = novo toque de QR** → multiplica as chances de o médico
  ser alcançado (a aquisição compõe ao longo do tempo, em vez de um disparo único). O e-mail reforça o CTA "leve seu
  acompanhamento ao seu psiquiatra". Sobe `report_generated`, topo do funil de médicos do Cockpit (Parte 1).

### Modelo de dados (schema `checkup`, sem FK cross-schema) — **migration `0044_checkup_tracking.sql`**

```sql
-- Série de re-rastreios de UMA pessoa, de UMA escala. Identificada por token opaco
-- (no link do e-mail), nunca por PII. Pseudônima: tem consentimento e via de erasure.
CREATE TABLE checkup.tracking_series (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_token TEXT NOT NULL UNIQUE,      -- >=128-bit CSPRNG, gerado no app; nunca derivado de PII
  scale_id     TEXT NOT NULL,             -- validado no app (escalas evoluem, ADR-048)
  consent_at   TIMESTAMPTZ NOT NULL DEFAULT now(),  -- opt-in explícito (base legal LGPD)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ,              -- alimenta a purga por retenção
  deleted_at   TIMESTAMPTZ              -- erasure (direito do titular); purga assíncrona
);

-- Pontos da série: escore por data. Só total + faixa validada (sem item-a-item, sem texto).
CREATE TABLE checkup.tracking_points (
  id          BIGSERIAL PRIMARY KEY,
  series_id   UUID NOT NULL REFERENCES checkup.tracking_series(id) ON DELETE CASCADE,
  total_score INTEGER NOT NULL CHECK (total_score >= 0),
  band        TEXT NOT NULL,            -- faixa validada do instrumento (sem narrativa)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Agendamento do nudge. email_enc = e-mail CIFRADO em repouso (app, pgcrypto/ENCRYPTION_KEY,
-- padrão ADR-018), decifrado só in-memory no disparo. email_hash = bcrypt, só dedup/unsubscribe.
CREATE TABLE checkup.tracking_reminders (
  id              BIGSERIAL PRIMARY KEY,
  series_id       UUID NOT NULL REFERENCES checkup.tracking_series(id) ON DELETE CASCADE,
  email_enc       BYTEA NOT NULL,        -- cifrado; NUNCA em claro no banco/log
  email_hash      TEXT  NOT NULL,        -- bcrypt; NUNCA chave de busca por PII
  due_at          TIMESTAMPTZ NOT NULL,
  sent_at         TIMESTAMPTZ,
  unsubscribed    BOOLEAN NOT NULL DEFAULT FALSE,
  unsubscribed_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Fluxo

1. Fim do teste, **fora de crise**, escore moderado/grave → oferta opt-in (checkbox **desmarcado**), com texto de
   consentimento explícito: "Guardamos seus escores ao longo do tempo (e seu e-mail, cifrado) só pra te lembrar e
   te mostrar a evolução. Você apaga quando quiser." → cria `tracking_series` (`consent_at`) + `tracking_reminders`
   (`email_enc` cifrado, `email_hash` bcrypt). Endpoint de criação **rate-limited por sessão** (superfície pública).
2. Job de envio (server-side, in-region SES) dispara o nudge no `due_at`: decifra `email_enc` só in-memory;
   **template fixo, sem LLM, sem conteúdo clínico, sem o escore** — "faz 14 dias, que tal refazer seu Check-up?
   [link com `series_token`]". Link de **unsubscribe** e link de **"apagar meus dados"** obrigatórios em todo e-mail.
3. Pessoa volta pelo link → **reaplica o gate de crise validado** (PHQ-9 item 9 / MSI-BPD item 2) → grava
   `tracking_points` → vê a **evolução** (gráfico de escore + faixas validadas, **sem narrativa de tendência**).
   Página de evolução: `noindex` + `Cache-Control: no-store`; acesso só por `series_token`.
4. **Crise preempta tudo:** se o (re)rastreio rotear para crise, mostra `/crise` (estático, `docs/CRISIS-PROTOCOL.md`),
   **nunca** a tela de evolução; e o nudge **nunca** é (re)agendado para a série cujo último ponto roteou a crise.
5. **Erasure/retenção:** "apagar meus dados" e unsubscribe disparam exclusão (`deleted_at` → purga CASCADE de
   `tracking_points`/`tracking_reminders`); job de retenção purga séries inativas por `last_seen_at` (TTL no runbook).

### Conformidade (clinical-safety — blockers resolvidos acima; guardrails travados aqui)

- **Pseudônimo, não anônimo (LGPD categoria especial):** série por token opaco, nunca por PII; e-mail **cifrado em
  repouso** (não em claro, não só hash) + `email_hash` bcrypt só p/ dedup/unsubscribe; opt-in explícito (`consent_at`);
  **unsubscribe + erasure** em todo e-mail; retenção limitada (purga por `last_seen_at`). Sem FK para as respostas.
- **Crise é first-class:** gate validado reaplicado em todo re-rastreio; crise preempta a evolução; nudge nunca a
  quem roteou para crise. Texto de crise estático e pré-aprovado — nunca gerado.
- **Triagem nunca é diagnóstico:** e-mail e tela de evolução **não interpretam** resultado — só dados + faixas
  validadas do instrumento, **sem narrativa de "melhora/piora"**, sem geração livre, sem LLM. Scoring é TypeScript
  determinístico.
- **Médico no loop / sem IA clínica:** aceitável **só porque há zero texto de LLM** nesta superfície. Qualquer
  "personalizar o nudge com IA" reabre as regras 1/3 das inegociáveis — não fazer.
- **Isolamento:** tudo no schema `checkup`; nenhum dado entra no prontuário; o clínico não importa nada do Check-up.

### Fases (sugeridas)

1. **Migration `0044`** (`tracking_series`/`tracking_points`/`tracking_reminders` + extensão `pgcrypto`)
   — aditiva, isolada. ✅ **escrita**.
2. **Opt-in + criação da série no fim do teste** ✅ **implementada (dark)**: rota `POST /api/tracking`
   (cifra `email_enc` via `pgp_sym_encrypt`/`CHECKUP_ENCRYPTION_KEY`; cria série + 1º ponto + reminder;
   `consent_at`; `series_token` 256-bit; rate-limit `checkTrackingLimit`; rejeita `crisis=true`;
   fail-closed sem a chave) + seção opt-in no `/resultado` (só fora de crise). **Não envia e-mail** →
   **não depende de SES**. Atrás da flag `NEXT_PUBLIC_CHECKUP_TRACKING_ENABLED` (default `false`) para
   só coletar e-mail quando a Fase 3 (envio + erasure) estiver no ar.
3. **Envio do nudge + unsubscribe + erasure** ✅ **implementada (inerte até SES)**:
   `POST /api/tracking/cron` (Bearer `CHECKUP_CRON_TOKEN`, scheduler externo) pega reminders vencidos,
   decifra o e-mail só in-memory (`pgp_sym_decrypt`), envia template **fixo** (sem LLM, sem escore) por SES,
   marca `sent_at` por linha (idempotente; falha retenta). `GET /api/tracking/unsubscribe?t=` (one-click,
   não-destrutivo) e `POST /api/tracking/erase` + página `/descadastrar` (confirmação humana; **DELETE**
   real com CASCADE — erasure LGPD). Links keyed por `series_token` (sem coluna nova). **Só envia** com
   flag on + `CHECKUP_CRON_TOKEN` + `CHECKUP_ENCRYPTION_KEY` + **SES production-access (CK-4)** — até lá
   o envio falha e não marca `sent_at` (retenta), sem efeito colateral.
4. **Tela de evolução + re-rastreio** ✅ **implementada**: `/evolucao?t=` (server `noindex` + client) lê
   `GET /api/tracking/series?t=` (escore+faixa por data, `no-store`, marca `last_seen_at`) e plota um
   gráfico SVG **só de dados — sem narrativa de tendência, sem diagnóstico, zero LLM**. Botão "refazer"
   → `/teste/<scale>?series=<token>`; o `QuizFlow` repassa o token ao `/resultado` (só no caminho normal,
   **nunca** no de crise), que anexa o ponto via `POST /api/tracking/point` (rejeita `crisis=true`,
   rate-limit, 404 se série apagada, atualiza `last_seen_at`). Token-gated (não depende da flag nem de SES).
5. **Job de retenção + runbook** ✅ **implementada**: `POST /api/tracking/retention` (Bearer
   `CHECKUP_CRON_TOKEN`, scheduler externo; **não** depende da flag) apaga séries inativas há mais de
   `CHECKUP_TRACKING_RETENTION_DAYS` (default 365) — DELETE real com CASCADE. Runbook
   `docs/runbooks/checkup-tracking-retention.md` (TTL, ligar a feature, schedulers, erasure manual por
   `series_token`, cuidado na rotação da chave).
6. **Smoke E2E + revisão `clinical-safety` final** ✅: `apps/checkup/scripts/smoke.sh` cobre o contrato
   dark (opt-in/cron → 404, retention sem token → 503, `/evolucao` + `/descadastrar` → 200). Sign-off abaixo.

### Sign-off clinical-safety final (2026-06-13)

Skill `clinical-safety` + review adversarial multi-agente (4 dimensões × 3 céticos) sobre Fases 2–6.
Veredito: **APROVADO para ligar quando as pré-condições operacionais estiverem prontas** (SES CK-4,
envs no SSM, flag on, schedulers). Conformidade com as 5 regras inegociáveis:

1. **IA não pratica medicina:** zero LLM nessa superfície; scoring é TS determinístico; e-mail e tela de
   evolução são **dados + faixas validadas, sem narrativa de tendência, sem diagnóstico/interpretação**.
2. **Crise first-class:** série nunca é criada/estendida nem recebe nudge em crise — `QuizFlow` roteia
   crise para `/crise` (sem `series`), `/resultado` só anexa fora de crise, e `/api/tracking` + `/point`
   rejeitam `crisis=true`. Tela de crise estática inalterada.
3. **Médico no loop:** superfície pública anônima, sem resposta de IA ao paciente — N/A; o espírito
   (nenhum texto clínico gerado) é mantido (template fixo). Qualquer "personalizar com IA" reabre a regra.
4. **LGPD categoria especial:** pseudonimizado (token opaco 256-bit); e-mail **cifrado em repouso**
   (pgp_sym), nunca em claro nem em log; **consentimento explícito** validado no servidor (`z.literal(true)`)
   + checkbox desmarcado; **erasure real** (DELETE CASCADE, self-service + manual por token); **retenção**
   limitada (purga TTL); minimização (sem item-a-item, sem texto livre); isolamento no schema `checkup`.
5. **Auditoria imutável:** nenhuma tabela de auditoria tocada.

**Resíduos (operacionais, não de código):** SES production-access (CK-4); setar `CHECKUP_ENCRYPTION_KEY` /
`CHECKUP_CRON_TOKEN` no SSM; schedulers (cron + retention); flag `=true`. Race unsubscribe×cron conhecida
(≤1 e-mail após cancelar) — aceitável, documentada.

**Resíduo de design aceito:** a elegibilidade de crise no opt-in/append é **determinada no cliente** (o gate
validado roda no `QuizFlow`; crise vai p/ `/crise` sem `series`). O servidor não consegue recomputar crise
sem os itens — e **não recebê-los é a própria minimização** (ADR/skill: sem item-a-item). Defesa server-side:
`/api/tracking` e `/point` rejeitam `crisis=true`. Um cliente adulterado só prejudicaria a si mesmo (recebe
lembrete administrativo, nunca texto clínico). Reavaliar só se algum dia o fluxo enviar itens ao servidor.

---

## Notas

- Parte 1 (Cockpit) **não** depende do SES nem da Parte 2 — entrega valor assim que 0041/0042 forem aplicadas.
- Marca **Cérebro Amigo** e site oficial **https://www.cerebroamigo.com.br** aparecem no rodapé do Cockpit, no PDF
  do Check-up (QR) e em todo e-mail/relatório gerado.
