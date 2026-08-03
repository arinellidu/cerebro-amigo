# ADR-010: Triagem de crise no Diário (áudio e texto)

**Status:** Aceito
**Data:** 2026-05-30
**Decisão:** Toda entrada de diário (voz ou texto) passa por triagem de crise
antes de ser analisada ou salva. Estende o ADR-004 ao canal do diário.

## Contexto

O Diário (ADR da feature de voz) deixava o paciente registrar áudio/texto livre.
O áudio rodava análise (Sonnet: humor/tags/sintomas) e o texto era salvo direto
no gateway — **nenhum dos dois passava pela triagem de crise**. Um paciente que
relatasse ideação suicida no diário recebia um badge de emoção e nada mais:
sem protocolo, sem notificação ao médico, sem pausa de automação. Violação direta
da regra #2 (clinical-safety) — o protocolo de crise é obrigatório em qualquer
superfície que receba conteúdo do paciente.

## Decisão

1. **Detecção** reusa o classificador do ADR-004 (Haiku, conservador). Vive em
   `agents-py/app/services/crisis.py`. Fail-safe: erro/indisponibilidade do
   classificador → tratado como crise (falso negativo é inaceitável).
2. **Resposta** é o **texto fixo** de `crisis_copy.py`, com paridade de hash
   garantida contra o orchestrator (`9b3927bf…`). Nunca gerado por LLM.
3. **Áudio:** a triagem roda na transcrição (`transcricao.py`), DEPOIS do
   Transcribe e do delete do S3, ANTES da análise Sonnet. Se crise: aciona
   protocolo, devolve `crise=true` + texto, pula a análise.
4. **Texto:** o gateway chama `agents-py /internal/diario/triar-texto` ANTES de
   salvar. Cobre também transcrição editada pelo paciente. Se crise: a entrada
   **não é salva** como nota comum e o front exibe o acolhimento.
5. **Ao acionar** (`acionar_protocolo_diario`, transação única):
   - INSERT em `protocolos_crise_acionados` (append-only, `origem` =
     `diario_audio`/`diario_texto`, `mensagem_id` NULL — não é conversa);
   - INSERT em `notificacoes_medico` (severidade `critico`);
   - `pacientes.automacao_pausada = TRUE`.
6. **Fail-closed no transporte:** se o gateway não consegue falar com o agents-py
   (rede/serviço fora), o POST de texto retorna **503** — não salva conteúdo
   não-triado e não inventa texto de crise (o gateway não chama LLM nem tem
   `crisis_copy`). O paciente tenta de novo.
7. **Front:** ao receber `crise=true`, mostra tela de acolhimento fixa
   (texto do backend + atalhos CVV 188 / SAMU 192) — **sem** formulário de
   edição, sem análise, sem salvar.

## Schema

Migration `0006_crise_diario.sql` estende `protocolos_crise_acionados`
(append-only — regra #5): `mensagem_id` (nullable, FK mensagens), `origem`,
`palavras_detectadas` (categorias, nunca verbatim — regra #4), `resposta_enviada`,
`medico_notificado`, `medico_notificado_em`. Isso também **destrava o
orchestrator-py**, cujo `crisis.py` já inseria essas colunas inexistentes (o
protocolo de crise da conversa quebraria em runtime).

## Regras respeitadas

- **#2** protocolo fixo, texto de `crisis_copy`, nunca LLM; pausa automação.
- **#4** `palavras_detectadas` = categorias, sem trechos verbatim do paciente.
- **#5** trilha append-only — migration só adiciona colunas.

## Limitações conhecidas

- Quota Bedrock=0 na conta (sa-east-1): enquanto não liberada, o classificador
  sempre lança throttling → fail-safe → **toda** entrada de diário é tratada
  como crise. Comportamento correto por segurança, mas inviabiliza uso real até
  a quota subir (ver `docs/aws-bedrock-quota-support-case.md`).
- SHADOW_MODE não suprime o registro/notificação da crise (intencional: crise é
  sempre real-action); apenas o envio externo de push/WhatsApp respeita o gate.
