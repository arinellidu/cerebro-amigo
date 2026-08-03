# ADR-024: Integração MEMED (prescrição digital)

**Status:** Accepted
**Data:** 2026-06-04
**Decisores:** Equipe de engenharia + psiquiatra responsável clínico
**Categoria:** Produto / Segurança clínica

## Contexto

O médico precisa emitir **receita digital legal** (assinada, entregue ao paciente)
pela plataforma. O MEMED é a plataforma dominante de prescrição digital no Brasil
(assinatura ICP-Brasil, entrega ao paciente, conformidade ANVISA/CFM). Construir
e-prescrição própria (PKI, assinatura, registro) está fora de escopo e é o que o
MEMED resolve.

## Decisão

Integrar o MEMED via SDK (Sinapse Prescrição):

1. **Backend (gateway .NET) só provisiona o médico** no MEMED e devolve o token do
   prescritor (`MemedClient` no padrão `ResendClient`; `POST /sinapse-prescricao/
   usuarios`, auth `api-key`+`secret-key`, `board:{board_code,board_number,
   board_state}`). Endpoints: `GET /memed/prescritor-token`, `GET /memed/paciente/
   {id}/dados`, `POST /memed/receitas` (espelho). Tenant em tudo.
2. **Frontend embute o SDK** no prontuário (aba Prescrições). O médico prescreve e
   **assina dentro do widget do MEMED**; o MEMED entrega ao paciente.
3. **Espelho:** ao concluir, os medicamentos são clonados em `prescricoes`
   (`receita_tipo='memed'`) só para o motor de lembretes/adesão. A **receita legal
   vive no MEMED**; `receitas_memed` guarda o vínculo (timeline/auditoria).

### clinical-safety

- **Regra #1 intacta:** a IA NUNCA prescreve nem toca no conteúdo. O gateway só
  provisiona o médico; a decisão e a assinatura são do médico, no MEMED.
- **LGPD:** nome/CPF/telefone do paciente vão ao MEMED — inerente e necessário à
  e-prescrição, com consentimento (`consentimento_lgpd_em`); MEMED é BR.

## Dados necessários (migration 0016)

`medicos` ganha `crm_uf`, `cpf`, `memed_usuario_id`. O MEMED exige CRM separado em
número + UF (e CPF do médico). Coletados no onboarding (`/admin/financeiro`) e
editáveis em `/dashboard/configuracoes`. Sem eles, `prescritor-token` retorna
`400 cadastro_incompleto`.

## Sandbox → produção

Por env: `MEMED_API_BASE` (default sandbox `integrations.api.memed.com.br/v1`),
`MEMED_API_KEY`/`MEMED_SECRET_KEY` (homologação fixa no sandbox; próprias após
validação técnica do MEMED em prod), `MEMED_SCRIPT_URL`. Sem keys, o gateway sobe
normal e só os endpoints `/memed` respondem erro claro.

## Alternativas

- **E-prescrição própria (ICP-Brasil):** rejeitada — complexidade de PKI/assinatura/
  conformidade que o MEMED já entrega.
- **Outras plataformas (Nexodata etc.):** MEMED é a mais integrada no mercado BR; SDK
  maduro. Reavaliar se houver exigência de cliente.

## Incógnitas a confirmar no sandbox

- CPF do médico obrigatório no registro? (coletado de qualquer forma).
- Nome exato do evento de conclusão da prescrição e shape do payload de
  medicamentos — o espelho é **best-effort** (`prescricaoImpressa`); a receita legal
  não depende dele.

## Referências

- `infra/migrations/0016_memed.sql`
- `apps/api-gateway/Services/MemedClient.cs`, `Endpoints/MemedEndpoints.cs`
- `apps/web/components/memed/botao-receita-memed.tsx`
- Doc MEMED: doc.memed.com.br (Sinapse Prescrição).
