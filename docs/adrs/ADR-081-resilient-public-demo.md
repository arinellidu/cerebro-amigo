# ADR-081 — Demo pública read-only e resiliente

- **Status:** aceito (2026-07-26)
- **Decisor:** Patrick Arinelli
- **Escopo:** experiência pública de portfólio para recrutadores
- **Complementa:** ADR-080
- **Não altera:** autenticação, RLS, gateway, serviços de IA ou guardrails clínicos

## Contexto

O CTA médico levava o avaliador ao produto autenticado. Esse caminho exige sessão,
backend Azure e banco disponíveis; com Container Apps em escala zero, o primeiro
acesso pode sofrer cold start ou retornar erro transitório. Um recrutador não deve
precisar descobrir credenciais, criar conta ou repetir uma tentativa para avaliar
o produto.

O ambiente de portfólio já possui três pacientes exclusivamente sintéticos em
`infra/seed/portfolio.sql`. Nenhum dado real é necessário para apresentar a
narrativa de produto.

## Decisão

1. A rota pública `/demo` abre diretamente uma conta fictícia read-only, sem
   cadastro, credenciais, cookie de autenticação ou acesso anônimo ao tenant
   clínico.
2. A demo oferece dois tours de quatro etapas, selecionáveis no shell:
   - médico: `Dashboard → Patient record → AI briefing → Architecture`;
   - paciente: `Today → Check-in → Voice journal → Architecture`.
3. A interface usa um snapshot frontend versionado, alinhado aos três perfis
   sintéticos do seed de portfólio.
4. `/demo` não chama gateway, banco, serviços Python ou LLM e não oferece ações de
   escrita. Portanto, permanece disponível mesmo durante cold start ou falha do
   backend clínico.
5. A interface declara explicitamente que os dados são fictícios, a sessão é
   read-only e o briefing não contém diagnóstico, prescrição, recomendação de
   tratamento ou ajuste de dose.
   Nomes de medicamentos podem aparecer somente como fatos sintéticos de
   prontuário, sem dose, posologia, indicação ou recomendação.
   O tour do paciente pode manter estado efêmero apenas na aba. A gravação de voz
   é uma simulação de interface: não solicita microfone, não captura áudio, não
   gera transcrição e não tenta upload.
6. O produto autenticado em `/dashboard/*` permanece separado e continua a usar o
   runtime completo Vercel + Azure descrito no ADR-080. A demo não é evidência de
   que requests clínicos, RLS ou serviços de IA foram executados naquele acesso.

## Consequências

### Positivas

- O CTA principal abre imediatamente em navegador anônimo, desktop ou celular.
- Não existe credencial pública para vazar, rotacionar ou manter.
- Cold starts do Azure não bloqueiam a avaliação inicial.
- O limite entre demonstração visual e runtime clínico fica explícito.

### Aceitas

- A demo é um snapshot, não uma sessão autenticada do produto.
- Mudanças relevantes no seed ou na interface autenticada exigem revisão do
  snapshot para evitar divergência.
- Validação do runtime completo continua sendo feita por CI, health checks e pelo
  fluxo autenticado, fora do CTA público.
