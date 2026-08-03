# ADR-040 — Escriba clínico (Ambient Scribe) na teleconsulta

Status: Aceito · Data: 2026-06-06 · Revisa: ADR-026 (teleconsulta vídeo P2P), ADR-018 (cifragem), ADR-005/006 (crise)

## Contexto

Psiquiatra perde ~2h/dia transcrevendo evolução após consultas. A teleconsulta (ADR-026)
já captura áudio bidirecional, mas hoje é descartado e a chamada **não é gravada** (regra
explícita do ADR-026). Queremos transformar o áudio da consulta em um **rascunho de evolução**
para o médico revisar — reduzindo a burocracia sem que a IA pratique medicina.

## Decisão

Adicionar o **Escriba**: gravação de áudio **consentida** da teleconsulta → transcrição
(Amazon Transcribe in-region pt-BR, com diarização médico/paciente) → **rascunho FACTUAL**
gerado por Claude (Bedrock, via agents-py) → médico revisa, completa e aprova → vira
`evolucoes_clinicas` (append-only).

### O que muda no ADR-026

ADR-026 dizia "nunca grava". Passa a permitir gravação **apenas** quando:
1. O paciente **consentir explicitamente** antes da consulta (LGPD cat. especial, Art. 11).
2. O áudio servir **só** à transcrição e for **descartado imediatamente** após (mesma
   política do Diário de Voz, ADR-004/migration 0004 — S3 efêmero, delete pós-job).
3. A mídia da chamada segue **E2E P2P**; a captura para transcrição é feita no cliente do
   médico (MediaRecorder sobre os streams locais já presentes) e enviada só ao backend
   interno para transcrever. Sem consentimento, a gravação fica **desabilitada**.

## Guardrails clínicos (clinical-safety)

- **Regra #1 — a IA não pratica medicina.** O rascunho é **factual**: relato do paciente,
  temas abordados, medicações **mencionadas** (para o médico confirmar) e resumo neutro do
  que foi dito. **Não** gera diagnóstico, CID, avaliação clínica, ajuste de dose nem plano.
  A avaliação e a conduta são escritas pelo **médico**. (Difere do "SOAP com CID" proposto
  no doc de ideias — aquele violaria a regra #1.)
- **Regra #2 — crise.** O Escriba é **doctor-facing**: o rascunho vai **só** ao médico, nunca
  ao paciente. Por isso **não** aciona o protocolo de crise patient-facing (texto de
  acolhimento/pausa de automação) — o médico estava na consulta. Se a fala contiver menção de
  risco, marcamos `mencao_risco=true` como **flag factual** para o médico revisar. Nenhum texto
  é gerado/enviado ao paciente.
- **Regra #3 — médico no loop.** Nada vira evolução sem aprovação do médico. O rascunho é
  editável; a evolução final é do médico (badge "assistido por IA").
- **Regra #4 — LGPD.** Consentimento explícito; áudio descartado pós-transcrição; transcrição
  e rascunho **cifrados em repouso** (ADR-018, AES-256-GCM, `ENCRYPTION_KEY`); dado e inferência
  in-region (`sa-east-1`); PII redatada em traces.
- **Regra #5 — auditoria.** `evolucoes_clinicas` é **append-only**.

## Arquitetura

- **Captura:** cliente do médico (Next.js, MediaRecorder sobre os streams da teleconsulta),
  habilitada só com consentimento do paciente.
- **Transcrição + rascunho:** `agents-py` (`/internal/escriba/transcrever`) — reusa o pipeline
  do Diário de Voz (S3 efêmero → Transcribe → delete) + Claude Sonnet via Bedrock para o
  rascunho factual. Diarização (`ShowSpeakerLabels`) separa médico/paciente.
- **Persistência:** `api-gateway` (.NET) é o dono transacional — cifra e grava
  `consulta_transcricoes` (rascunho) e, na aprovação, `evolucoes_clinicas` (final).
- **Migration:** `0034_escriba_teleconsulta.sql`.

## Consequências

- Reduz drasticamente a burocracia pós-consulta (principal dor do psiquiatra) sem a IA decidir
  nada clínico.
- Quebra controlada do "nunca grava" do ADR-026 — mitigada por consentimento + descarte do áudio.
- Pendências: config de diarização/IAM no Transcribe; otimização de upload (S3 presigned direto
  do browser em vez de base64 via gateway) para áudios longos; revisão clínica do prompt factual.
- Fase 2 possível: legenda ao vivo (streaming Transcribe) e captura em consulta presencial
  (app grava o ambiente) — fora deste ADR.
