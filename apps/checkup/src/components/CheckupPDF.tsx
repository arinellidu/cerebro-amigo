import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Link,
  Image,
} from "@react-pdf/renderer";
import { BRAND_LOGO_PNG } from "@/lib/brand-logo";
import { decodeAssistResult } from "@/lib/scales/assist";

const SCALE_NAMES: Record<string, string> = {
  phq9: "PHQ-9 — Triagem de Depressão",
  gad7: "GAD-7 — Triagem de Ansiedade Generalizada",
  asrs18: "ASRS-18 — Triagem de TDAH (adulto)",
  audit: "AUDIT — Triagem de Uso de Álcool (OMS)",
  mdq: "MDQ — Triagem de Transtorno Bipolar",
  fagerstrom: "Teste de Fagerström — Dependência de Nicotina",
  msi_bpd: "MSI-BPD — Triagem de Traços Borderline",
  assist: "ASSIST — Triagem de Uso de Substâncias (OMS)",
};

// Escore máximo possível por instrumento (fato aritmético, não interpretação).
const SCALE_MAX: Record<string, number> = {
  phq9: 27,
  gad7: 21,
  asrs18: 72,
  audit: 40,
  mdq: 13,
  fagerstrom: 10,
  msi_bpd: 10,
  assist: 39,
};

const SCALE_TIMEFRAME: Record<string, string> = {
  phq9: "últimas 2 semanas",
  gad7: "últimas 2 semanas",
  asrs18: "últimos 6 meses",
  audit: "últimos 12 meses",
  mdq: "ao longo da vida",
  fagerstrom: "hábito atual",
  msi_bpd: "padrões ao longo da vida adulta",
  assist: "últimos 3 meses",
};

// Cores da faixa (impressão clara; tons suaves, sem alarme visual).
const BAND_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  minimal: { bg: "#ECFDF5", border: "#A7F3D0", text: "#065F46" },
  mild: { bg: "#FFFBEB", border: "#FDE68A", text: "#92400E" },
  moderate: { bg: "#FFF7ED", border: "#FED7AA", text: "#9A3412" },
  moderately_severe: { bg: "#FEF2F2", border: "#FECACA", text: "#991B1B" },
  severe: { bg: "#FEF2F2", border: "#FCA5A5", text: "#7F1D1D" },
  crisis: { bg: "#F1F5F9", border: "#CBD5E1", text: "#334155" },
  informative: { bg: "#F1F5F9", border: "#CBD5E1", text: "#334155" },
  // AUDIT (zonas OMS)
  low_risk: { bg: "#ECFDF5", border: "#A7F3D0", text: "#065F46" },
  risky_use: { bg: "#FFFBEB", border: "#FDE68A", text: "#92400E" },
  harmful_use: { bg: "#FFF7ED", border: "#FED7AA", text: "#9A3412" },
  probable_dependence: { bg: "#FEF2F2", border: "#FCA5A5", text: "#7F1D1D" },
  // Fagerström
  very_low: { bg: "#ECFDF5", border: "#A7F3D0", text: "#065F46" },
  low: { bg: "#ECFDF5", border: "#A7F3D0", text: "#065F46" },
  medium: { bg: "#FFFBEB", border: "#FDE68A", text: "#92400E" },
  high: { bg: "#FFF7ED", border: "#FED7AA", text: "#9A3412" },
  very_high: { bg: "#FEF2F2", border: "#FCA5A5", text: "#7F1D1D" },
  // MDQ
  negative: { bg: "#ECFDF5", border: "#A7F3D0", text: "#065F46" },
  positive: { bg: "#FFF7ED", border: "#FED7AA", text: "#9A3412" },
  // ASSIST
  moderate_risk: { bg: "#FFFBEB", border: "#FDE68A", text: "#92400E" },
  high_risk: { bg: "#FEF2F2", border: "#FCA5A5", text: "#7F1D1D" },
};

const CRISIS_RESOURCES = [
  "CVV — 188 (24h, gratuito) | chat: cvv.org.br",
  "SAMU — 192 (emergência)",
  "CAPS ou pronto-socorro mais próximo",
];

// Landing do médico = /medico (singular). www direto evita o hop apex->www no QR escaneado.
// src=checkup + rid permitem atribuição (qr_scanned / médicos por 1000 testes) sem identificar o paciente.
export function buildQrUrl(rid: string) {
  return `https://www.cerebroamigo.com.br/medico?src=checkup&rid=${rid}`;
}

const PURPLE = "#5E4B8B";
const NAVY = "#0F2137";
const SLATE = "#64748B";

const styles = StyleSheet.create({
  page: { fontFamily: "Helvetica", padding: 48, fontSize: 10, color: NAVY },

  /* Header */
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  brandRow: { flexDirection: "row", alignItems: "center" },
  brandLogo: { width: 24, height: 24, marginRight: 7 },
  brand: { fontSize: 9, fontFamily: "Helvetica-Bold", color: PURPLE, textTransform: "uppercase", letterSpacing: 1 },
  date: { fontSize: 8, color: SLATE },
  title: { fontSize: 19, fontFamily: "Helvetica-Bold", marginBottom: 12 },
  rule: { flexDirection: "row", marginBottom: 18 },
  rulePurple: { height: 3, flex: 1, backgroundColor: PURPLE, borderRadius: 2 },
  ruleCoral: { height: 3, width: 42, backgroundColor: "#E57373", borderRadius: 2, marginLeft: 4 },

  /* Caixas utilitárias */
  disclaimer: {
    backgroundColor: "#EFEAF6",
    borderRadius: 6,
    padding: 10,
    marginBottom: 16,
    fontSize: 9,
    color: "#4A3A70",
    lineHeight: 1.4,
  },
  crisisBox: {
    backgroundColor: "#FEF2F2",
    border: "1 solid #FECACA",
    borderRadius: 6,
    padding: 12,
    marginBottom: 16,
  },
  crisisTitle: { fontSize: 11, fontFamily: "Helvetica-Bold", color: "#7F1D1D", marginBottom: 6 },
  crisisItem: { fontSize: 9, color: "#991B1B", marginBottom: 3 },

  sectionTitle: { fontSize: 9, fontFamily: "Helvetica-Bold", color: PURPLE, marginBottom: 7, textTransform: "uppercase", letterSpacing: 0.5 },

  /* Hero do resultado */
  hero: {
    flexDirection: "row",
    alignItems: "center",
    border: "1 solid #E2E8F0",
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    backgroundColor: "#FCFCFD",
  },
  heroScoreBlock: { width: 110, alignItems: "center" },
  heroScore: { fontSize: 30, fontFamily: "Helvetica-Bold", color: NAVY },
  heroScoreMax: { fontSize: 9, color: SLATE, marginTop: 2 },
  heroDivider: { width: 1, alignSelf: "stretch", backgroundColor: "#E2E8F0", marginHorizontal: 16 },
  heroRight: { flex: 1 },
  bandChip: {
    alignSelf: "flex-start",
    borderRadius: 10,
    paddingVertical: 4,
    paddingHorizontal: 10,
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    marginBottom: 6,
  },
  heroMeta: { fontSize: 9, color: SLATE, marginBottom: 2 },

  /* Tabela de detalhes */
  table: { border: "1 solid #E2E8F0", borderRadius: 6, marginBottom: 16 },
  row: { flexDirection: "row", borderBottom: "1 solid #F1F5F9", padding: "7 12" },
  rowLast: { flexDirection: "row", padding: "7 12" },
  cellLabel: { flex: 1, fontSize: 9, color: SLATE },
  cellValue: { flex: 2, fontSize: 9, fontFamily: "Helvetica-Bold" },

  /* Sobre o Cérebro Amigo */
  aboutBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8F7FB",
    border: "1 solid #E7E2F2",
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  aboutLogo: { width: 30, height: 30, marginRight: 10 },
  aboutText: { flex: 1, fontSize: 8.5, color: "#4A3A70", lineHeight: 1.45 },
  aboutLink: { color: PURPLE, textDecoration: "none", fontFamily: "Helvetica-Bold" },

  /* Para seu médico (QR) */
  doctorBox: {
    flexDirection: "row",
    alignItems: "center",
    border: "1 solid #E2E8F0",
    borderRadius: 8,
    padding: 14,
  },
  doctorText: { flex: 1, paddingRight: 14 },
  doctorTitle: { fontSize: 11, fontFamily: "Helvetica-Bold", color: NAVY, marginBottom: 4 },
  doctorBody: { fontSize: 8.5, color: SLATE, lineHeight: 1.45, marginBottom: 6 },
  doctorUrl: { fontSize: 8, color: PURPLE, textDecoration: "none" },
  qrFrame: {
    width: 92,
    height: 92,
    border: "1 solid #E2E8F0",
    borderRadius: 6,
    padding: 4,
    backgroundColor: "#FFFFFF",
  },
  qrImage: { width: 82, height: 82 },

  supportNote: { marginTop: 14, padding: 10, backgroundColor: "#F8FAFC", borderRadius: 6 },
  supportText: { fontSize: 8, color: SLATE },

  footer: { position: "absolute", bottom: 32, left: 48, right: 48, borderTop: "1 solid #E2E8F0", paddingTop: 8, fontSize: 7, color: "#94A3B8" },
});

interface CheckupPDFProps {
  scale: string;
  score: number;
  band: string;
  label: string;
  crisis: boolean;
  rid: string;
  /** PNG data-URL do QR, gerado na rota (react-pdf não desenha canvas). */
  qrDataUrl?: string;
  /** ASSIST: resultado por substância serializado ("maconha:14,...") */
  sub?: string;
  /** ASSIST: relatou uso injetável (Q8 > 0) */
  inj?: boolean;
}

export function CheckupPDF({ scale, score, band, label, crisis, rid, qrDataUrl, sub, inj }: CheckupPDFProps) {
  const qrUrl = buildQrUrl(rid);
  const today = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  const max = SCALE_MAX[scale];
  const bandColor = BAND_COLORS[band] ?? BAND_COLORS.informative;
  const isInformative = band === "informative";
  const assistSub = scale === "assist" ? decodeAssistResult(sub ?? "") : [];

  return (
    <Document title="Relatório de Triagem — Check-up Mental">
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View style={styles.brandRow}>
            <Image src={BRAND_LOGO_PNG} style={styles.brandLogo} />
            <Text style={styles.brand}>Cérebro Amigo · Check-up Mental</Text>
          </View>
          <Text style={styles.date}>{today}</Text>
        </View>
        <Text style={styles.title}>{SCALE_NAMES[scale] ?? "Triagem de Saúde Mental"}</Text>
        <View style={styles.rule}>
          <View style={styles.rulePurple} />
          <View style={styles.ruleCoral} />
        </View>

        {/* Crisis resources — sempre visíveis se crisisFlag */}
        {crisis && (
          <View style={styles.crisisBox}>
            <Text style={styles.crisisTitle}>Canais de apoio disponíveis 24h</Text>
            {CRISIS_RESOURCES.map((r, i) => (
              <Text key={i} style={styles.crisisItem}>• {r}</Text>
            ))}
          </View>
        )}

        {/* Disclaimer */}
        <View style={styles.disclaimer}>
          <Text>
            Este relatório é baseado em instrumento de triagem — não é diagnóstico e não substitui avaliação por profissional de saúde mental qualificado. Leve este documento ao seu médico ou psicólogo para uma avaliação completa.
          </Text>
        </View>

        {/* Resultado */}
        <Text style={styles.sectionTitle}>Resultado da triagem</Text>
        {scale === "assist" ? (
          <View style={styles.table}>
            {assistSub.length === 0 ? (
              <View style={styles.rowLast}>
                <Text style={styles.cellValue}>
                  Sem uso de substâncias relatado ao longo da vida — risco baixo.
                </Text>
              </View>
            ) : (
              assistSub.map((s, i) => {
                const c = BAND_COLORS[s.band] ?? BAND_COLORS.informative;
                const rowStyle = i === assistSub.length - 1 ? styles.rowLast : styles.row;
                return (
                  <View key={s.id} style={rowStyle}>
                    <Text style={styles.cellLabel}>{s.short}</Text>
                    <Text style={[styles.cellValue, { color: c.text }]}>
                      {s.score} pontos — {s.bandLabel}
                    </Text>
                  </View>
                );
              })
            )}
            {inj && (
              <View style={styles.rowLast}>
                <Text style={[styles.cellValue, { color: "#7F1D1D" }]}>
                  Relatou uso de drogas injetáveis — atenção adicional recomendada na avaliação.
                </Text>
              </View>
            )}
          </View>
        ) : (
        <View style={styles.hero}>
          <View style={styles.heroScoreBlock}>
            <Text style={styles.heroScore}>{score}</Text>
            {max !== undefined && <Text style={styles.heroScoreMax}>de {max} pontos</Text>}
          </View>
          <View style={styles.heroDivider} />
          <View style={styles.heroRight}>
            <Text
              style={[
                styles.bandChip,
                { backgroundColor: bandColor.bg, border: `1 solid ${bandColor.border}`, color: bandColor.text },
              ]}
            >
              {label || band}
            </Text>
            <Text style={styles.heroMeta}>Instrumento: {SCALE_NAMES[scale] ?? scale}</Text>
            <Text style={styles.heroMeta}>Período avaliado: {SCALE_TIMEFRAME[scale] ?? "—"}</Text>
            {isInformative && (
              <Text style={styles.heroMeta}>
                Escore informativo, sem ponto de corte validado para o Brasil — interpretação cabe ao profissional.
              </Text>
            )}
          </View>
        </View>
        )}

        {/* Detalhes */}
        <View style={styles.table}>
          <View style={styles.row}>
            <Text style={styles.cellLabel}>Instrumento</Text>
            <Text style={styles.cellValue}>{SCALE_NAMES[scale] ?? scale}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.cellLabel}>Data de realização</Text>
            <Text style={styles.cellValue}>{today}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.cellLabel}>{scale === "assist" ? "Maior escore por substância" : "Escore total"}</Text>
            <Text style={styles.cellValue}>{max !== undefined ? `${score} de ${max}` : score}</Text>
          </View>
          <View style={styles.rowLast}>
            <Text style={styles.cellLabel}>Faixa</Text>
            <Text style={styles.cellValue}>{label || band}</Text>
          </View>
        </View>

        {/* Sobre o Cérebro Amigo — site e função, em qualquer versão do PDF */}
        <View style={styles.aboutBox}>
          <Image src={BRAND_LOGO_PNG} style={styles.aboutLogo} />
          <Text style={styles.aboutText}>
            Este relatório foi gerado pelo Check-up Mental (
            <Link src="https://checkup.cerebroamigo.com.br" style={styles.aboutLink}>checkup.cerebroamigo.com.br</Link>
            ), serviço gratuito do <Text style={{ fontFamily: "Helvetica-Bold" }}>Cérebro Amigo</Text> — plataforma que ajuda psiquiatras a acompanhar seus pacientes entre as consultas, com check-ins, lembretes e organização de condutas. Conheça em{" "}
            <Link src="https://www.cerebroamigo.com.br" style={styles.aboutLink}>www.cerebroamigo.com.br</Link>.
            {/* Versão crise fica sem CTA de marketing (clinical-safety). */}
            {!crisis && (
              <Text>
                {" "}Siga no Instagram:{" "}
                <Link src="https://www.instagram.com/cerebroamigooficial/" style={styles.aboutLink}>@cerebroamigooficial</Link>.
              </Text>
            )}
          </Text>
        </View>

        {/* QR para médicos — omitido em versão crise */}
        {!crisis && rid && (
          <View style={styles.doctorBox}>
            <View style={styles.doctorText}>
              <Text style={styles.doctorTitle}>Para seu médico</Text>
              <Text style={styles.doctorBody}>
                Doutor(a): este resultado veio de um instrumento de triagem autoaplicado. Escaneie o QR ao lado para conhecer o Check-up Mental e como o Cérebro Amigo pode complementar o acompanhamento dos seus pacientes entre as consultas.
              </Text>
              <Link src={qrUrl} style={styles.doctorUrl}>{qrUrl}</Link>
            </View>
            {qrDataUrl ? (
              <View style={styles.qrFrame}>
                <Image src={qrDataUrl} style={styles.qrImage} />
              </View>
            ) : null}
          </View>
        )}

        {/* Crisis resources at bottom for non-crisis mode too (subtle) */}
        {!crisis && (
          <View style={styles.supportNote}>
            <Text style={styles.supportText}>
              Em qualquer momento, se você precisar de apoio: CVV 188 (24h) · cvv.org.br · SAMU 192
            </Text>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text>Cérebro Amigo by Arinelli · © 2026 — Check-up Mental (checkup.cerebroamigo.com.br). Documento gerado automaticamente. Uso pessoal e confidencial.</Text>
        </View>
      </Page>
    </Document>
  );
}
