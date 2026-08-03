-- Migration 0045: prazo de pagamento da assinatura (ADR-055 — fim do trial).
--
-- Substitui o "trial de 30 dias" por um PRAZO DE PAGAMENTO curto: a assinatura
-- nasce status='pendente' e o médico tem alguns dias (default 5) para acertar a
-- cobrança; vencido sem pagamento confirmado, entra no paywall (gate em fase
-- seguinte). Aditivo e idempotente. A coluna `status` não tem CHECK (só
-- comentário) → 'pendente' é aceito sem alterar constraint. `trial_ate` fica
-- deprecado para linhas novas (mantido para histórico/legado).

ALTER TABLE assinaturas
  ADD COLUMN IF NOT EXISTS prazo_pagamento_ate TIMESTAMPTZ;

COMMENT ON COLUMN assinaturas.prazo_pagamento_ate IS
  'ADR-055: ate quando o medico (status=pendente) tem acesso para acertar o pagamento. Vencido sem pagamento confirmado -> paywall. Substitui o trial_ate de 30 dias.';
