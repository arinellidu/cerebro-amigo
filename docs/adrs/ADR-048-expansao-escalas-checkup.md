# ADR-048 — Expansão das escalas do Check-up Mental (AUDIT, MDQ, Fagerström, MSI-BPD)

**Data:** 2026-06-12 · **Status:** Aceito · **Decisor:** Patrick (dono)

## Contexto

O MVP do checkup listava "mais escalas" como fora de escopo. O dono decidiu
expandir a triagem para além de depressão/ansiedade/TDAH: bipolaridade,
traços borderline, álcool, tabagismo e drogas ilícitas (pedido de 2026-06-12).

## Decisão

1. **Quatro instrumentos entram no motor** (`src/lib/scales`), na ordem de
   lançamento: **AUDIT** (álcool, OMS), **MDQ** (bipolaridade), **Fagerström/FTND**
   (nicotina), **MSI-BPD** (traços borderline). Todos seguem as regras absolutas
   do motor: itens = dados tipados, scoring determinístico com testes canônicos,
   texto exclusivamente das **versões brasileiras validadas**.
2. **Gate de validação**: todos nascem `validated: false` + `TODO(validar)`
   (o ambiente de desenvolvimento não alcançou as fontes oficiais — 403 de rede).
   `isScaleAvailable` mantém cada escala em "Em breve" até a conferência
   caractere a caractere pelo responsável clínico — o mesmo processo do PHQ-9.
3. **Sem verdict onde não há cutoff BR** (precedente ASRS-18/ADR-051):
   o **MSI-BPD** fica qualitativo (banda única `informative`) — o cutoff ≥7 é da
   amostra americana e não localizamos validação brasileira com corte publicado.
4. **Devolutiva estática (sem LLM) para MDQ e MSI-BPD**: bipolaridade e
   transtorno de personalidade são rótulos sensíveis; o texto é fixo, revisado à
   mão (`fallbacks.ts`), nunca gerado. AUDIT e Fagerström usam o caminho LLM
   normal (entrada estruturada, ADR-044), com os guardrails existentes.
5. **Crise**: o item 2 do MSI-BPD (autolesão/tentativas) é `isCrisisItem` —
   resposta "sim" desvia para `/crise` antes de qualquer escore, idêntico ao
   item 9 do PHQ-9.
6. **Motor estendido com opções por item** (`ScaleItem.options`): AUDIT,
   Fagerström e MDQ têm opções/pesos diferentes por pergunta; o `value` da opção
   é a pontuação oficial do item.
7. **ASSIST (drogas ilícitas) ADIADO**: o instrumento é uma matriz por
   substância com fluxo condicional — incompatível com o motor "uma pergunta por
   tela" sem um refactor de UX próprio, e encurtá-lo/parafraseá-lo é proibido.
   Reavaliar em fase dedicada (possível alternativa: DUDIT, se houver validação BR).

## Consequências

- Landings SEO (`/alcool`, `/bipolaridade`, `/tabagismo`, `/borderline`) e
  entrada no sitemap só APÓS cada escala virar `validated: true` — não se
  publica landing para teste "Em breve".
- Pendência registrada no DEBT: conferência char-a-char das 4 fontes oficiais
  (SUPERA/OPAS p/ AUDIT; Castelo 2010 p/ MDQ; INCA/MS p/ FTND; versão pt-BR
  publicada p/ MSI-BPD — incluindo confirmar se existe validação BR).
- A regra "mais escalas fora de escopo" do `apps/checkup/CLAUDE.md` deixa de
  valer para estes 4 instrumentos.
