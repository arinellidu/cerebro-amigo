# CLAUDE.md — src/lib/ai (devolutiva por IA)

A devolutiva é o momento de mais valor percebido — e de mais risco. Por isso ela é
**estreita por desenho**: a IA escreve dentro de uma moldura; ela não decide nada.

## Arquitetura

- Anthropic API direta, modelo **`claude-haiku-4-5`** (custo/latência), via
  `@anthropic-ai/sdk`. Chave somente por env `ANTHROPIC_API_KEY` — nunca em
  código, imagem ou log. Interface única atrás da flag `LLM_PROVIDER`
  (default `anthropic`); trocar de provedor no futuro deve ser config, não refactor.
- Entrada: APENAS dados estruturados — `{ scaleId, totalScore, band, bandLabel,
  partAPositives? }`. **Nunca enviar respostas item a item nem texto livre do usuário**
  (não existe campo de texto livre no produto; manter assim).
- Saída: JSON com estrutura fixa, validado com Zod. Se o parse falhar → retry 1x →
  **fallback estático** (templates por banda, escritos à mão, revisados — sempre
  disponíveis em `fallbacks.ts`). O produto NUNCA quebra se a API cair.
- `temperature` baixa (≤ 0.4). `max_tokens` ~600.

## Estrutura fixa da resposta

```json
{
  "acolhimento": "1–2 frases, calorosas, sem dramatizar",
  "leitura": ["2–3 frases explicando o que o escore sugere e o que a escala mede"],
  "limites": "1 frase fixa reforçando que é triagem, não diagnóstico",
  "proximos_passos": ["2–3 ações concretas, começando por procurar um profissional"]
}
```

## Guardrails de conteúdo (aplicar no system prompt E validar na saída)

Proibido na saída (rejeitar e usar fallback se aparecer):
- "você tem", "diagnóstico", "você sofre de", "doença confirmada", nomes de
  medicamentos, dosagens, recomendações de tratamento específicas.
- Minimização ("é só ansiedade") e catastrofização ("isso é muito grave").
- Qualquer menção a métodos de autoagressão. (O fluxo de crise nem chega aqui:
  `crisisFlag` desvia ANTES da devolutiva — ver docs/CRISIS-PROTOCOL.md.)

Obrigatório:
- Tom: caloroso, direto, adulto. Sem infantilizar, sem jargão.
- Sempre apontar para avaliação profissional como próximo passo natural.
- Português do Brasil, segunda pessoa, sentence case.

## Esqueleto do system prompt (ponto de partida — refinar com testes)

```
Você escreve devolutivas de instrumentos de TRIAGEM de saúde mental.
Você recebe apenas: escala, escore total e faixa.
Você responde SOMENTE com o JSON da estrutura combinada, em pt-BR.
Regras: nunca diagnostique; nunca cite medicamentos ou tratamentos;
nunca minimize nem dramatize; sempre inclua a busca por um profissional
nos próximos passos; tom caloroso e direto, para um adulto.
```

## Testes

- Snapshot tests dos fallbacks (são produto, não emergência).
- Teste de contrato: saída do modelo → Zod → render. Mock do client Anthropic nos testes.
- Lista de proibições coberta por teste de regex sobre a saída antes do render.