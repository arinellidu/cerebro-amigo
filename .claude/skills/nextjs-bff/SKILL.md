---
name: nextjs-bff
description: >-
  Convenções do frontend e BFF do Cérebro Amigo V3 (apps/web, Next.js 16 + React 19
  + TypeScript + Tailwind 4 + shadcn/ui). Use ao criar ou alterar: página/rota do
  dashboard ou do portal do paciente (/p/*), Route Handler em app/api/* (o BFF),
  fluxo de login/sessão e cookies httpOnly, Server Component que busca dados do
  api-gateway, substituição de dados mock por fetch real, componente de UI, ou
  configuração de PWA/service worker/Web Push no cliente. Use também quando o
  pedido for "tira o mock e conecta no backend", "implementa o login de verdade"
  ou "monta o portal do paciente".
---

# Frontend + BFF — apps/web (Next.js 16)

Landing + dashboard médico + portal do paciente (PWA) + **BFF**. React 19, TS, Tailwind 4, shadcn/ui (style new-york, ícones lucide). **pnpm**, não npm.

## O BFF é a única ponte do front para o backend

O cliente **nunca** chama o api-gateway direto. Todo acesso passa por Route Handlers em `app/api/*`, que:

1. Leem o cookie httpOnly de sessão.
2. Chamam o `api-gateway` (`API_GATEWAY_URL`) com o JWT/credencial apropriada.
3. Devolvem só o necessário para a tela.

Dois cookies httpOnly, separados por público:
- `auth_token` → médico (dashboard).
- `paciente_token` → paciente (portal `/p/*`).

Nunca exponha token no client-side JS, em `localStorage` ou em props serializadas. Cookies httpOnly, `Secure`, `SameSite`.

## Estado atual: tudo é mock

As telas do `/dashboard/*` têm arrays hardcoded dentro de cada `page.tsx`, e `/login` só faz `<Link href="/dashboard">` (sem auth). A migração:

- Trocar arrays mock por fetch via BFF (Server Components quando possível, `fetch` para Route Handler).
- `/login` → `POST /api/auth/login` (BFF) → `POST /api/v1/auth/login` no gateway → set cookie httpOnly → redirect.
- Remover o mock só quando o endpoint real existir; não deixar tela meio-mock-meio-real sem marcar.

## Padrão de fetch (Server Component → BFF → gateway)

```ts
// app/api/pacientes/route.ts  (BFF)
export async function GET() {
  const token = (await cookies()).get("auth_token")?.value;
  if (!token) return new Response("Unauthorized", { status: 401 });
  const r = await fetch(`${process.env.API_GATEWAY_URL}/api/v1/pacientes`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  return new Response(await r.text(), { status: r.status });
}
```

`API_GATEWAY_URL`: dev `http://localhost:5050`; no docker `http://api-gateway:5000`.

## Conversa por SSE

A tela de mensagens consome um stream SSE. O BFF repassa o stream do gateway (que por sua vez faz proxy do orchestrator-py). Não bufferize a resposta inteira no Route Handler — repasse o `ReadableStream`.

## Portal do paciente /p/* (A FAZER)

Ainda não existe no v0. É **PWA**: `manifest`, service worker (`public/sw.js`), Web Push (VAPID — `NEXT_PUBLIC_VAPID_PUBLIC_KEY` no client; assinatura enviada ao notifier-py). Telas: humor, diário, medicações, check-ins, conversa SSE. Conteúdo destinado ao paciente segue os guardrails — ver skill `clinical-safety`.

## Conteúdo sensível

Texto que o paciente vê não é gerado livremente pelo front. Mensagens de crise/acolhimento vêm do backend (pré-aprovadas). O front renderiza; não inventa copy clínica.

## UI

- Tailwind 4 com os tokens do `app/globals.css` (paleta Cérebro Amigo: teal `#0D9488`, navy `#0F2137`, coral `#E57373`). Use as CSS vars, não hex solto novo.
- shadcn/ui já instalado em `components/ui/*`. Reutilize; não recrie primitivos.
- pt-BR em toda a interface.

## Não fazer

- Não chamar o gateway nem o LLM direto do client.
- Não usar `localStorage`/`sessionStorage` para token.
- Não reintroduzir Azure nem `ANTHROPIC_API_KEY` em env do front.
- Não deixar `npm`/`yarn` — o projeto é pnpm.
