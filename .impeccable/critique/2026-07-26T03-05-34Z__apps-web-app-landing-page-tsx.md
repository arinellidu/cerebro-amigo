---
target: apps/web/app/(landing)/page.tsx
total_score: 17
max_score: 28
na_heuristics: 7,9,10
p0_count: 0
p1_count: 3
timestamp: 2026-07-26T03-05-34Z
slug: apps-web-app-landing-page-tsx
---
# Critique de `/`

## Design Health Score

| # | Heurística de Nielsen | Nota | Diagnóstico |
|---|---|---:|---|
| 1 | Visibilidade do status | 3 | Hover e foco são claros; há pouco estado para comunicar. |
| 2 | Correspondência com o mundo real | 1 | O seletor paciente/médico em português não corresponde ao público principal de recrutadores internacionais. |
| 3 | Controle e liberdade | 3 | Rotas são links convencionais, sem aprisionamento. |
| 4 | Consistência e padrões | 3 | Visual coeso, mas os cards misturam acesso do paciente e descoberta do produto pelo médico. |
| 5 | Prevenção de erros | 2 | Escolhas de papel duplicadas entre cards e links de login tornam o destino ambíguo. |
| 6 | Reconhecimento em vez de memória | 2 | Ações aparecem, mas produto, capacidades e destinos não ficam reconhecíveis. |
| 7 | Flexibilidade e eficiência | n/a | Não é significativa nesta superfície de persuasão. |
| 8 | Estética e minimalismo | 3 | Hierarquia limpa, porém um viewport inteiro comunica pouca evidência do produto. |
| 9 | Reconhecimento e recuperação de erros | n/a | Não há formulário ou transação recuperável. |
| 10 | Ajuda e documentação | n/a | Não é necessária neste seletor leve. |
| **Total** |  | **17/28** | **Aceitável: shell polido, tarefa persuasiva errada.** |

## Design Specificity Verdict

**Parcialmente autoral, estruturalmente intercambiável.** A paleta Neural Noir, marca cerebral, contraste coral/roxo, headline editorial e microcopy mono criam assinatura. A composição subjacente — logo, boas-vindas, pergunta e dois cards — ainda é um seletor SaaS genérico. O conceito mais específico, cuidado psiquiátrico entre consultas, aparece só em frases curtas; faltam fluxo, interface real, arquitetura, limites clínicos, postura de segurança e contribuição do autor.

A varredura determinística foi executada exatamente uma vez sobre `apps/web/app/(landing)/page.tsx`: **0 achados**, `[]`, exit code 0; nenhuma regra, severidade ou localização foi reportada. Isso confirma a ausência de anti-padrões mecânicos detectáveis, mas não cobre hierarquia, narrativa, CSP, responsividade ou tamanho de toque.

A sobreposição visual externa foi tentada. O preflight mutável funcionou e foi revertido, mas a CSP de produção bloqueou `http://localhost:8400/detect.js`; nenhum overlay confiável foi criado. A avaliação visual usou screenshots, árvore de acessibilidade, dimensões DOM e retângulos dos links como fallback.

## Impressão geral

Como gateway de acesso, a página é elegante e calma. Como homepage para persuadir recrutadores internacionais, falha na arquitetura da informação: a primeira e única pergunta exige que o visitante seja paciente ou médico. No desktop, a composição é premium e cabe inteira no viewport. No mobile, os cards empilham corretamente, mas as ações secundárias, crise e links legais ficam abaixo da primeira dobra.

## Pontos fortes

1. **Mundo visual disciplinado.** Fundo espacial, grid discreto, glass surfaces, acentos coral/roxo e pareamento tipográfico editorial/técnico são coerentes.
2. **Hierarquia desktop excelente para uma escolha binária.** Logo, eyebrow, pergunta e cards formam uma sequência imediatamente escaneável.
3. **Fundamentos sólidos de interação e acessibilidade.** Cards são alvos grandes; há headings semânticos, alt significativo, foco visível e respeito a `prefers-reduced-motion`.

## Questões prioritárias

### P1 — A homepage exclui seu público atual

O H1 e todas as rotas primárias atendem apenas pacientes e médicos, em pt-BR. Recrutadores não conseguem entender o produto, a contribuição do autor ou a próxima ação. A correção é criar uma proposta de valor em inglês e um caminho claro para explorar o produto/case study, deixando acessos clínicos como utilidade secundária. Comando sugerido: `$impeccable clarify / for international recruiters`.

### P1 — Descoberta do produto e autenticação estão misturadas

“Sou paciente” promete portal; “Sou médico” promete conhecer a plataforma; abaixo, os papéis reaparecem como login. O visitante precisa adivinhar se cada destino é marketing, onboarding ou autenticação. Separar “Explore” de “Sign in” e dar semântica paralela aos destinos. Comando sugerido: `$impeccable distill /`.

### P1 — Não há evidência para sustentar as afirmações

IA, humor, agenda, medicação e cuidado entre consultas aparecem como claims sem telas reais, fluxo, arquitetura, limites clínicos, segurança ou escopo construído. Em software psiquiátrico, isso pode parecer conceito visual. Acrescentar narrativa compacta com interface real, fluxo em três etapas, provas técnicas/de segurança e papel do autor, sem inventar métricas. Comando sugerido: `$impeccable shape / as a recruiter-facing product case study`.

### P2 — O tom privilegia mística de IA sobre confiança clínica

Aurora WebGL, grid neural, vidro preto e microcopy mono comunicam “AI demo” mais que infraestrutura clínica confiável. Manter o noir, equilibrando-o com evidência operacional, imagens reais do produto e momentos editoriais mais humanos. Comando sugerido: `$impeccable colorize / with warmer clinical trust cues`.

### P2 — A sequência mobile atrasa contexto e ações importantes

Em 390×844, o documento tem cerca de 1047px. As ações de login começam em y≈864, a informação de crise em y≈938 e os links legais em y≈975. “Entrar como paciente” quebra em duas linhas; links secundários e legais usam basicamente a caixa do texto, abaixo do alvo de toque desejável. Comprimir o acesso utilitário e posicionar a CTA principal no primeiro viewport, mantendo verbatim o texto clínico aprovado. Comando sugerido: `$impeccable adapt / for mobile`.

## Persona Red Flags

- **Jordan, first-timer:** não consegue responder ao seletor, inferir destinos nem encontrar tour, inglês ou “About this project”.
- **Riley, stress tester:** encontra claims amplos sem prova, papéis duplicados e nenhuma demonstração visível de multi-tenancy, auditoria, segurança ou human-in-the-loop.
- **Casey, distracted mobile user:** precisa atravessar dois cards altos; ações úteis, crise e links legais ficam abaixo da dobra e com alvos pequenos.

## Observações menores

- Metadata repete o enquadramento paciente/médico e também subrepresenta o produto em busca e compartilhamento.
- Hover lift/glow é polido no desktop, mas agrega pouco no touch.
- “Bem-vindo” ocupa espaço valioso sem estabelecer categoria ou credibilidade.
- Crise e legal usam tipografia pequena e baixa proeminência perceptual sobre fundo animado.
- Não há overflow horizontal; os cards primários permanecem grandes e legíveis no mobile.
