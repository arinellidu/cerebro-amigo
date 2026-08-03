-- Migration 0058: expiração do link de teleconsulta (ADR-026 — botão "Finalizar")
-- O médico finaliza a teleconsulta a partir da agenda. Para não cancelar a sessão
-- por engano (misclick / reconexão), a expiração é com GRAÇA, nunca imediata:
--
--   • Finalização manual  → link válido até NOW() + 15 min (no momento do clique).
--   • Sem clique (fallback)→ cap implícito de 120 min após o FIM PREVISTO da
--     consulta (inicia_em + duracao_min). Ancorado na AGENDA, não no vídeo —
--     entrar/sair sem querer NÃO inicia a contagem (pode ter sido engano/atraso).
--   • "Sempre o menor": clicar só pode ENCURTAR, nunca estender além do cap.
--
-- O cap dos 120 min é calculado on-the-fly no gateway (inicia_em + duracao_min),
-- então só precisamos persistir o instante escolhido na finalização manual.
-- NULL = nunca finalizado manualmente → vale só o cap implícito.
--
-- Efeito de "expirado": o gateway recusa /entrar (HTTP 410); quem já está na
-- chamada continua (a expiração só bloqueia REENTRADA). Coluna MUTÁVEL de estado
-- operacional — não é trilha de auditoria.
-- Aplicar: psql $POSTGRES_DSN_URL -f infra/migrations/0058_teleconsulta_link_expira.sql

ALTER TABLE consultas
    ADD COLUMN IF NOT EXISTS video_link_expira_em TIMESTAMPTZ;
