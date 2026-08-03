# ADR-066: Portal do Psiquiatra — hub "Minha Conta" (`/dashboard/conta`)

**Status:** Implementado (local; gateway build + web tsc verdes). Fases 1–4 entregues; falta UI admin do cofre (Fase 4b) + testes (Fase 5). **Gates antes de prod:**
- Aplicar migrations `0052_medico_documentos.sql` **e** `0053_conta_extras.sql` no RDS (`cerebro_v3`) **antes** do deploy do código.
- Provisionar bucket S3 privado `cerebro-amigo-medico-docs` (SSE, sa-east-1, **sem** acesso público) + política na role do EC2/gateway (`s3:PutObject`/`GetObject`/`DeleteObject` no prefixo `medico/*`); definir `S3_BUCKET_MEDICO_DOCS` no `.env` do box. Mesmo bucket guarda foto de perfil (`medico/{id}/foto/`).
- `PORTAL_PACIENTE_URL` + Resend já no box (reusa o canal de e-mail do onboarding p/ o reset de senha).
- Revisão clinical-safety da fronteira: o portal é **doctor-facing**, não toca conteúdo clínico de paciente nem trilhas de auditoria (Regra 5).

**Data:** 2026-06-18
**Decisores:** Patrick Arinelli
**Categoria:** Produto / autosserviço do médico / monetização / LGPD

## Contexto

O pedido era "fazer um portal do psiquiatra" para: pagamentos/segunda via, métricas,
documentação/troca de documentação, plano ativo, dados pessoais — com **login só para
médicos cadastrados**.

Auditoria do código mostrou que **~80% já existe**, porém **espalhado** pelo dashboard e
sem um lugar coeso de "minha conta":

| Necessidade | Já existe | Onde |
| --- | --- | --- |
| Login só médico | ✅ | `/login` → BFF `/api/me` → gateway JWT 8h + `AssinaturaGate` |
| Pagamentos + histórico | ✅ | `/dashboard/financeiro` + `GET /api/v1/minha-assinatura` (`invoiceUrl`) + self-checkout + PIX fallback |
| Segunda via | 🟡 | `invoiceUrl` Asaas é 2ª via nativa; `AsaasClient.ObterLinkAtualAsync` busca link fresco — falta endpoint+botão dedicados |
| Métricas | ✅ | `/dashboard/roi` + `RoiEndpoints`/`BlindagemEndpoints` |
| Plano ativo + features | ✅ | `AssinaturaGate` + `/me` + `/minha-assinatura` + `PlanCatalog` + `FeatureGate` |
| Dados pessoais | 🟡 | `/dashboard/configuracoes` + `ConfigEndpoints` (CRM/UF/CPF/timezone/horário/notif) — sem foto, sem editar e-mail |
| **Documentação / troca de docs** | ❌ | **greenfield** — não há tabela nem upload/download de documentos |

## Decisão

### 1. NÃO criar portal/login paralelo

O dashboard **já é** a superfície autenticada do médico (`auth_token` httpOnly, JWT 8h,
gate por assinatura). Criar um segundo login/portal duplicaria auth e fragmentaria sessão.
O "Portal do Psiquiatra" vira um **hub coeso `/dashboard/conta`** que **reusa** o que já
existe e **preenche os gaps** — protegido pela mesma auth (`RequireAuthorization("medico")`).

### 2. Hub `/dashboard/conta` com abas

- **Plano ativo** — reusa `/me` + `/minha-assinatura` (plano, features, situação, dias restantes).
- **Pagamentos & 2ª via** — reusa histórico de `/minha-assinatura`; **novo**: botão "Segunda via" → endpoint que faz refresh do `invoiceUrl` via `AsaasClient.ObterLinkAtualAsync`. **Central de NFS-e/recibos** lendo `cobrancas.nfse_url` + `pagamentos`.
- **Documentos** (greenfield) — cofre bidirecional (ver §3).
- **Dados pessoais** — reusa `ConfigEndpoints`; **novo**: foto de perfil (S3), editar e-mail/telefone.
- **Segurança** — **novo**: trocar senha (logado) + esqueci-senha.
- **Privacidade (LGPD)** — **novo**: exportar meus dados (JSON) + solicitar exclusão de conta.
- **Métricas** — link/embed do `/dashboard/roi` já existente.

### 3. Cofre de documentos bidirecional (migration 0052)

Tabela `medico_documentos` (medico-owned, RLS por `app.current_medico`). Binário **nunca**
passa pelo gateway: **S3 presigned PUT/GET**, bucket privado `S3_BUCKET_MEDICO_DOCS` — mesmo
padrão de `mensagens_audio` (ADR-064). Duas direções:
- `enviado` (médico→plataforma): upload entra `pendente`; admin revisa → `aprovado`/`rejeitado`.
- `disponibilizado` (plataforma→médico): admin sobe via `tenant_bypass` → `disponivel`; médico baixa.

Sem lifecycle de expiração (docs legais/fiscais ≠ áudio 60d). Metadado só — conteúdo cifrado-em-repouso no S3 (SSE).

### 4. Extras de expert incluídos (decisão do Patrick)

Trocar senha (+ esqueci-senha), LGPD export/exclusão, foto de perfil, central de NFS-e.

## Fronteira (onde mora) — ADR-007/042/044

- CRUD/JWT/e-mail/presign S3 → **gateway .NET** (novos `ContaEndpoints`/`MedicoDocumentosEndpoints`).
- Cookies/sessão/agregação de tela → **web/BFF** (`app/api/conta/*`, `app/api/me/*`).
- **Nada de LLM** neste fluxo (portal administrativo; ADR-044 não se aplica).
- RLS por baixo de todo endpoint novo + filtro explícito de `medico_id` (ADR-042).

## Consequências

- **+** Um lugar coeso para o médico se autogerir → menos suporte manual, mais conversão (checkout sempre à mão).
- **+** Cofre de docs destrava onboarding/KYC e entrega de NFS-e/contrato sem e-mail solto.
- **+** Trocar senha fecha um gap real (hoje só na ativação) e esqueci-senha reduz lockout.
- **−** Novo bucket S3 + política IAM (perímetro público-adjacente: bucket privado, presign curto, key namespaced por `medico/{id}/`).
- **−** Exclusão LGPD é **soft** e **respeita trilhas imutáveis** (Regra 5): `protocolos_crise_acionados`/`notificacoes_medico`/`agente_execucoes` **não** são apagados; o admin processa o pedido (anonimiza PII do cadastro, mantém auditoria). Exige **reautenticação** (senha atual) e seta `medicos.exclusao_solicitada_em` (flag p/ o admin) **+** `usuarios.desativado_em` (bloqueia o login imediatamente — é a coluna que o `/login` checa). Registrado em `eventos_conta` (migration 0054, LGPD art.37).
- **−** Admin/owner bypassam RLS (P1 do security roadmap) — o upload `disponibilizado` depende disso; quando o escopo admin for apertado, validar que o caminho continua.

## Fases

1. **ADR + migration 0052** — schema do cofre + foto. ✅ *entregue*
2. **Hub `/dashboard/conta`** — 7 abas reusando plano/pagamentos/métricas/dados pessoais (zero schema novo) + item na sidebar. ✅ *entregue*
3. **Cofre de documentos** — `MedicoDocumentosEndpoints` (gateway, presign PUT/GET, RLS) + BFF `/api/conta/documentos/*` + UI da aba + endpoints admin (`disponibilizado`/revisar). ✅ *entregue (UI admin → 4b)*
   - Descoberta: 2ª via já estava live (`GET /api/v1/minha-assinatura` refaz `invoiceUrl` via `ObterLinkAtualAsync`) → sem endpoint novo.
4. **Extras** — `ContaEndpoints`: trocar/esqueci/redefinir senha (migration 0053, reusa `medico_invite_tokens.proposito` + Resend), LGPD exportar/exclusão (soft, `exclusao_solicitada_em`), foto de perfil (S3 + `fotoUrl` no `/me` + avatar na sidebar). NFS-e central = dobra no cofre (admin disponibiliza `tipo=nfse`). ✅ *entregue*
5. **Pendente** — (4b) UI admin do cofre (subir `disponibilizado` + aprovar/rejeitar); (5) `api-gateway-tests` de isolamento de tenant no cofre (médico A ≠ doc de B) + smoke E2E com bucket provisionado.
