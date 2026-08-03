# CLAUDE.md — src/lib/scales (motor de instrumentos)

Este diretório é o coração clínico do produto. Regras absolutas:

## Princípios

1. **Itens são dados, não prosa.** Cada instrumento é um objeto `Scale` tipado
   (ver `types.ts`). A UI renderiza a partir dos dados; nunca hardcodar texto de item
   em componente.
2. **Nunca inventar ou parafrasear itens.** Onde o texto validado ainda não foi
   conferido, existe um `// TODO(validar)` apontando a fonte. Se um TODO estiver
   aberto, a escala NÃO entra em produção — falhar o build se `validated: false`.
3. **Scoring determinístico em TS puro**, sem IA, com testes unitários de casos
   canônicos (mínimo: tudo-zero, tudo-máximo, um caso por faixa de corte, caso de crise).
4. Toda mudança em itens/cutoffs exige atualizar os testes no mesmo commit.

## Instrumentos do MVP

### PHQ-9 (depressão) — `phq9.ts`
- 9 itens, janela "últimas 2 semanas", respostas 0–3
  (Nenhuma vez / Vários dias / Mais da metade dos dias / Quase todos os dias).
- Escore 0–27. Faixas: 0–4 mínimo · 5–9 leve · 10–14 moderado ·
  15–19 moderadamente grave · 20–27 grave.
- **Item 9 é o item de crise**: resposta > 0 dispara `crisisFlag` no resultado,
  independentemente do escore total. O fluxo de UI trata isso ANTES de mostrar escore
  (ver docs/CRISIS-PROTOCOL.md).
- Fonte do texto: versão **oficial PT-BR autorrelato** (tradução Pfizer/MapiTrust;
  back-translation Fraguas Jr. et al., 2006), distribuída em phqscreeners.com.
  **NÃO é a versão de Santos et al. (2013)** — essa é aplicada por entrevistador e usa
  opções de resposta modificadas (nenhum dia / menos de uma semana / uma semana ou mais /
  quase todos os dias). O checkup é autoaplicado, então usa a versão autorrelato.
  **Conferir caractere a caractere contra o PDF oficial "Portuguese for Brazil" do
  phqscreeners.com antes de marcar `validated: true`.**
- O PHQ-9 é de uso livre (Pfizer liberou os instrumentos PHQ sem necessidade de permissão).

### GAD-7 (ansiedade) — `gad7.ts`
- 7 itens, mesma janela e mesma escala de resposta 0–3 do PHQ-9.
- Escore 0–21. Faixas: 0–4 mínimo · 5–9 leve · 10–14 moderado · 15–21 grave.
- Fonte: versão **oficial PT-BR autorrelato** (tradução Pfizer/MapiTrust; phqscreeners.com),
  **não** Moreno et al. (paper psicométrico, não reproduz o instrumento). Conferido
  char-a-char contra o PDF oficial "Portuguese for Brazil" (2026-06-11): itens e opções
  idênticos, sem defeito. Mesma regra de conferência do PHQ-9.
- Uso livre, mesma família do PHQ.

### ASRS-18 v1.1 (TDAH adulto) — `asrs18.ts`
- Instrumento da OMS, versão brasileira validada (Mattos et al., 2006, Rev Psiq Clín, Tabela 2).
- 18 itens, respostas 0–4 (Nunca / Raramente / Algumas vezes / Frequentemente /
  Muito frequentemente).
- Estrutura real: **Parte A = 9 itens** (desatenção, 1–9), **Parte B = 9 itens**
  (hiperatividade-impulsividade, 10–18). Itens transcritos verbatim da Tabela 2
  (house style: ortografia moderna + notação (a)); `validated: true` desde 2026-06-11.
- **SCORING QUALITATIVO, SEM VERDICT** (decisão Patrick, 2026-06-11). Mattos 2006
  adverte EXPLICITAMENTE que **não há pontos de corte validados para o Brasil** e recomenda
  cautela em usar a pontuação dos itens ou tratar "algumas vezes" como positivo. Por isso
  **NÃO** aplicamos os cutoffs americanos (Kessler) nem a tabela de células sombreadas:
  `scoreAsrs18` só soma (totalScore informativo), band única `informative`; devolutiva fixa
  (`ASRS_FALLBACK`, sem chamar LLM), nunca afirma positiva/negativa. "Triagem nunca é diagnóstico".
- Reabrir só por novo ADR/decisão do Patrick (ex.: screener WHO 6 itens A4,A5,A6,A9+B1,B5,
  ≥4 positivos) se houver cutoff validado p/ BR.

## Linguagem dos resultados

O motor devolve `band` (faixa) e `bandLabel` neutros. Quem transforma isso em texto
acolhedor é a camada de devolutiva (`src/lib/ai`), nunca este módulo. Este módulo
não conhece UI, IA nem PDF.

## Instrumentos da expansão (ADR-048)

> Texto dos 4 instrumentos **conferido pelo responsável clínico (Patrick,
> 2026-06-12)** → `validated: true`, escalas no ar com landings
> (`/alcool`, `/bipolaridade`, `/tabagismo`, `/borderline`) e sitemap.
> Mudança de item exige nova conferência contra a fonte.

### AUDIT (uso de álcool) — `audit.ts`
- OMS (Babor et al.); versão BR validada (Lima et al. 2005; Méndez 1999) — a do
  material SUPERA/SENAD-MS. 10 itens, últimos 12 meses; itens 1–8 valem 0–4,
  itens 9–10 valem 0/2/4 (opções POR ITEM — `ScaleItem.options`). Escore 0–40.
- Zonas OMS: 0–7 baixo risco · 8–15 uso de risco · 16–19 uso nocivo ·
  20–40 possível dependência. Cutoff clássico de triagem: ≥8.
- Fonte p/ conferência: PDF "bloco_Audit" do SUPERA (supera.org.br) / roteiro OPAS.
- Uso livre (OMS). Devolutiva: caminho LLM normal (entrada estruturada).

### MDQ (bipolaridade) — `mdq.ts`
- Hirschfeld et al. 2000; versão BR validada por Castelo et al. 2010 (Rev Bras Psiquiatr).
- 13 itens sim/não + item 14 (simultaneidade) + item 15 (prejuízo, 4 níveis).
  Triagem positiva = ≥7 "sim" E simultaneidade E prejuízo moderado/sério —
  as TRÊS condições (itens 14/15 não somam pontos).
- **Devolutiva SEMPRE estática (sem LLM)** — bipolaridade é rótulo sensível;
  texto revisado à mão em `fallbacks.ts`. Reabrir só por decisão registrada.
- Fonte p/ conferência: instrumento publicado na validação de Castelo et al. 2010.

### Fagerström / FTND (nicotina) — `fagerstrom.ts`
- Heatherton et al. 1991; versão BR validada (Carmo & Pueschel 2002; materiais INCA/MS).
- 6 itens com PESOS PRÓPRIOS por item (0–10): 0–2 muito baixa · 3–4 baixa ·
  5 média · 6–7 elevada · 8–10 muito elevada dependência.
- Fonte p/ conferência: protocolo de tratamento do tabagismo do INCA/MS.

### MSI-BPD (traços borderline) — `msi_bpd.ts`
- Zanarini et al. 2003. 10 itens sim/não. **SEM VERDICT** (igual ASRS-18): cutoff ≥7
  é da amostra americana; sem validação BR com corte publicado → banda única
  `informative`, devolutiva SEMPRE estática. Reabrir por ADR se surgir cutoff BR.
- **ITEM 2 É ITEM DE CRISE** (autolesão/tentativas): `isCrisisItem: true` —
  "sim" desvia para /crise antes do escore, igual ao item 9 do PHQ-9.
- Fonte p/ conferência: versão pt-BR publicada do MSI-BPD (confirmar existência
  de validação brasileira antes de qualquer verdict).

### ASSIST (uso de substâncias) — `assist.ts` (ADR-049, UX próprio)
- OMS v3.0; versão BR validada (Henrique et al. 2004; material SUPERA/SENAD-MS).
- **Módulo e fluxo PRÓPRIOS** (não é um `Scale`): Q1 multi-seleção (10 classes,
  uso na vida) → Q2–Q7 POR substância com regras de pulo oficiais (Q2=nunca pula
  Q3–Q5; tabaco sem Q5) → Q8 (injetáveis, flag sem pontos). `buildAssistPlan` é
  puro e testado; UI em `app/teste/assist/AssistFlow.tsx`.
- Escore por substância (SSI 0–39); cortes: álcool 0–10/11–26/27+ · demais
  0–3/4–26/27+ (baixo/moderado/alto). Banda geral = pior faixa.
- Resultado/PDF por substância (serialização `encodeAssistResult`, faixas sempre
  recomputadas pelo motor). **Devolutiva SEMPRE estática** (tema sensível).
- "Outras" da Q1 sem campo de texto livre (produto não coleta texto livre — LGPD).
- `ASSIST_VALIDATED: true` — conferido pelo responsável (Patrick, 2026-06-13);
  landing `/drogas` no ar. Re-conferência: Henrique 2004 / SUPERA.
