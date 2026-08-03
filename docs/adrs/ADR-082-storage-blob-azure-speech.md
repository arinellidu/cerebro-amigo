# ADR-082 — Arquivos no Azure Blob e transcrição no Azure AI Speech

- **Status:** aceito (2026-07-26)
- **Decisor:** Patrick Arinelli
- **Escopo:** storage de objetos (documentos, foto, áudios) e speech-to-text
- **Complementa:** ADR-080 (runtime do portfólio Vercel + Azure)
- **Substitui a implementação de:** S3 presigned (ADR-064/066/075) e Amazon
  Transcribe (diário de voz e escriba). As decisões de **produto** desses ADRs
  (fluxos, consentimento, efemeridade, guardrails) permanecem intactas.
- **Não altera:** ADR-018 (cifragem), ADR-044 (LLM via Anthropic), ADR-042 (RLS)

## Contexto

O ADR-080 moveu o runtime público para Vercel + Azure, mas as features de
arquivo (cofre de documentos, foto do médico, mensagens de áudio, escriba) e a
transcrição (diário de voz, escriba) continuavam implementadas sobre S3 +
Amazon Transcribe — inertes no portfólio (sem credenciais AWS) e contando uma
história incoerente com o README ("roda no Azure, mas o código fala AWS").
Transcribe só lê de S3, então migrar storage sem migrar o motor de STT não
fecharia a conta.

## Decisão

1. **Storage de objetos: Azure Blob Storage** (conta do `foundation.bicep`).
   O gateway assina **SAS de curta duração** (`BlobStoragePresigner`) — PUT de
   upload e GET de download/playback direto do browser; o binário continua
   nunca passando pelo gateway. Containers: `documentos-demo` (docs + foto),
   `audio-mensagens` (lifecycle 60d), `audio-efemero` (lifecycle 1d).
2. **Speech-to-text: Azure AI Speech — fast transcription** (REST síncrono,
   `api-version=2024-11-15`, pt-BR, diarização com 2 locutores no escriba).
   Sem job + polling: o áudio vai multipart na própria request.
   - **Diário de voz e teleconsulta:** os bytes vão do gateway ao agents-py e
     direto ao Speech — **o áudio não toca storage em momento algum** (melhor
     que o desenho anterior, que exigia S3 efêmero porque o Transcribe só lia
     de S3).
   - **Escriba presencial:** browser sobe ao container efêmero via SAS; o
     agents-py baixa, transcreve e **deleta no finally** (invariante LGPD
     preservada; lifecycle 1d é a rede de segurança).
   - Região do Speech: `eastus` (fast transcription não está em toda região;
     latência até `eastus2` é desprezível). Parâmetro `speechLocation`.
3. **Nomes de wire e de banco preservados.** Os campos JSON `s3Key`/`s3_key`,
   a coluna `mensagens_audio.s3_key`/`medicos.foto_s3key` e o campo interno
   gateway→agents-py continuam com o nome legado — hoje significam "chave do
   objeto no storage". Renomear atravessaria 15+ pontos (records, BFF,
   componentes, DB) sem ganho funcional; fica como limpeza cosmética futura.
4. **Autenticação do storage: connection string (account key) via Key Vault**
   (`storage-connection-string`), com `allowSharedKeyAccess: true` na conta.
   Trade-off consciente para o portfólio: SAS por account key é simples e
   igual em dev/prod. Evolução registrada: user delegation SAS via Managed
   Identity (o RBAC `Storage Blob Data Contributor` da identity já existe).
5. **AWS restante no runtime:** somente embeddings/RAG via Bedrock (ADR-028),
   desligados no portfólio (`EMBEDDINGS_ENABLED=false`) — rastreado como
   DEBT T1-10. O caminho LLM Bedrock segue suspenso atrás de `LLM_PROVIDER`
   (ADR-044). Buckets S3 e scripts `infra/aws/` viram histórico.

## Consequências

- O código volta a contar a mesma história que o README/ADR-080: request path
  100% Vercel + Azure (+ Anthropic API).
- As features de arquivo/áudio ficam **funcionais no portfólio** (antes eram
  inertes sem credenciais AWS).
- Browser precisa do header `x-ms-blob-type: BlockBlob` no PUT (feito nos 4
  componentes de upload) e o Blob precisa de CORS para a origem do web
  (`foundation.bicep`). A CSP do `apps/web` aponta para a origem do blob via
  `NEXT_PUBLIC_BLOB_ORIGIN`.
- A SAS não impõe Content-Type nem tamanho no upload (o presign do S3 impunha
  content-type): DEBT T1-8 atualizado com o caminho (validação pós-upload).
- Novos segredos: `storage-connection-string` e `speech-key` (Key Vault);
  novas envs: `AZURE_STORAGE_CONNECTION_STRING`, `AZURE_SPEECH_KEY`,
  `AZURE_SPEECH_REGION`, `BLOB_CONTAINER_*`, `NEXT_PUBLIC_BLOB_ORIGIN`.
  `S3_BUCKET_*`, `AWS_REGION` (gateway) e `TRANSCRIBE_POLL_INTERVAL_S`
  deixam de existir no runtime.
- Testes: pipeline do escriba/diário re-coberto (18 testes) preservando as
  invariantes — delete no finally, transcrição vazia não chama LLM, guardrails
  do prompt, diarização Locutor 1/2, e erro HTTP do Speech nunca ecoa corpo
  de resposta em exceção/log.

## Rollback

`git revert` do commit desta migração restaura S3 + Transcribe (exige
credenciais AWS válidas — no portfólio Azure isso significa voltar a features
inertes). Os buckets antigos não foram tocados por esta mudança.
