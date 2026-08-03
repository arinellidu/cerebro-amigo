# Prompt inicial para o Claude Code

Cole o texto abaixo como primeira mensagem, com o esqueleto já copiado para
`apps/checkup` no monorepo:

---

Estamos iniciando o app `apps/checkup` (Check-up Mental). Antes de escrever qualquer
código, leia nesta ordem: `apps/checkup/CLAUDE.md`, `apps/checkup/docs/CRISIS-PROTOCOL.md`,
`apps/checkup/src/lib/scales/CLAUDE.md`, `apps/checkup/src/lib/ai/CLAUDE.md` e o
`CLAUDE.md`/`CONTEXT.md` raiz do monorepo. As regras desses arquivos prevalecem
sobre qualquer hábito seu.

Fase 1 (faça apenas isto, nesta ordem, e pare ao final para minha revisão):

1. Scaffold do app Next.js 16 em `apps/checkup` seguindo as convenções de `apps/web`
   (pnpm workspace, Tailwind 4, shadcn new-york, tsconfig strict, copie `components.json`
   e as flags do `next.config` de apps/web). Use os stubs existentes como base —
   não os sobrescreva sem incorporar o conteúdo deles.
2. Implemente o motor de escalas: `scorePhq9` e `scoreGad7` completos + testes
   unitários (tudo-zero, tudo-máximo, um caso por faixa, e o caso de crise do
   item 9). `asrs18` permanece stub — NÃO preencha itens nem sombreamento; deixe
   os TODO(validar) visíveis e o gate de `validated: false` funcionando.
3. Implemente o fluxo de crise de ponta a ponta conforme `docs/CRISIS-PROTOCOL.md`,
   com teste E2E provando que o desvio acontece antes de qualquer chamada de IA
   e de qualquer persistência.
4. Rode os testes e me apresente: árvore de arquivos criados, decisões tomadas e
   o que ficou pendente para a Fase 2.

Fase 2 (somente após minha aprovação da Fase 1): fluxo de UI do teste (uma pergunta
por tela), devolutiva via Anthropic API com fallbacks, PDF com QR, landings SEO, eventos
de funil no schema `checkup`.

Não implemente nada listado em "Fora de escopo do MVP". Em qualquer conflito entre
velocidade e as três regras inegociáveis do CLAUDE.md, as regras vencem.
