# ADR-051 — Validação e fidelidade das escalas do Check-up (PHQ-9, GAD-7, ASRS-18)

Status: Aceito · Data: 2026-06-11 · Escopo: `apps/checkup` · Relaciona: `apps/checkup/src/lib/scales/CLAUDE.md`, regra inegociável #1 (a IA não diagnostica)

## Contexto

O `apps/checkup` (Check-up Mental) serve triagem pública de três instrumentos clínicos
validados: PHQ-9 (depressão), GAD-7 (ansiedade) e ASRS-18 (TDAH adulto). A regra do
produto é absoluta: **itens de instrumentos validados nunca são inventados, parafraseados
ou traduzidos por conta própria**, e **triagem nunca é diagnóstico**.

Cada escala carrega um flag `validated: boolean`. O gate `isScaleAvailable(scale)`
(`validated === true && items.length > 0`) bloqueia o quiz em produção enquanto o texto
não for conferido. As três escalas nasceram com `validated: false`. Este ADR registra as
decisões tomadas ao levá-las a `true`.

## Decisão

### 1. O flag `validated` é uma atestação clínica humana — não automática

Virar `validated: true` significa que **um humano conferiu o texto caractere a caractere
contra a publicação/fonte canônica**. Um LLM **não** vira o flag por conta própria: a
"memória" do modelo sobre instrumentos clínicos é exatamente a fonte não confiável que o
flag existe para barrar. Em cada escala, o flip só ocorreu após o dono do produto fornecer
o PDF oficial e o texto ser conferido contra ele.

### 2. PHQ-9 e GAD-7 — versão oficial Pfizer PT-BR (autorrelato)

- Fonte canônica: **tradução oficial "Portuguese for Brazil"** distribuída em
  phqscreeners.com (Pfizer/MapiTrust), formato **autorrelato** — adequado a um teste
  autoaplicado. **Não** se usa a versão de Santos et al. 2013 (PHQ-9), que é aplicada por
  entrevistador e usa opções de resposta modificadas; nem se atribui a Moreno et al. (GAD-7),
  que é paper psicométrico e não reproduz o instrumento.
- A conferência char-a-char contra os PDFs oficiais corrigiu o `source` (estava citando
  Santos/Moreno) e achou **um defeito real**: o item 8 do PHQ-9 estava sem a palavra "muito"
  ("...muito mais do que de costume") — corrigido. GAD-7: zero defeito.
- **House style do app** (decisão do dono do produto): notação de gênero `(a)/(o)` e
  ortografia moderna pós-2009 (sem trema: "frequência", não "freqüência"). É normalização
  ortográfica/tipográfica — **não** altera o conteúdo clínico do instrumento. Documentado
  no `source` e nos comentários de cada arquivo.

### 3. ASRS-18 — scoring qualitativo, SEM verdict

- Fonte canônica: **Mattos et al. 2006** (Rev. Psiq. Clín., Tabela 2) — adaptação
  transcultural da ASRS v1.1 (OMS). 18 itens transcritos verbatim (Parte A = 9 itens de
  desatenção; Parte B = 9 de hiperatividade-impulsividade), com o mesmo house style.
- **O checkup não emite veredito (positivo/negativo) no ASRS-18.** Mattos adverte
  **explicitamente** que **não há pontos de corte validados para a população brasileira** e
  recomenda cautela em usar a pontuação dos itens ou tratar "algumas vezes" como positivo.
  Portanto **não** aplicamos os cutoffs da validação americana (Kessler) nem a tabela de
  células sombreadas. `scoreAsrs18` apenas soma (`totalScore` informativo) e devolve uma
  banda única `informative`. A tela de resultado **esconde o número** e mostra um rótulo
  neutro; a devolutiva é fixa (`ASRS_FALLBACK`) e **não chama o LLM** (evita veredito
  implícito + minimização de dados, LGPD).

## Alternativas consideradas e rejeitadas

- **PHQ-9 na versão Santos 2013 (entrevistador).** Rejeitada: voz de entrevistador
  ("quantos dias o sr.(a)...") é inadequada a um teste autoaplicado, e as opções modificadas
  divergem da família PHQ usada no GAD-7. Mantida só como referência de comparação.
- **ASRS-18 com cutoff (screener WHO de 6 itens, ≥4 positivos, ou contagem DSM-IV).**
  Rejeitada **agora**: a própria fonte BR (Mattos) desaconselha cutoff sem dados nacionais.
  Emitir "triagem positiva" a um público anônimo e possivelmente vulnerável, sobre base não
  validada para o Brasil, viola "triagem nunca é diagnóstico".
- **Deixar o LLM virar `validated` / transcrever de memória.** Rejeitada por princípio:
  é a falha que o flag existe para impedir.

## Consequências

- As três escalas estão `validated: true` e live; o funil TDAH (`/tdah-adulto`) deixou de
  ser "Em breve" e tem CTA real.
- O ASRS-18 entrega valor (organiza sintomas para levar ao profissional) sem assumir risco
  clínico de um veredito não validado.
- A tela de resultado e a camada de devolutiva passaram a ter um caminho neutro
  (`informative`) além das bandas com verdict de PHQ-9/GAD-7.
- O gate `isScaleAvailable` permanece a defesa estrutural: qualquer escala futura nasce
  bloqueada até conferência humana.

## Gatilhos de revisão

- Publicação de **pontos de corte validados para o ASRS-18 na população brasileira** →
  reabrir por novo ADR para decidir se o checkup passa a emitir verdict (ex.: screener WHO
  6 itens — A4, A5, A6, A9 + B1, B5; ≥4 positivos), com disclaimer.
- Mudança de versão oficial de qualquer instrumento (nova revisão Pfizer/OMS) → reconferir
  char-a-char e re-emitir o flag.
- Decisão de abandonar o house style (voltar a `/a` / ortografia original) → exige nova
  conferência, pois muda o texto exibido.
