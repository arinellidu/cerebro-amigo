# ADR-031: Extensões da rede social — signup externo, foto, aprovação, presença

**Status:** Proposed (branch `feat/rede-extensoes`, via PR — não no main)
**Data:** 2026-06-05
**Decisores:** Equipe de engenharia + dono do produto
**Categoria:** Produto / Rede social

## Contexto

A rede social (ondas 0/2/4, ADR-030, trabalho paralelo) já tinha feed, perfil,
posts de texto, comentários, curtir, comunidades, seguir, chat DM (polling) e
moderação reativa (denúncias). O pedido pediu 4 coisas que faltavam: entrada de
médico **externo** (hoje só médico da plataforma entra), **foto no feed** estilo
Instagram, **aprovação de post pelo admin**, e **presença online**. (DM já existe.)

Trabalho feito em branch separada para não colidir com o Devin (que segue ativo no
mesmo `/rede`); merge via PR.

## Decisão

1. **Auth dupla, um só login.** Médico da plataforma entra com o login de sempre.
   Médico **externo** se auto-cadastra em `/rede/cadastro` → `POST
   /api/v1/auth/rede/signup` **valida o CRM no CFM** (reusa `CfmClient`/Infosimples,
   ADR-017): se Regular, cria `usuario(role='medico')` + `medico` + `social_perfis`
   e devolve o **mesmo** token de sessão. Daí em diante o login é o
   `/api/v1/auth/login` normal (interno = externo). `proxy.ts` libera `/rede/login`
   e `/rede/cadastro` como públicas; o resto de `/rede` exige sessão.

2. **Foto via S3 presigned.** `AWSSDK.S3` no gateway; bucket **privado**
   `S3_BUCKET_SOCIAL`. O navegador sobe a imagem **direto pro S3** (PUT presigned,
   `/rede/posts/foto-presign`); o binário não passa pelo gateway. Exibição por GET
   presigned curto (`/rede/midia/{key}`, só médico logado, restrito ao prefixo
   `posts/*`). Credenciais: IAM role (prod) / mount `~/.aws` (dev, override).

3. **Aprovação só de foto.** Post **com foto** nasce `status='pendente'` (endpoint
   `/rede/posts/com-foto`, separado do `/posts` de texto). O feed do Devin já filtra
   `status='ativo'`, então pendente fica escondido **sem editar o feed**. Moderador
   (`social_moderadores`) aprova/rejeita em `/rede/moderacao`. Post só-texto publica
   direto (inalterado). Reusa gate de CRM + guard de PII.

4. **Presença por heartbeat REST.** `social_presenca` (migration 0027); o cliente
   dá `POST /rede/presenca/ping` a cada 30s; "online" = ping < 60s
   (`GET /rede/presenca/online`). Widget "Online agora" na lateral direita +
   bolinha verde. **Sem SignalR** (evita expor o JWT ao client — o cookie é
   httpOnly; mesmo motivo do chat seguir em polling).

### clinical-safety

- Rede é **doctor-only**, segregada do dado clínico; **sem PII de paciente** (guard
  de CPF/telefone reusado nos posts com foto). Foto não é dado clínico, mas fica em
  bucket **privado** (GET presigned), não público.
- **CRM Regular** é o gate de quem cadastra e de quem posta/interage. Sem LLM.

## Consequências

- Migrations novas: **0027** (`social_presenca`). Sem migration p/ foto (reusa
  `social_posts.midias` + `status`).
- Gateway: `RedeAuthEndpoints`, `RedeFotoEndpoints`, `RedePostsExtraEndpoints`,
  `RedePresencaEndpoints` (+ `AWSSDK.S3`, `IAmazonS3`).
- Web: `/rede/login`, `/rede/cadastro`, `/rede/moderacao` + BFF + composer com
  upload + `PostCard` exibindo foto + `OnlineAgora` + heartbeat.
- **Colisão mínima com o Devin:** só edição **aditiva** no feed/PostDto/PostCard/
  composer (campo `midias`) — resolver no merge do PR.
- **Infra pendente (você cria):** bucket `cerebro-amigo-social` (sa-east-1, privado)
  com `s3:PutObject/GetObject` na role + **CORS** liberando `PUT` da origem web.
- **Futuro:** chat/presença realtime (resolver JWT-no-client p/ SignalR);
  compressão/recorte de imagem; verificação de e-mail no signup externo.
