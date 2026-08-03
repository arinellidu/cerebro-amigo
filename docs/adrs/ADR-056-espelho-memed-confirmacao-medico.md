# ADR-056 — Espelho de receita MEMED entra como rascunho; médico confirma horários e validade

- **Status:** Accepted
- **Data:** 2026-06-16
- **Relacionados:** ADR-024 (integração MEMED — a superfície que este ADR completa),
  ADR-032 (renovação de receita A4 + interações A5 — um dos jobs alimentados),
  skill `clinical-safety` (regras #1 e #4), skill `dotnet-gateway`, skill `nextjs-bff`.

## Contexto

O ADR-024 integrou o MEMED: o médico prescreve e assina **dentro** do widget; a receita legal vive no
MEMED; o gateway só espelha os medicamentos em `prescricoes` (`receita_tipo='memed'`) para o motor de
lembretes. O espelho conhece apenas **nome do medicamento + posologia em texto livre** — entregues
pelo evento `prescricaoImpressa` do SDK.

Dois automatismos já construídos dependem de dados estruturados que o espelho **não** tinha:

- `gerador_checkins_medicacao` itera `prescricoes.horarios` (`TIME[]`). Espelho gravava `horarios = '{}'`
  (default) → **zero check-in de adesão** para receita emitida via MEMED.
- `gerador_renovacao_receita` (A4) filtra `WHERE receita_validade IS NOT NULL`. Espelho não setava
  `receita_validade` → receita MEMED **nunca entrava na fila de renovação**.

Como o espelho ainda entrava `ativa = TRUE` e incompleto, a receita MEMED virava **beco sem saída**:
aparecia na lista de prescrições mas não gerava lembrete nem renovação — silenciosamente. Receita
**manual** (form completo) não tem o problema; só o caminho MEMED.

Extrair `horarios`/`receita_validade` parseando a posologia em texto livre seria inferir conduta a
partir de texto não-estruturado — proibido por clinical-safety #1 (a IA não interpreta posologia) e
arriscado (schedule errado → lembrete errado → dado de adesão poluído).

## Decisão

O espelho MEMED entra como **rascunho** e só vira prescrição ativa quando o **médico** confirma os
dados estruturados. Sem parse, sem IA.

### 1. Coluna `prescricoes.precisa_confirmar` (migration 0046)
`BOOL NOT NULL DEFAULT FALSE`. O espelho (`MemedEndpoints POST /receitas`) passa a gravar
`ativa = FALSE, precisa_confirmar = TRUE`. Como os dois jobs filtram `ativa = TRUE`, o rascunho fica
naturalmente fora deles até a confirmação. Índice parcial `WHERE precisa_confirmar = TRUE` para a fila.

### 2. Fila de confirmação + ativação (gateway)
- `GET /api/v1/prescricoes/paciente/{id}/a-confirmar` — lista rascunhos MEMED do paciente.
- `POST /api/v1/prescricoes/{id}/confirmar` — o médico informa `horarios` (lembrete) e
  `receita_validade` (renovação), opcionalmente `inicio/fim`; seta `ativa = TRUE,
  precisa_confirmar = FALSE` e grava evento `adicao` na timeline. Só aqui a receita entra nos jobs.
- `POST /api/v1/prescricoes/{id}/descartar` — sai da fila sem virar prescrição ativa.
- A lista normal (`GET .../paciente/{id}`) passa a excluir `precisa_confirmar = TRUE` (rascunho não
  polui o prontuário). Todos os endpoints mantêm o tenant via `JOIN pacientes` (clinical-safety).

### 3. UI no prontuário (web)
Componente `ReceitasMemedAConfirmar` na aba Prescrições: para cada rascunho, o médico informa horários
(multi) + validade e clica "Ativar lembrete + renovação", ou descarta. Só renderiza quando há
pendência. A decisão de horário/validade é do médico — **clinical-safety #4 (médico no loop)**.

### 4. Captura do espelho deixa de ser silenciosa (Fix B)
O `BotaoReceitaMemed` espelhava com `fetch(...).catch(() => {})` — falha invisível. Agora há retry
(3x, backoff) e, na falha final, aviso ao médico ("receita emitida no MEMED, mas o lembrete não foi
criado — recadastre manualmente"). Em sucesso, dispara o refresh da fila de confirmação.

## Consequências

- Receita MEMED passa a alimentar lembrete de adesão e renovação A4 — mas **só após** confirmação
  humana dos dados estruturados. Um clique a mais por receita, em troca de não inventar posologia.
- Rascunhos não confirmados não disparam nada (fail-safe): o pior caso é "lembrete não criado", nunca
  "lembrete errado".
- **Dependência aberta (não resolvida aqui):** o nome/shape exato do evento `prescricaoImpressa` ainda
  precisa ser confirmado no sandbox MEMED. O hardening de captura é defensivo; a validação fim-a-fim
  depende de credencial sandbox. Reconciliação server-side via REST do MEMED fica como evolução.

## Regras respeitadas

- **clinical-safety #1:** a IA não infere posologia/horário/validade — quem preenche é o médico.
- **clinical-safety #4:** médico no loop; o rascunho não age até ele confirmar.
- **Auditoria append-only:** confirmação grava evento `adicao` em `prescricao_eventos`; nada é apagado.
- **Multi-tenant:** todo acesso escopado por `pacientes.medico_responsavel_id`.
