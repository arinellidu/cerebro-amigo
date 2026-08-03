# ADR-075 — Escriba presencial (Ambient Scribe em consulta presencial)

Status: Aceito · Data: 2026-07-01 · Estende: ADR-040 (Escriba na teleconsulta) · Revisa: ADR-018 (cifragem), ADR-059 (gate Master)

## Contexto

O Escriba (ADR-040) transforma o áudio da consulta num rascunho factual para o médico
revisar/aprovar. Mas ele só funciona na **teleconsulta**: a captura está acoplada à
videochamada (`SalaVideo`, WebRTC). A maioria das consultas de psiquiatria é **presencial**
(médico + paciente na mesma sala), e nelas o Escriba hoje é inutilizável — justamente o
caso que dá nome a "*Ambient* Scribe".

Reusar a pipeline já pronta (Amazon Transcribe diarizado → rascunho factual Claude → revisão
→ `evolucoes_clinicas` append-only) e adicionar só a **superfície de captura presencial**.

## Decisão

Habilitar o Escriba na consulta presencial, reaproveitando ~90% do backend. Três mudanças
de fronteira:

### 1. Consentimento presencial = médico atesta consentimento verbal

Na teleconsulta o paciente consente na sua própria sessão (checkbox no lobby). No presencial
o paciente **não tem sessão num device próprio**. Decisão do produto: o **médico atesta** que
o paciente **consentiu verbalmente**, registrado em `consultas`:
`escriba_consentido_metodo = 'verbal_atestado'` + `escriba_consentido_em = NOW()` (migration 0060).

- Novo endpoint médico `POST /api/v1/consultas/{id}/escriba/consentir-presencial` (body `{atestado:true}`).
- **Trade-off assumido:** é evidência de consentimento **afirmada pelo médico**, mais fraca que
  a ação direta do titular. O médico é responsável por obter o consentimento verbal informado
  (LGPD Art. 11). O paciente mantém o direito de **revogar**. A UI exige um checkbox explícito
  ("O paciente consentiu verbalmente…") antes de liberar a gravação — não é silencioso.

### 2. Upload presigned direto no S3 (resolve DEBT TC-3)

Consulta presencial é longa; o upload base64 via gateway (cap 25 MB) não serve. O browser
sobe o áudio **direto para o bucket efêmero** via presigned PUT (mesmo padrão de
`mensagens_audio` / ADR-064):

- `POST /api/v1/consultas/{id}/escriba/upload-url` → `{uploadUrl, s3Key}` (key `escriba/{pacienteId}/{uuid}.ext`).
- `POST /api/v1/consultas/{id}/escriba` passa a aceitar `{s3Key}` (além do `{audioBase64}` da teleconsulta);
  valida o prefixo da key (anti-forja) e o consentimento.
- agents-py `/internal/escriba/transcrever` aceita `s3_key` (transcreve a chave já existente,
  deleta no `finally` — o áudio **nunca persiste**, mesma invariante LGPD do ADR-040).

### 3. Transcrição assíncrona (fila + worker no gateway)

Transcrever uma consulta de 30-50 min leva minutos; uma request HTTP síncrona morreria no
idle-timeout do ALB (~60s). Então o presencial é **assíncrono**:

- O `POST /escriba` insere `consulta_transcricoes` com `status='processando'`, **enfileira** um
  job e responde `202` na hora.
- Um `BackgroundService` (`EscribaJobWorker`) consome a fila, chama o agents-py, **cifra**
  (ADR-018) e atualiza a linha para `'rascunho'` (ou `'erro'`). Como roda fora do request scope,
  seta `app.current_medico` tx-local para passar na RLS (0037).
- O front faz **polling** na página de revisão (que já existe) enquanto `status='processando'`.

## Guardrails clínicos (clinical-safety) — inalterados

- Rascunho continua **factual** (mesmo prompt/schema; Regra 1 — sem diagnóstico/CID/conduta).
- `mencao_risco` segue flag **doctor-facing**; presencial **não** aciona protocolo de crise
  patient-facing (Regra 2) — o médico está na consulta.
- Nada vira evolução sem aprovação do médico (Regra 3); áudio efêmero + cifrado (Regra 4);
  `evolucoes_clinicas` append-only (Regra 5). Tenant por `pacientes.medico_responsavel_id`.
- Feature **Master** (`FeatureKeys.Escriba`, ADR-059) em todos os endpoints novos.

## Consequências

- Desbloqueia o Escriba para a maioria das consultas de psiquiatria (presencial).
- Fecha DEBT **TC-3** (upload presigned) para o caminho presencial.

### Limitações conhecidas

- **Fila in-process (não durável):** se o gateway reiniciar com um job em voo, ele se perde.
  Rede de segurança: o GET `/escriba` faz **sweep** — após 15 min preso em `'processando'`,
  marca `'erro'` e o médico regrava. Suficiente para o piloto; evoluir para fila durável
  (SQS ou tabela de jobs) se o volume justificar.
- `transcribe_timeout_s` subiu para 600s (env `TRANSCRIBE_TIMEOUT_S`) para caber consulta longa.
- Teleconsulta segue base64 síncrono (clipes curtos, dentro de 25 MB) — sem mudança.
