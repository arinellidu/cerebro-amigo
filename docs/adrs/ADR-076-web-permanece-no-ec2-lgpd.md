# ADR-076: `apps/web` permanece no EC2 — migração para a Vercel (ADR-074) abandonada por LGPD

**Status:** Accepted
**Data:** 2026-06-29
**Decisores:** Patrick Arinelli, Adonai Arinelli
**Categoria:** Infra / Arquitetura / Compliance
**Supersede:** **ADR-074** (web → Vercel) — o cutover **nunca foi executado**.
**Relaciona:** ADR-052 (checkup não migra — mesma fronteira), ADR-073 (zona DNS na Vercel), ADR-008/ADR-044 (residência de dado no Brasil), ADR-018/054 (cifragem em repouso).

## Contexto

O ADR-074 propôs migrar o `apps/web` (landing + dashboard médico + portal do paciente `/p/*` + **BFF**) da AWS (`sa-east-1`) para a Vercel (Pro, `gru1`), aceitando conscientemente o trade-off de a Vercel (operadora nos EUA) passar a **tratar dado de categoria especial (saúde mental) em trânsito**, com DPA + base de transferência do art. 33 + RIPD como bloqueadores.

No momento do cutover (flip de DNS), a análise de conformidade prevaleceu: **mover o BFF para a Vercel tira o tratamento do Brasil** (o controle da operadora é US, ainda que o processamento rode em `gru1`) e configura **transferência internacional de dado de saúde**. Diferente de um rollback técnico, a **exposição que ocorre não é reversível** por reverter o DNS. O responsável concluiu que o risco LGPD sobre dado de pacientes reais **não compensa** o ganho (separação front/back + uso do Pro), ainda que com DPA/SCC.

## Decisão

**`apps/web` permanece no EC2 `sa-east-1` (ASG `cerebro-web-asg` + ALB + CloudFront — infra atual). A migração para a Vercel está abandonada.** Dado clínico — **em repouso e em trânsito** — permanece no Brasil. Não retomar a migração sem novo ADR e parecer de conformidade.

## Consequências

- **Residência de dado mantida no BR** (em repouso: RDS `sa-east-1` cifrado; em trânsito: BFF no EC2 `sa-east-1`). Sem suboperador estrangeiro, sem transferência internacional, sem necessidade de DPA/SCC/RIPD da Vercel.
- **Sem cold start** (container Node sempre quente no ASG) — o motivo técnico de ir pra Vercel (Fluid Compute) deixa de pesar.
- **Custo:** mantém o ASG do web (~$35/mês). **Vercel Pro fica ocioso** → gatilho para reavaliar a assinatura (ADR-074 era a justificativa de uso).
- **Trabalho de preparo aproveitado (não desperdiçado):** as defesas criadas para o cenário "gateway exposto à internet" continuam válidas como **hardening** no EC2:
  - `X-Edge-Auth` (autenticação de origem, fail-closed no gateway — o EC2 web manda o header). **Mantido.** *(Opcional futuro: como o egress do EC2 é estável, dá pra trocar o segredo compartilhado por IP-allowlist no perímetro — não urgente.)*
  - Uploads do paciente robustos a 500 (`gatewayProxy`) + headers COOP/CORP (PR #163).
  - Design de ALB + WAF na frente do gateway (PR #164) — útil de qualquer forma (o gateway é público pelo EIP/ALB independente da decisão sobre o web).
- **Revertido do preparo Vercel:** env `EDGE_AUTH_SECRET` + `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` removidos do projeto Vercel; rascunhos LGPD da transferência (RoPA/RIPD/privacidade, PR #165) fechados como moot.
- **DNS intacto:** `www` segue em CloudFront → ALB → EC2; flip nunca executado.

## Alternativas rejeitadas

- **Migrar com DPA + cláusulas-padrão ANPD** (caminho do ADR-074): rejeitada — mesmo com salvaguardas contratuais, mantém transferência internacional de dado de saúde e a exposição em trânsito fora do BR; risco residual inaceitável para o responsável.
- **Vercel Secure Compute / egress no BR garantido:** não muda o fato de a operadora ser estrangeira (controle US) — não resolve a residência.

## Gatilhos de revisão

- Mudança regulatória que torne a transferência claramente segura/adequada (ex.: adequação ANPD), **e** decisão de negócio de reusar o Pro.
- Custo do Vercel Pro ocioso → cancelar/rebaixar.
