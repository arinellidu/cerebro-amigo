# ADR-058 — Relatório de pontos-cegos do catálogo A5 (cobertura)

- **Status:** Accepted
- **Data:** 2026-06-16
- **Relacionados:** ADR-032 (A5 — catálogo de interações), ADR-057 (barreira A5 no
  confirmar de prescrição), skill `clinical-safety` (regra #1), skill `dotnet-gateway`.

## Contexto

O catálogo do A5 (`medicamento_dicionario` + `interacao_catalogo`) é `A5-…-draft`,
não-exaustivo e pendente de revisão clínica (Dr. Adonai). A pergunta operacional —
*"o que falta no catálogo?"* — vinha sendo respondida no chute. Um medicamento prescrito
que o dicionário não reconhece passa **silenciosamente** sem nenhuma checagem de interação
(a barreira do ADR-057 não tem o que cruzar).

Expandir o **conteúdo** do catálogo (quais fármacos, quais interações, severidade) é
decisão clínica e fica com o Adonai — a IA não inventa conteúdo clínico (clinical-safety #1).
O que a engenharia pode dar é o **worklist priorizado**: quais fármacos realmente prescritos
estão fora do dicionário, por frequência de uso.

## Decisão

Endpoint admin read-only `GET /api/v1/admin/interacoes/cobertura` (policy `admin_geral`,
zero escopo de tenant — visão de plataforma).

1. Varre `prescricoes.medicamento` (distinct + contagem). `?ativasApenas=true` limita às
   ativas; default = todo o vocabulário já prescrito (cobertura é sobre o texto).
2. Resolve cada texto contra o `medicamento_dicionario` **com o mesmo matching do motor**
   (`InteracoesEndpoints`: `Norm` minúsculo/sem-acento + substring de sinônimos/genérico) —
   senão o relatório discordaria da checagem real.
3. Devolve os **não-reconhecidos** ordenados por ocorrência + contadores (distintos,
   reconhecidos, tamanho do dicionário, versão do catálogo).
4. Superfície: página admin `/admin/interacoes` (KPIs + tabela + export CSV) — o CSV é o
   insumo que o Adonai usa para decidir o que adicionar.

## Consequências

- A revisão clínica do catálogo passa a ser dirigida por **dados de uso real**, não por
  chute — fármacos mais prescritos e descobertos primeiro.
- Read-only e determinístico: não cria, não altera, não infere conteúdo clínico. Só mede
  cobertura. Adicionar entradas ao dicionário segue sendo ato clínico (próxima fatia:
  governança do catálogo, draft→revisado sem editar SQL).
- O matching duplica a `Norm` do `InteracoesEndpoints` (comentado como espelho) — se um dia
  divergir, o relatório mente; candidato a helper compartilhado se a lógica crescer.

## Regras respeitadas

- **clinical-safety #1:** mede cobertura, não gera conduta nem inventa interação.
- **Acesso:** admin (owner/admin), sem dado clínico identificável no relatório (só texto do
  medicamento + contagem agregada da plataforma).
