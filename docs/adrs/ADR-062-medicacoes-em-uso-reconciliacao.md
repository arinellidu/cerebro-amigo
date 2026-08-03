# ADR-062 — Medicações em uso (reconciliação medicamentosa)

- **Status:** Accepted
- **Data:** 2026-06-16
- **Decisor:** Dono (Patrick).
- **Relacionados:** ADR-024 (MEMED = prescrição legal), ADR-056/057 (espelho MEMED + barreira A5),
  ADR-032 (catálogo de interações A5), ADR-042 (RLS), skill `clinical-safety`.

## Contexto

O médico pediu, no prontuário, "adicionar medicamentos" + uma lista de fármacos (ANVISA) com
descrição. Duas restrições duras:
1. **Prescrição legal é só MEMED** (ADR-024/056): assinatura ICP-Brasil, conformidade CFM/ANVISA,
   entrega ao paciente. NÃO há form manual de prescrição — de propósito. Um "adicionar prescrição"
   no nosso banco não seria receita válida e furaria o médico-no-loop + a barreira A5.
2. **Descrição de fármaco não pode ser gerada por IA** (clinical-safety #1): alucinação = risco
   clínico. Tem de vir de fonte autoritativa.

Além disso, há um buraco real: a checagem de interações A5 só vê prescrições da plataforma —
ignora o que o paciente toma por **outro prescritor**.

## Decisão

Implementar **reconciliação medicamentosa** — REGISTRO do que o paciente já toma, distinto de
prescrever. Não é receita.

- **Tabela nova `medicacoes_em_uso`** (migration 0047): `paciente_id`, `medico_id` (quem registrou),
  `medicamento` (catálogo OU texto livre), `generico`, `classe`, `posologia` (texto livre, o médico
  digita), `fonte` (ex.: "outro psiquiatra"), `ativa`. **RLS** por tenant (padrão ADR-042: médico
  dono via `pacientes`, sem acesso do portal). Separada de `prescricoes` (MEMED/legal).
- **Gateway** `MedicacoesEmUsoEndpoints` (`/api/v1/medicacoes-em-uso`): listar/registrar/remover,
  tenant-scoped (JOIN `pacientes` + RLS). Sem LLM.
- **Catálogo** reusa `MedicamentosEndpoints` (`/api/v1/medicamentos`, já existia) lendo a tabela
  `medicamentos`. A 0047 a **semeia** projetando o dicionário A5 curado (~50 fármacos
  psiquiátricos): nome genérico + classe (fatos objetivos). `dosagens`/`indicacoes_resumo`/
  `registro_anvisa` ficam vazios → **pendentes de revisão clínica (Adonai)** — a IA não os inventa.
- **A5**: `checar-interacoes` passou a incluir `medicacoes_em_uso` ativas (UNION) → fecha o buraco
  do remédio externo. Informa, não bloqueia (clinical-safety #1).
- **Web**: aba "Medicações em uso" no prontuário — lista + adicionar (busca no catálogo OU texto
  livre + posologia + fonte) + remover. Rotulada **"não é receita"**.

## Consequências

- **Migration 0047 + seed** → aplicar no RDS (via box/SSM, como as demais).
- **Catálogo é só nome+classe por ora.** Descrição rica (indicação/posologia padrão/registro ANVISA)
  fica como follow-up do Adonai (entrada no DEBT). O texto livre cobre qualquer fármaco fora do catálogo.
- A barreira A5 agora enxerga medicação externa registrada — melhora a detecção de interações.

## Regras respeitadas
- **Prescrição legal segue só MEMED** — isto é registro, não receita (sem assinatura/entrega).
- **clinical-safety #1**: a IA não preenche/sugere; descrição = fonte curada (Adonai), nunca LLM.
- **RLS (ADR-042)**: tabela clínica nova entra no isolamento de tenant; gateway NOBYPASSRLS filtrado.
