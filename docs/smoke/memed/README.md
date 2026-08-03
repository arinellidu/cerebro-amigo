# Smoke do fluxo MEMED (sandbox)

Fecha duas incógnitas que o código carrega como **best-effort** (ADR-024 "Incógnitas a
confirmar no sandbox" + gate aberto do Tier 1 / ADR-056 / DEBT G-8):

1. As chaves de homologação provisionam um prescritor e devolvem `token`? (Parte A)
2. Qual o **nome real** do evento de conclusão da prescrição e o **shape** do payload
   (id + array de medicamentos)? Hoje `BotaoReceitaMemed` aposta em `prescricaoImpressa`
   e em chaves `nome/medicamento/descricao` + `posologia/descricao` — sem confirmação. (Parte B)

> Sandbox apenas. **Nunca** rode com credencial de produção. Prod só após homologação MEMED
> (ver memória do projeto / pergunta "onde pego a memed de produção").

---

## Parte A — REST (scriptável)

```bash
cd docs/smoke/memed
chmod +x memed-sandbox-rest-smoke.sh
./memed-sandbox-rest-smoke.sh
```

Default usa as chaves sandbox públicas (mesmas do `.env.example`). Sobrescreva se precisar:

```bash
MEMED_API_KEY=
CPF=... CRM_NUMERO=... CRM_UF=SP \
./memed-sandbox-rest-smoke.sh
```

**Sucesso** = `HTTP 200/201` + `data.attributes.token` preenchido. Copie o token.

Se vier erro de `board`/`cpf`: o sandbox pode exigir o **médico de teste oficial** da doc de
parceiro do MEMED — passe os dados dele por env (`CPF`, `CRM_NUMERO`, `CRM_UF`).

Confirma também: a resposta REST bate com o que `MemedClient.RegistrarOuObterAsync` parseia
(`data.id` + `data.attributes.token`). Se o shape mudou, o client quebra — registre aqui.

---

## Parte B — evento do SDK (browser + humano)

O evento de conclusão **só dispara dentro do widget**, depois que um humano prescreve e
imprime/conclui. Não tem como headless.

```bash
cd docs/smoke/memed
python3 -m http.server 8099
# abra http://localhost:8099/sandbox-event-smoke.html
```

(`file://` costuma funcionar, mas o `http.server` evita CORS na carga do SDK.)

Na página:
1. Cole o **token** da Parte A.
2. (Opcional) ajuste paciente de teste.
3. **Carregar SDK + abrir prescrição**.
4. No widget MEMED: prescreva um medicamento de teste e **conclua/imprima**.
5. Veja o painel de log: ele registra **qual** evento disparou (rede de nomes candidatos +
   spy global) e faz **dump do payload**.

### O que registrar (cola no ADR-024 + ajusta o código)

- **Nome exato** do evento que disparou (ex.: `prescricaoImpressa` ou outro).
- **Caminho do id**: `payload.prescricao.id`? `payload.id`? outro?
- **Caminho dos medicamentos**: `payload.prescricao.medicamentos[]`? `payload.medicamentos[]`?
- **Chaves de cada medicamento**: `nome`/`medicamento`/`descricao`? `posologia`/`descricao`?

### Onde isso entra no código

`apps/web/components/memed/botao-receita-memed.tsx` (handler `prescricaoImpressa`):
- Se o **nome** for outro → trocar o nome do listener.
- Se o **shape** divergir → ajustar o mapeamento `{ nome, posologia }` que vai pro espelho
  (`POST /api/memed/receitas` → `prescricoes`). O espelho alimenta a fila de confirmação
  (ADR-056); chave errada = medicamento vazio no rascunho.

Depois de confirmado, fechar o item no ADR-024 ("Incógnitas") e no DEBT (G-8 → "dep. sandbox" resolvida).
