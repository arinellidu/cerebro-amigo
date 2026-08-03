/** Rótulos de compartilhamento por escala — sem PII, sem escore/faixa. */
const SHARE_BY_SCALE: Record<string, { title: string; eyebrow: string }> = {
  phq9: { eyebrow: "Check-up Mental", title: "Fiz meu check-up de depressão" },
  gad7: { eyebrow: "Check-up Mental", title: "Fiz meu check-up de ansiedade" },
  asrs18: { eyebrow: "Check-up Mental", title: "Fiz meu check-up de TDAH" },
  audit: { eyebrow: "Check-up Mental", title: "Fiz meu check-up de álcool" },
  mdq: { eyebrow: "Check-up Mental", title: "Fiz meu check-up de bipolaridade" },
  fagerstrom: { eyebrow: "Check-up Mental", title: "Fiz meu check-up de tabagismo" },
  msi_bpd: { eyebrow: "Check-up Mental", title: "Fiz meu check-up de saúde mental" },
  assist: { eyebrow: "Check-up Mental", title: "Fiz meu check-up de substâncias" },
};

const DEFAULT_SHARE = {
  eyebrow: "Check-up Mental",
  title: "Fiz meu check-up mental",
};

export function getResultShareMeta(scaleId?: string | null) {
  const key = scaleId?.trim().toLowerCase() ?? "";
  const share = SHARE_BY_SCALE[key] ?? DEFAULT_SHARE;
  return {
    title: share.title,
    description:
      "Triagem gratuita e anônima com instrumentos clínicos validados. Faça o seu também.",
    ogAlt: `${share.title} — Check-up Mental gratuito`,
    eyebrow: share.eyebrow,
  };
}
