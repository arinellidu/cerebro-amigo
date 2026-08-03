# Snippet para o CLAUDE.md / CONTEXT.md raiz do monorepo

Acrescentar a seção abaixo ao documento raiz do Cérebro Amigo, junto da lista de serviços:

---

## apps/checkup — Check-up Mental (:3001)

Triagem pública e gratuita de saúde mental (PHQ-9, GAD-7, ASRS-18) com devolutiva
por IA e relatório PDF. É o motor de aquisição do lançamento — SEO do lado paciente,
QR no PDF do lado médico. Regras completas em `apps/checkup/CLAUDE.md`.

Regras de fronteira (valem para qualquer trabalho no monorepo):

1. **Isolamento clínico ⇄ público.** `apps/checkup` não importa código de
   `gateway`, `orchestrator`, `agents` ou `notifier`, e nenhum serviço clínico
   importa nada do checkup. Compartilhamento permitido: apenas design tokens
   (paleta, fontes) e utilitários puros sem dados.
2. **Dados separados.** O checkup usa exclusivamente o schema `checkup` no RDS.
   Nunca criar FK entre schemas. Respostas de triagem jamais entram no prontuário.
3. **LLM**: Anthropic API direta (claude-haiku-4-5, chave por env via SSM Parameter Store). O checkup não passa pelo
   orchestrator.
4. **Tráfego**: o checkup é a única superfície pública anônima do sistema; mudanças
   de infra nele não podem aumentar o risco dos serviços clínicos (limites de
   memória/CPU no compose são obrigatórios).
