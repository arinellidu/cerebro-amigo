# ADR-057 — Segunda barreira A5 roda no confirmar do rascunho MEMED (não-pulável)

- **Status:** Accepted
- **Data:** 2026-06-16
- **Relacionados:** ADR-032 (A5 — checagem determinística de interações/duplicidade),
  ADR-056 (Tier 1 — espelho MEMED vira rascunho + confirmação do médico, a superfície
  onde isto se acopla), ADR-024 (MEMED), skill `clinical-safety` (regra #1).

## Contexto

O A5 (ADR-032) já tem um motor determinístico sólido (`InteracoesEndpoints`
`POST /api/v1/prescricoes/checar-interacoes`: mapeia texto livre → genérico/classe via
`medicamento_dicionario`, cruza pares contra `interacao_catalogo`). Mas a única superfície
que o invoca é o painel `VerificadorInteracoes` no prontuário — passivo e à parte do ato de
prescrever.

Levantamento ao iniciar o Tier 2: **não existe form de prescrição manual no web** — nenhum
componente chama `POST /api/v1/prescricoes/` e não há rota BFF de criação. A **única** entrada
de prescrição no produto é o **espelho MEMED**. Logo o momento real em que um fármaco novo
entra é o **confirmar do rascunho MEMED** (ADR-056) — e é exatamente ali que faltava a 2ª
barreira disparar.

Expandir o **conteúdo** do catálogo (quais pares interagem, severidade) é decisão clínica e
fica com o Dr. Adonai — a IA não inventa conteúdo clínico (clinical-safety #1, e a base segue
`A5-…-draft`). Este ADR é só **engenharia**: ligar a checagem que já existe no ponto certo.

## Decisão

A 2ª barreira A5 roda **automaticamente** dentro de `ReceitasMemedAConfirmar`, antes de o
médico ativar o rascunho.

### 1. Uma checagem por receita, cobrindo intra-receita + ativos
Rascunhos MEMED são `ativa = FALSE` (ADR-056), então o `checar-interacoes` — que pareia com
as prescrições **ativas** do paciente — não os enxergaria entre si. O componente envia **todos
os medicamentos dos rascunhos pendentes juntos** (`medicamentos: [...]`) + `pacienteId`, então
o motor cruza tanto rascunho × ativo quanto rascunho × rascunho (dois fármacos da mesma receita).

### 2. Bloco de alerta prominente, grave primeiro
Acima das linhas de confirmação, com a mesma linguagem visual do `VerificadorInteracoes`
(coral = grave, âmbar = moderada; mecanismo/recomendação/fonte; disclaimer). Auto-roda ao
carregar e a cada mudança da lista. Visibilidade não-pulável substitui o "painel que ninguém abre".

### 3. Informa, NÃO bloqueia (clinical-safety #1)
A barreira **não** impede a ativação — a decisão é do médico. Havendo alerta grave, um aviso
inline ("Há alerta grave acima — confirme se intencional") aparece junto ao botão Ativar, mas
o botão segue habilitado. A IA nunca veta a conduta do médico.

### 4. "Falhou" ≠ "sem interação"
Se a checagem falhar (rede/upstream), o bloco diz explicitamente que a 2ª barreira **não foi
concluída** e que não se deve tratar a tela como "sem interações" — mesmo invariante do
`VerificadorInteracoes`. Uma barreira que falhou nunca pode parecer "limpa".

## Consequências

- Todo fármaco que entra via MEMED passa a ser cruzado contra o que o paciente já usa, no
  momento da confirmação — sem depender de o médico abrir um painel.
- Acoplado ao Tier 1 (ADR-056): vive dentro de `ReceitasMemedAConfirmar`. Enquanto não houver
  form de prescrição manual, esta é a cobertura completa do ato de prescrever.
- **Limite herdado:** a qualidade do alerta é a do catálogo `A5-…-draft` — não-exaustivo,
  pendente de revisão clínica (Adonai). Ausência de alerta não garante ausência de interação;
  o disclaimer permanece sempre visível.

## Regras respeitadas

- **clinical-safety #1:** a IA informa fato (base local versionada), não gera conduta nem
  bloqueia a decisão do médico.
- **Multi-tenant:** o `checar-interacoes` escopa os ativos por `pacientes.medico_responsavel_id`.
- **Sem invenção clínica:** nenhuma interação nova foi criada aqui; só a chamada ao motor existente.
