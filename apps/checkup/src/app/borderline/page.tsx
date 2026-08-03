import type { Metadata } from "next";
import { Heart } from "lucide-react";
import {
  LandingHero,
  ComoFunciona,
  SymptomGrid,
  LandingCta,
  OutrasTriagens,
} from "@/components/landing-blocks";
import {
  JsonLd,
  InterpretationSection,
  QuandoProcurarAjuda,
  FaqSection,
  CitationsBlock,
  ReviewerBlock,
} from "@/components/seo-blocks";
import {
  SITE_URL,
  medicalWebPageJsonLd,
  faqJsonLd,
  breadcrumbJsonLd,
  type FaqItem,
} from "@/lib/seo/jsonld";
import { msiBpd } from "@/lib/scales";

const PAGE_URL = `${SITE_URL}/borderline`;

export const metadata: Metadata = {
  title: "Teste de Traços Borderline Online Gratuito — MSI-BPD em Português",
  description:
    "Faça o MSI-BPD, instrumento de triagem de traços de personalidade borderline. Gratuito, anônimo, sem cadastro. Resultado com orientações.",
  keywords: [
    "teste borderline",
    "MSI-BPD português",
    "traços borderline teste",
    "triagem personalidade borderline",
    "sintomas borderline",
    "questionário borderline gratuito",
  ],
  alternates: { canonical: PAGE_URL },
  openGraph: {
    title: "Teste de Traços Borderline — MSI-BPD",
    description: "Triagem anônima, resultado informativo em 2 minutos.",
    url: PAGE_URL,
  },
};

const CITATIONS = [
  "Zanarini MC et al. A screening measure for BPD: the McLean Screening Instrument for Borderline Personality Disorder (MSI-BPD). J Pers Disord, 2003.",
  "Sem ponto de corte validado para o Brasil até o momento — por isso o resultado é informativo, sem triagem positiva/negativa.",
];

const FAQS: FaqItem[] = [
  {
    q: "O MSI-BPD diz se eu tenho borderline?",
    a: "Não — e aqui isso vale em dobro. O MSI-BPD organiza padrões que merecem atenção, mas transtornos de personalidade só podem ser avaliados por um profissional, ao longo do tempo e considerando toda a sua história. O resultado deste teste é informativo, sem 'positivo' ou 'negativo'.",
  },
  {
    q: "Por que o resultado não diz 'positivo' ou 'negativo'?",
    a: "Porque o ponto de corte do MSI-BPD foi estudado em amostras americanas e ainda não há validação brasileira com corte publicado. Sem isso, atribuir um verdict seria irresponsável — o resultado organiza suas respostas para uma conversa profissional.",
  },
  {
    q: "O teste é gratuito e anônimo mesmo?",
    a: "Sim. Não pedimos cadastro, e-mail nem cartão. Nada é gravado sem o seu consentimento explícito — e, mesmo com consentimento, só a escala, o escore e a faixa são salvos, de forma anônima.",
  },
  {
    q: "O teste tem perguntas difíceis?",
    a: "Algumas perguntas tocam em temas sensíveis, como autolesão. Se alguma resposta indicar que você pode estar em sofrimento agora, o teste pausa e mostra canais de apoio imediato antes de qualquer resultado — seu bem-estar vem antes do escore.",
  },
  {
    q: "Emoções intensas significam borderline?",
    a: "Não. Intensidade emocional faz parte da experiência humana. O que merece atenção profissional é quando padrões persistentes de emoções, relações e impulsividade causam sofrimento real — e é isso que o MSI-BPD ajuda a organizar.",
  },
  {
    q: "Traços borderline têm tratamento?",
    a: "Sim. Abordagens psicoterapêuticas específicas têm boa evidência, e o acompanhamento profissional muda trajetórias. O primeiro passo é uma avaliação com psiquiatra ou psicólogo.",
  },
];

export default function BorderlinePage() {
  return (
    <>
      <JsonLd
        data={medicalWebPageJsonLd({
          name: "Triagem de Traços Borderline — MSI-BPD",
          url: PAGE_URL,
          description:
            "Instrumento de triagem MSI-BPD (McLean) para organização de traços de personalidade borderline.",
          conditionName: "Transtorno de personalidade borderline",
          citations: CITATIONS,
        })}
      />
      <JsonLd data={faqJsonLd(FAQS)} />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Check-up Mental", url: SITE_URL },
          { name: "Teste de traços borderline (MSI-BPD)", url: PAGE_URL },
        ])}
      />

      <main className="landing-aurora mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <LandingHero
          icon={<Heart className="h-9 w-9" aria-hidden />}
          eyebrow="Triagem gratuita · MSI-BPD"
          title="Teste de traços borderline"
          lead="10 perguntas do MSI-BPD, instrumento de triagem desenvolvido na McLean Hospital (Harvard). Resultado informativo em cerca de 2 minutos."
          ctaHref="/teste/msi_bpd"
          ctaLabel="Fazer teste agora — é gratuito"
          badges={["Anônimo", "Sem cadastro", "~2 min", "Resultado informativo"]}
        />

        <ComoFunciona />

        <section className="mb-12">
          <h2 className="mb-3 font-display text-2xl font-semibold text-foreground">
            O que é o MSI-BPD?
          </h2>
          <p className="mb-3 leading-relaxed text-muted-foreground">
            O MSI-BPD (McLean Screening Instrument for BPD) é um instrumento breve de
            triagem desenvolvido por pesquisadores da Harvard Medical School para organizar
            padrões frequentemente associados a traços borderline: emoções intensas,
            relações instáveis, impulsividade e medo de abandono.
          </p>
          <p className="leading-relaxed text-muted-foreground">
            Como ainda não há ponto de corte validado para o Brasil, o resultado aqui é
            deliberadamente informativo — ele organiza o que você respondeu para uma
            conversa de qualidade com um profissional, sem rotular.
          </p>
        </section>

        {/* Aviso — ilha clara deliberada (clinical-safety) */}
        <section className="mb-12 bg-amber-50 border border-amber-200 rounded-xl p-5">
          <h2 className="font-semibold text-amber-900 mb-2">Importante saber</h2>
          <p className="text-amber-800 text-sm leading-relaxed">
            Personalidade não se avalia por questionário: o MSI-BPD é um{" "}
            <strong>ponto de partida</strong>, nunca um rótulo. Algumas perguntas tocam em
            temas sensíveis — se você estiver em sofrimento agora, o CVV atende 24h no{" "}
            <strong>188</strong>.
          </p>
        </section>

        <SymptomGrid
          title="Padrões que o MSI-BPD organiza"
          items={[
            "Relações próximas com muitos altos e baixos",
            "Impulsividade em mais de uma área da vida",
            "Mudanças de humor intensas e frequentes",
            "Raiva intensa ou desproporcional",
            "Sensação crônica de vazio",
            "Incerteza sobre a própria identidade",
            "Medo intenso de abandono",
            "Sensação de irrealidade em momentos de estresse",
          ]}
        />

        <InterpretationSection scale={msiBpd} />

        <QuandoProcurarAjuda />

        <FaqSection items={FAQS} />

        <CitationsBlock citations={CITATIONS} />

        <ReviewerBlock />

        <LandingCta
          title="Organize o que você sente para uma boa conversa profissional"
          ctaHref="/teste/msi_bpd"
          ctaLabel="Começar o MSI-BPD agora"
        />

        <OutrasTriagens current="/borderline" />
      </main>
    </>
  );
}
