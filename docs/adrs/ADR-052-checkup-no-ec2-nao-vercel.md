# ADR-052 — Check-up roda no EC2 (não na Vercel): quem conecta direto no RDS vive na VPC

Status: Aceito · Data: 2026-06-11 · Escopo: `apps/checkup`, topologia de deploy · Relaciona: ADR-042 (RLS de tenant), `apps/checkup/CLAUDE.md` (isolamento), ADR-044 (Anthropic API)

## Contexto

O `apps/web` (site + dashboard médico + portal do paciente + BFF) roda na **Vercel**
(`www.cerebroamigo.com.br`). Ao lançar o `apps/checkup`, a intuição inicial foi hospedá-lo
também na Vercel (CDN/edge, bom para o SEO que é a função de aquisição do checkup). Um
smoke E2E em produção mostrou que **a Vercel não persiste nada no banco**: eventos de funil
retornavam `{ok:true}` mas gravavam zero linhas.

Diagnóstico: o RDS (`sa-east-1`, dentro da VPC) tem um security group que libera a porta
5432 **apenas** para os security groups das instâncias EC2 + um IP de admin. A Vercel roda
as funções de `us-east` com **IPs de egress dinâmicos** (sem IP fixo no plano padrão), então
não há o que liberar no SG sem abrir o RDS para `0.0.0.0/0`. Some-se a isso `rds.force_ssl=1`
e a residência de dado no Brasil (LGPD, dado clínico-adjacente).

A pergunta-chave que esclareceu tudo: **se a Vercel não alcança o RDS, por que o `apps/web`
funciona na Vercel?** Porque **o web não conecta no banco**. A diferença é arquitetural:

- **`apps/web` (Vercel):** o BFF (`app/api/*`) faz **HTTPS de saída** para o `api-gateway`
  (.NET, no EC2, dentro do SG); o gateway é quem fala com o RDS. A Vercel só faz chamadas
  HTTPS outbound — permitidas de qualquer IP. Nunca abre TCP 5432.
- **`apps/checkup` (Vercel):** por desenho de isolamento (`checkup/CLAUDE.md`: não importa
  código do gateway, schema `checkup` próprio acessado direto via Drizzle), ele conecta
  **direto** no RDS na 5432 → barrado pelo SG.

Ou seja: a **regra de isolamento do checkup** (não passar pelo gateway) é justamente o que o
torna incompatível com a Vercel. O web escapa porque delega todo o transacional ao gateway.

## Decisão

**Qualquer superfície que conecte direto no RDS (TCP 5432) roda dentro da VPC — no EC2.**
Superfícies na Vercel devem ser stateless ou acessar dado apenas via HTTPS para o
`api-gateway` (que está na VPC, no SG).

Concretamente:

- **`apps/checkup` roda no EC2** como 6º serviço do `docker-compose` (porta `:3001`), atrás
  do Caddy (`checkup.cerebroamigo.com.br` → A para o IP do EC2, TLS Let's Encrypt). Está na
  VPC/SG, alcança o RDS, e o dado fica no Brasil. O projeto Vercel do checkup foi **deletado**.
- **`apps/web` permanece na Vercel** — é frontend + BFF que faz proxy de tudo transacional
  para o gateway via HTTPS; não precisa (e não deve) conectar no banco diretamente.

Correções acopladas, necessárias independentemente de onde o checkup roda:

- **SSL obrigatório:** `rds.force_ssl=1`; o client do checkup (postgres.js) passou a usar
  `ssl: "require"` (cifra; não valida CA — mesma classe do DEBT T1-4).
- **DNS:** a zona de `cerebroamigo.com.br` é gerida na **Vercel** (NS = `vercel-dns.com`),
  não no Registro.br — o record do `checkup` foi trocado lá (CNAME→Vercel removido, A→EC2).

## Alternativas consideradas e rejeitadas

- **Abrir o SG do RDS para `0.0.0.0/0`.** Rejeitada: expõe um banco de saúde mental (LGPD
  categoria especial) à internet. Inaceitável.
- **IP de egress dedicado na Vercel + liberar no SG.** Rejeitada por ora: add-on pago, e as
  funções continuam em `us-east` — dado de triagem transitaria nos EUA (atrito de residência)
  e cada query paga latência cross-region `us↔sa`.
- **Endpoint de ingestão no EC2 que o checkup-na-Vercel chamaria via HTTPS.** Rejeitada:
  acopla parcialmente o checkup ao EC2, cria nova superfície/auth, e contraria a simplicidade
  de o checkup ser autocontido.
- **Migrar o banco do checkup para um Postgres gerenciado acessível da Vercel (Neon/Supabase US).**
  Rejeitada: quebra a residência de dado no Brasil.

## Consequências

- **Positivas:** checkup persiste eventos/consentimento/e-mail; residência de dado no Brasil;
  isolamento de rede pelo SG; um único caminho de deploy (compose no EC2, mesmo fluxo SSM dos
  demais serviços). Princípio claro para superfícies futuras.
- **Tradeoffs:** o checkup perde CDN/edge da Vercel (mitigável com Caddy/cache e, no futuro,
  CloudFront na frente do EC2 se o SEO exigir). Mais um serviço no `docker-compose` do EC2
  (com `mem_limit`/`cpus` apertados, já previstos, para não pressionar os serviços clínicos).
- **Regra herdada:** o que vale para o checkup vale para qualquer superfície nova — conexão
  direta a banco ⇒ VPC/EC2; senão, Vercel + proxy via gateway.

## Gatilhos de revisão

- O checkup passar a acessar dado **via gateway** (HTTPS) em vez de Drizzle direto → poderia
  voltar para a Vercel sem violar esta decisão.
- Vercel oferecer **egress estático acessível + residência de dado no Brasil** → reavaliar.
- Mudança na topologia de rede do RDS (ex.: RDS Proxy, PrivateLink, VPC peering) que torne o
  acesso de fora da VPC seguro e in-region → reavaliar.
