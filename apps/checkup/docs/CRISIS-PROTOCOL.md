# Protocolo de crise — Check-up Mental

Este documento define o comportamento do produto quando a triagem indica risco.
É a parte mais importante do produto. Implementar e testar ANTES de qualquer
feature de conversão.

## Gatilho

- PHQ-9, item 9, resposta > 0 (`crisisFlag: true` no motor de escalas).

## Comportamento

1. **Desvio imediato.** Ao registrar a resposta do item 9 com valor > 0, o fluxo
   normal é interrompido na hora — a pessoa NÃO vê escore, banda, devolutiva de IA
   nem CTA comercial naquele momento.
2. **Tela de acolhimento.** Conteúdo estático (sem IA), revisado por humano:
   - Mensagem curta e calorosa reconhecendo que responder isso exige coragem e que
     a pessoa não precisa passar por isso sozinha.
   - Canais em destaque, clicáveis no mobile:
     - **CVV — 188** (24h, gratuito) e chat em cvv.org.br
     - **SAMU — 192** para emergência
     - Orientação a procurar um CAPS ou o pronto-socorro mais próximo se estiver
       em perigo imediato, e a contar para alguém de confiança agora.
   - Botão único e claro: "Continuar quando você quiser" → permite, se a pessoa
     escolher, concluir o teste e ver um resultado em versão sóbria, que mantém os
     canais de ajuda no topo.
3. **Sem dark patterns.** Nesta tela e em qualquer tela pós-crise: sem coleta de
   e-mail, sem QR de aquisição, sem animações, paleta sóbria (sem coral).
4. **Telemetria mínima.** Registrar apenas o evento `crisis_routed` (timestamp +
   sessão efêmera). Nenhum payload de respostas, mesmo com consentimento dado antes.
5. **PDF.** Se a pessoa concluir e pedir o relatório, o PDF sai em versão que inclui
   os canais de ajuda no topo e omite o bloco de marketing.

## Texto

- Tom: presente, direto, sem alarme e sem frieza. Nunca prometer sigilo de
  terceiros nem desfechos ("vai ficar tudo bem").
- Proibido em qualquer texto do produto: menção a métodos de autoagressão.

## Testes obrigatórios

- Unitário: item 9 > 0 ⇒ `crisisFlag` true para qualquer combinação dos demais itens.
- E2E: fluxo desvia antes de qualquer chamada de IA e antes de persistir respostas.
- Revisão humana do texto final da tela antes do deploy (Patrick aprova explicitamente).
