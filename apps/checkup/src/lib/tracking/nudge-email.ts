/**
 * Template FIXO do lembrete de re-rastreio (ADR-050 Parte 2, Fase 3).
 * Cérebro Amigo — https://www.cerebroamigo.com.br
 *
 * clinical-safety: SEM LLM, SEM conteúdo clínico, SEM o escore. Só o convite a refazer
 * + os links (evolução, cancelar lembretes, apagar dados). Triagem nunca é diagnóstico —
 * o único uso da palavra "diagnóstico" é no aviso de que isto NÃO é um.
 */

export interface NudgeLinks {
  evolucao: string;
  cancelar: string;
  apagar: string;
}

export function buildNudgeLinks(siteUrl: string, seriesToken: string): NudgeLinks {
  const base = siteUrl.replace(/\/$/, "");
  const t = encodeURIComponent(seriesToken);
  return {
    evolucao: `${base}/evolucao?t=${t}`,
    cancelar: `${base}/api/tracking/unsubscribe?t=${t}`,
    apagar: `${base}/descadastrar?t=${t}`,
  };
}

export function buildNudgeEmail(links: NudgeLinks): { subject: string; text: string } {
  const subject = "Que tal refazer seu Check-up Mental?";
  const text =
    "Olá!\n\n" +
    "Faz cerca de 14 dias que você fez um Check-up Mental. Acompanhar como as coisas " +
    "mudam com o tempo ajuda você e o seu médico a enxergar o quadro com mais clareza.\n\n" +
    `Refazer e ver sua evolução: ${links.evolucao}\n\n` +
    "Lembrando: é um instrumento de triagem, não um diagnóstico. Leve seus resultados " +
    "ao seu médico ou psicólogo para uma avaliação completa.\n\n" +
    "Se precisar de apoio agora: CVV 188 (24h) · cvv.org.br\n\n" +
    `Não quer mais estes lembretes? Cancelar: ${links.cancelar}\n` +
    `Apagar meus dados de acompanhamento: ${links.apagar}\n\n` +
    "— Check-up Mental · Cérebro Amigo · https://www.cerebroamigo.com.br\n";
  return { subject, text };
}
