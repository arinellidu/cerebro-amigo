# ADR-026: Teleconsulta por vídeo — WebRTC P2P self-hosted

**Status:** Accepted
**Data:** 2026-06-04
**Decisores:** Equipe de engenharia + psiquiatra responsável clínico
**Categoria:** Produto / Arquitetura / Segurança clínica

## Contexto

A agenda (ADR-025) já agenda consultas `modalidade='teleconsulta'`, mas o
atendimento remoto não acontecia na plataforma — faltava o vídeo. Fechar o ciclo
**agendar → atender** dentro do produto é o item A2 do roadmap e habilita o
escriba (S3) e o desfecho (S1) depois.

Decisão de transporte de mídia entre três caminhos:

1. **WebRTC P2P self-hosted** — mídia E2E browser↔browser; nós só fazemos
   sinalização + um TURN para fallback de NAT.
2. **SaaS gerenciado** (Daily/Vonage/…) — rápido, mas a mídia clínica trafega na
   nuvem do provedor (provável fora do BR) → vira processador LGPD, exige DPA e
   custo por minuto. (Twilio Programmable Video foi descontinuado.)
3. **SFU self-hosted** (LiveKit/Jitsi) — dado no BR, mas o SFU relaya a mídia
   pelo nosso servidor (overkill para 1:1) e pesa na RAM já apertada da EC2.

## Decisão

**WebRTC P2P self-hosted.** A consulta é sempre **1:1** (médico↔paciente), então
o P2P é o ajuste natural e o de melhor LGPD: no caminho feliz a mídia vai direto
entre os dois navegadores (DTLS-SRTP) e **nunca toca nosso servidor** — nem o
banco, nem log. Também é o mais barato e o que menos pesa na EC2 (a mídia não
relaya por nós).

- **Sinalização — gateway .NET** (transacional, não-LLM). Transporte = **SSE
  (servidor→cliente) + POST (cliente→servidor)**, mesmo padrão de proxy do BFF
  já usado na conversa. Relay em memória (`TeleconsultaSignalingHub`, singleton)
  pareando os 2 peers por `consulta_id`. Repassa apenas `offer/answer/candidate/
  bye`; presença é gerada pelo servidor. **Nada de sinalização é persistido**
  (SDP/ICE contêm IP = PII) e logs trazem só metadados.
- **Papéis:** médico = *offerer* (cria a oferta ao ver o paciente online,
  inclusive em reconexão); paciente = *answerer*. Evita glare sem negociação
  perfeita.
- **NAT — coturn (TURN/STUN) self-hosted** na EC2 `sa-east-1`, esquema
  `use-auth-secret`. O gateway emite credencial **efêmera** por chamada
  (`username = expiraUnix:consultaId`, `credential = base64(HMAC-SHA1(TURN_SECRET,
  username))`) — nada de credencial fixa em banco/log; caduca sozinha. Sem TURN
  configurado, o gateway cai para **só STUN** (funciona na maioria das redes).
  coturn vai no `docker-compose` sob `profiles: ["turn"]` (ativar em prod com
  `COMPOSE_PROFILES=turn`); `network_mode: host` para o range de relay + IP
  público.
- **Sem gravação.** Nesta fase nenhum áudio/vídeo é gravado ou armazenado. A
  gravação fica para o escriba de consulta (S3), com consentimento e guard
  próprios.
- **Estado e auditoria** (migration `0021`): `consultas.video_status`
  (idle|aguardando|ativa|encerrada) + `video_iniciada_em/encerrada_em` (mutável);
  `consulta_video_eventos` **append-only** (entrou/saiu/encerrou) — prova de
  atendimento, sem conteúdo clínico.
- **UI:** componente único `SalaVideo` (médico em `/dashboard/consultas/{id}/
  teleconsulta`, paciente em `/p/consulta/{id}`). Entrada pela agenda/briefing do
  médico ("Iniciar" + copiar link do paciente) e pela agenda do paciente
  ("Entrar na consulta", liberado numa janela em torno do horário).

### clinical-safety

- **Regra #1 (IA não pratica medicina):** o transporte de vídeo não envolve LLM.
  Nenhuma sugestão/diagnóstico é gerado.
- **Regra #2 (crise):** inalterada — a chamada é humano↔humano (médico presente);
  o protocolo de crise segue no orchestrator. Texto de crise nunca por vídeo.
- **Regra #4 (LGPD categoria especial):** mídia E2E que não passa por terceiros
  nem por nós; **sem gravação**; sinalização não persistida; logs só com
  metadados; dado/relay ficam no BR (`sa-east-1`). Consentimento de teleconsulta
  (e o aviso "não gravada") é exibido **antes** de entrar na sala.
- **Tenant (1ª cláusula, revalidada em TODA chamada):** médico via JOIN
  `pacientes.medico_responsavel_id`; paciente via `paciente_id`. Só consultas
  `modalidade='teleconsulta'`. O hub pareia por `consulta_id` — apenas o médico
  responsável e o paciente dono entram na mesma sala.
- **Regra #5 (auditoria imutável):** `consulta_video_eventos` é append-only;
  nenhum código dá DELETE/UPDATE nela.

## Consequências

- Novas migrations: `0021_teleconsulta_video.sql`.
- Gateway: `TurnCredentialService`, `TeleconsultaSignalingHub` (singletons) e
  `TeleconsultaEndpoints` (entrar/encerrar/sinal, médico + paciente).
- BFF: `app/api/consultas/[id]/video/*` e `app/api/paciente/agenda/[id]/video/*`
  (+ helper `lib/teleconsulta-proxy.ts`); o cookie httpOnly autentica o SSE.
- Web: `components/video/SalaVideo.tsx` + rotas das salas + botões de entrada.
- Infra: serviço `coturn` (profile `turn`); novas vars `STUN_URLS`, `TURN_URLS`,
  `TURN_SECRET`, `TURN_TTL_SECONDS`, `TURN_REALM`, `TURN_EXTERNAL_IP`.
  Security group: UDP 3478, TCP 3478, UDP 49152-49251.
- O hub é só RAM: se o gateway reinicia, a chamada cai e os peers reconectam
  (o front trata). Aceitável para 1:1; não há estado de mídia a perder.
- **Fora deste ADR (futuro):** gravação para o escriba (S3); push "seu médico
  entrou" (notifier-py) — hoje o paciente vê "Entrar" no portal na janela da
  consulta e o médico pode copiar o link; TURN sobre TLS/443 para redes muito
  restritivas; "ativa" derivado de presença dos dois peers.
