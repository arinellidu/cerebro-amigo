# ADR-049 — ASSIST com UX próprio no Check-up Mental

**Data:** 2026-06-13 · **Status:** Aceito · **Decisor:** Patrick (dono)

## Contexto

O ADR-048 adiou o ASSIST (triagem de uso de substâncias da OMS) por
incompatibilidade com o motor genérico: o instrumento é uma matriz por
substância com fluxo condicional, e encurtá-lo/parafraseá-lo é proibido.
O dono decidiu construir o UX necessário para lançá-lo (pedido de 2026-06-13).

## Decisão

1. **Módulo próprio** (`src/lib/scales/assist.ts`), fora do tipo `Scale`:
   Q1 (uso na vida, 10 classes, multi-seleção) → Q2–Q7 por substância →
   Q8 (injetáveis, global). Versão brasileira validada (Henrique et al., 2004;
   material SUPERA/SENAD-MS), com o nome da substância interpolado nas
   perguntas — mecânica de administração oficial, não paráfrase.
2. **Regras de pulo oficiais no fluxo** (`buildAssistPlan`, puro e testado):
   Q2 = "nunca" pula Q3–Q5 da substância; tabaco não tem Q5. Q8 não pontua —
   vira flag de atenção (uso injetável) no resultado e no PDF.
3. **Escore por substância** (SSI = Q2+Q3+Q4+Q5+Q6+Q7), cortes oficiais:
   álcool 0–10/11–26/27+; demais 0–3/4–26/27+ (baixo/moderado/alto risco).
   Resultado e PDF mostram a tabela por substância; a banda geral (pior faixa)
   alimenta consentimento/eventos.
4. **Devolutiva SEMPRE estática** (sem LLM) — uso de substâncias é tema
   sensível; textos por faixa revisados à mão em `fallbacks.ts`, com CAPS AD
   como caminho de cuidado e alerta de não interromper uso abruptamente.
5. **Sem campo de texto livre**: a opção "outras" da Q1 não coleta
   especificação (o produto não tem texto livre — LGPD/clinical-safety).
6. **Gate de validação**: `ASSIST_VALIDATED = false` até a conferência
   caractere a caractere contra a fonte (Henrique 2004 / "bloco ASSIST" do
   SUPERA) pelo responsável clínico; a rota `/teste/assist` mostra "Em breve".
   Landing `/drogas`, home, sitemap e smoke entram junto com o flip.
7. **Serialização do resultado** sem PII: `sub=substancia:escore,...` na query;
   faixas sempre recomputadas pelo motor (nunca confiadas da URL).

## Consequências

- O checkup passa a cobrir as 8 triagens pedidas pelo dono (7 escalas + ASSIST).
- DEBT CK-10 registra a pendência de conferência → flip → lançamento.
- O padrão "fluxo próprio" fica disponível para futuros instrumentos
  condicionais sem contorcer o motor genérico.
