# Cérebro Amigo · notifier-py

Substitui o job `disparar-checkins` do orchestrator Go. Roda como serviço
HTTP (porta 8083) com APScheduler interno que varre `checkins` pendentes
a cada N segundos e envia push VAPID para todas as `push_subscriptions`
ativas do paciente.

## Como funciona

```
                    cron N segundos
                          │
                          ▼
  SELECT checkins WHERE enviado_em IS NULL AND agendado_para <= NOW()
                          │
                          ▼
          SELECT push_subscriptions WHERE paciente_id = X
                          │
                          ▼
              webpush(VAPID) ──► browser provider
                          │
                ┌─────────┴─────────┐
                ▼                   ▼
            delivered             gone (410)
                │                   │
        ultimo_uso_em=NOW      revogada_em=NOW
                │                   │
                └───────────┬───────┘
                            ▼
            UPDATE checkins SET enviado_em = NOW
            INSERT notificacoes_medico (trilha)
```

## Endpoints

| Path | Descrição |
|---|---|
| `GET /health` | Liveness |
| `GET /ready` | Readiness (testa pool DB) |
| `POST /internal/checkins/dispatch` | Força tick manual |
| `POST /internal/checkins/dispatch-for-patient` | Tick para paciente específico |
| `POST /internal/push/test` | Push de teste para uma subscription |

Endpoints internos exigem `Authorization: Bearer ${INTERNAL_API_TOKEN}`.

## Texto fixo, não LLM

Mesmo padrão do `crisis_copy.py` do orchestrator: cada tipo de check-in
tem (título, corpo) versionados e hashados em `app/checkin_copy.py`.
Mudanças exigem PR (e idealmente revisão de UX/clínica).

Razões:
- **Determinismo**: push pode ser auditado e reproduzido exatamente
- **Latência**: sem ida ao LLM, dispatch fica abaixo de 1s
- **Custo**: milhares de pushes/dia sem custo de token
- **Privacidade**: texto não passa por terceiros

## Configuração VAPID

Em dev:

```bash
# Uma vez, gerar par de chaves (qualquer ferramenta web-push compatível)
# Ex.: https://web-push-codelab.glitch.me/
# Salvar em .env (gitignored):
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:contato@cerebroamigo.com.br
```

Em produção: Key Vault. O `VAPID_PUBLIC_KEY` precisa ser exposto também
ao frontend (PWA) para que o navegador possa registrar a subscription —
isso já estava no docker-compose original como `args:
NEXT_PUBLIC_VAPID_PUBLIC_KEY`.

## Idempotência e concorrência

`SELECT ... FOR UPDATE SKIP LOCKED` no dispatcher permite múltiplas
réplicas rodando simultaneamente sem duplicar envio. Em escala atual
(uma réplica) é over-engineering, mas a 5 linhas de código é grátis.

## Trilha de auditoria

Cada tentativa de push registra em `notificacoes_medico`:
- `tipo = 'push'`
- `severidade = 'info'` se entregue, `'baixa'` se nenhum device recebeu
- `metadata` inclui `checkin_id`, `copy_versao`, `copy_hash`, `entregue`

Médico vê no dashboard quantas tentativas houveram, quando, e se entregou.
