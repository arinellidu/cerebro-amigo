# Check-up Mental — esqueleto inicial

Produto de lançamento do Cérebro Amigo: triagem pública (PHQ-9, GAD-7, ASRS-18)
com devolutiva por IA e relatório PDF com QR. Vive no monorepo como `apps/checkup`,
container isolado na porta :3001.

## Decisão arquitetural (resumo)

Dentro do monorepo, fora do caminho clínico:
- Reusa: design tokens, pipeline ECR→SSM, RDS (schema próprio). LLM: Anthropic API direta.
- Isola: container próprio, sem imports dos serviços clínicos, dados separados,
  postura LGPD anônima-por-padrão.
- Custo/risco: 6º container na t3.small exige limites de memória (já no snippet);
  se apertar, t3.medium resolve.

## Conteúdo do pacote

```
checkup/
├── CLAUDE.md                     ← documento principal (produto + regras + DoD)
├── KICKOFF-PROMPT.md             ← primeira mensagem para o Claude Code
├── MONOREPO-SNIPPET.md           ← seção para o CLAUDE.md/CONTEXT.md raiz
├── README.md
├── package.json                  ← stub (alinhar versões ao lockfile do monorepo)
├── next.config.ts                ← stub (espelhar apps/web)
├── docs/
│   └── CRISIS-PROTOCOL.md        ← protocolo de crise (implementar primeiro)
├── deploy/
│   └── compose.snippet.yaml      ← 6º serviço + notas de DNS/proxy/CI
└── src/lib/
    ├── scales/
    │   ├── CLAUDE.md             ← regras dos instrumentos
    │   ├── types.ts
    │   ├── phq9.ts               ← itens preenchidos, conferir antes de validated:true
    │   ├── gad7.ts               ← idem
    │   └── asrs18.ts             ← stub deliberado (ver TODO no arquivo)
    └── ai/
        └── CLAUDE.md             ← guardrails da devolutiva + esqueleto de prompt
```

## Como começar (15 minutos)

1. Copiar o conteúdo deste pacote para `apps/checkup` no monorepo.
2. Acrescentar a seção de `MONOREPO-SNIPPET.md` ao CLAUDE.md/CONTEXT.md raiz.
3. Abrir o Claude Code na raiz do monorepo e colar o conteúdo de `KICKOFF-PROMPT.md`.
4. Revisar a Fase 1 antes de liberar a Fase 2.

## Pendências humanas (não delegáveis ao Claude Code)

- Conferir o texto dos itens do PHQ-9 e GAD-7 contra as publicações validadas e
  virar `validated: true`.
- Obter o ASRS-18 oficial em PT-BR e preencher itens + tabela de sombreamento.
- Aprovar pessoalmente o texto final da tela de crise.
- DNS de `checkup.cerebroamigo.com.br` + proxy por Host na EC2.
- Criar o schema `checkup` no RDS e o secret `CHECKUP_DATABASE_URL`.
