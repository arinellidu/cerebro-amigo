# ADR-064: Mensagens de Áudio do Paciente para o Médico

**Status:** Implementado  
**Data:** 2026-06-18  
**Decisores:** Patrick Arinelli  
**Categoria:** Produto / LGPD

## Contexto

Entre consultas, o paciente pode querer comunicar algo ao médico além do texto da conversa
(tom de voz, cansaço, choro, urgência não-verbal). Uma gravação curta transmite afeto e contexto
clínico que o texto não captura. O médico, ao ouvir o áudio, percebe nuances que nenhuma
transcrição preservaria.

## Decisão

Implementar mensagens de áudio assíncronas paciente → médico com:

- **Consentimento explícito** antes do primeiro uso (LGPD — dado de saúde mental, categoria especial).
- **Upload direto ao S3** via presigned PUT (sem trafegar áudio pelo gateway — reduz latência e custo).
- **Playback via presigned GET** (1h de validade) — URL nunca permanente.
- **Retenção de 60 dias** no S3 (lifecycle policy) e `expira_em` no DB.
- **Sem transcrição automática** — áudio vai direto ao médico, sem LLM no caminho (clinical-safety R1).
- **RLS** na tabela `mensagens_audio` via `medico_id` (mesmo padrão de `notificacoes_medico`).

## Arquitetura

```
Paciente (browser)
  → POST /api/paciente/audio/upload-url (BFF)
      → Gateway: presigned PUT (15min)
  → PUT direto ao S3 cerebro-amigo-audio-msgs
  → POST /api/paciente/audio (BFF)
      → Gateway: INSERT mensagens_audio

Médico (dashboard)
  → GET /api/prontuario/[id]/audio (BFF)
      → Gateway: SELECT mensagens_audio + RLS
  → GET /api/prontuario/[id]/audio/[audioId]/play-url (BFF)
      → Gateway: presigned GET (1h)
  → PATCH /api/prontuario/[id]/audio/[audioId]/ouvido (BFF)
      → Gateway: UPDATE ouvido_em
```

## Bucket S3

- Nome: `cerebro-amigo-audio-msgs`
- Região: `sa-east-1` (LGPD — dado clínico no Brasil)
- Acesso: privado (sem ACL pública)
- Cifragem: SSE-S3 (AES-256)
- Lifecycle: `Expiration.Days = 60`
- IAM: role `EC2-SSM-CerebroAmigo` → `s3:PutObject,GetObject,DeleteObject`

## Migration

`0050_mensagens_audio.sql`:
- `ALTER TABLE pacientes ADD COLUMN consentimento_audio BOOLEAN DEFAULT FALSE`
- `CREATE TABLE mensagens_audio (id, paciente_id, medico_id, s3_key, duracao_s, ouvido_em, criada_em, expira_em GENERATED ALWAYS AS criada_em + 60d)`
- RLS idêntico ao de `notificacoes_medico`

## Env vars

- `S3_BUCKET_AUDIO_MSGS=cerebro-amigo-audio-msgs` (gateway + EC2 compose)

## Consequências

- Médico acessa nuances clínicas não capturáveis em texto.
- Áudio nunca passa pelo gateway (latência e custo controlados).
- Consentimento explícito e retenção limitada satisfazem LGPD categoria especial.
- Sem transcrição: sem risco de IA interpretar dado clínico sem revisão humana (R1).
- `expira_em` gerado automaticamente: sem job de limpeza de DB necessário; S3 lifecycle cuida do armazenamento.

## Relacionado

- ADR-018 (cifragem em repouso) — bucket usa SSE-S3; futura evolução: SSE-KMS CMK.
- ADR-042 (RLS multi-tenant) — `mensagens_audio` segue o padrão.
- Clinical-safety R1 (IA não pratica medicina) — sem LLM no caminho do áudio.
