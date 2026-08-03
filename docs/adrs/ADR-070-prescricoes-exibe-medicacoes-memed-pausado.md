# ADR-070 — Aba Prescrições exibe medicações em uso; emissão MEMED pausada

- **Status:** Accepted
- **Data:** 2026-06-20
- **Decisor:** Dono (Patrick).
- **Relacionados:** ADR-024 (MEMED = prescrição legal), ADR-056 (espelho MEMED → rascunho +
  confirmação do médico), ADR-062 (medicações em uso / reconciliação), ADR-032 (catálogo de
  interações A5), ADR-042 (RLS), skill `clinical-safety`.

## Contexto

Até aqui o prontuário separava, de propósito (ADR-062), duas superfícies:
- **Prescrições** — só receita legal MEMED (`prescricoes`, via espelho ADR-056).
- **Medicações em uso** — reconciliação do que o paciente toma (`medicacoes_em_uso`), digitada pelo
  médico, "não é receita".

Dois problemas práticos no lançamento:
1. **A integração MEMED está atrasando.** Sem ela, nada escreve em `prescricoes` → a aba Prescrições
   fica permanentemente vazia ("Sem prescrições registradas"), enquanto o médico já registra
   medicamentos em "Medicações em uso". Para o médico, isso parece bug ("prescrevi e não aparece").
2. O médico quer **ver os medicamentos do paciente numa única superfície** e **escolher fármacos sem
   digitar/lembrar o nome**.

A tentação óbvia — copiar `medicacoes_em_uso` para a tabela `prescricoes` ("mesclar de verdade") —
introduz bugs clínicos: a checagem A5 já faz `UNION prescricoes + medicacoes_em_uso` no gateway, logo
duplicar a linha **conta cada fármaco 2×** (falso alerta de duplicidade); e uma linha em `prescricoes`
sem `horarios`/`receita_validade` dispara lembrete A3 / renovação A4 indevidos — exatamente o bug que
o ADR-056 fechou.

## Decisão

**1. Pausar a emissão de receita MEMED (reversível por flag).** No prontuário-web
(`apps/web/app/dashboard/prontuarios/[id]/prescricoes/page.tsx`), `const MEMED_HABILITADO = false`
oculta o botão "Emitir receita (MEMED)" e a fila de confirmação (ADR-056). O código MEMED **não é
removido** — reativar = flipar a const quando a integração ficar pronta. O verificador de interações
(2ª barreira) permanece.

**2. Aba Prescrições passa a exibir as medicações em uso — união só de EXIBIÇÃO.** A aba lê
`medicacoes_em_uso` (mesma fonte da aba homônima) e, quando MEMED voltar, une também as `prescricoes`
ativas. **Não se grava `medicacoes_em_uso` na tabela `prescricoes`** — a união é apenas na renderização.
Isso preserva a checagem A5 (sem dupla contagem) e os agentes A3/A4 (sem disparo indevido).

**3. Picker de fármacos por classe terapêutica.** No verificador de interações, o médico escolhe de um
catálogo agrupado por classe (accordion + checkbox) em vez de digitar. Gateway:
`GET /api/v1/medicamentos/agrupado` (read-only, **não-tenant** — `medicamentos` é dicionário global;
catálogo completo, sem o `LIMIT 50` da busca). A seleção devolve `nome_generico` (token canônico do
dicionário A5) → casa melhor na checagem do que texto livre.

**4. Exportar/imprimir medicações em uso.** Menu "Exportar" na aba: Imprimir/PDF (`window.print()` em
documento limpo, sem dependência nova) e CSV/Excel (`lib/csv`, `;` + BOM). O documento marca
explicitamente **"não é receita médica"**.

## Consequências

- **Relaxa a separação estrita de UI do ADR-062** (que mantinha reconciliação fora da aba Prescrições).
  A distinção **clínica/legal continua intacta**: `medicacoes_em_uso` segue tabela própria, segue sendo
  reconciliação (não receita), e o rótulo "não é receita" permanece no cadastro e no PDF. O que muda é
  só onde a lista é *exibida*.
- **MEMED segue como única prescrição legal** (ADR-024). A pausa é de produto/UI, reversível, não uma
  decisão de descartar MEMED.
- Mudança 100% em `apps/web` + um endpoint read-only no gateway. Sem migration, sem alteração de schema,
  sem novo caminho de escrita clínica.
- Se/quando a separação ADR-062 voltar a importar (ex.: MEMED religado e o médico quiser distinguir
  receita de reconciliação na mesma aba), revisar este ADR — hoje a lista é unificada sem rótulo de
  origem por item.

## Regras respeitadas
- **clinical-safety #1**: nenhum dado gerado por IA; tudo é dado do médico. Catálogo do picker = fonte
  curada (A5), não LLM.
- **Prescrição legal segue só MEMED** (ADR-024): a exibição unificada não cria receita; é registro.
- **A5 / agentes A3-A4 intactos**: união só de exibição evita dupla contagem na checagem de interações
  e disparo indevido de lembrete/renovação (o motivo de NÃO mesclar no nível de dados).
- **RLS (ADR-042)**: `medicacoes_em_uso` segue tenant-scoped; o endpoint `/agrupado` é catálogo global
  (sem PII, sem dado de paciente).
