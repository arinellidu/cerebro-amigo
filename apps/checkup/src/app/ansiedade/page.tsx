import type { Metadata } from "next";
import { Wind } from "lucide-react";
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
import { gad7 } from "@/lib/scales";

const PAGE_URL = `${SITE_URL}/ansiedade`;

export const metadata: Metadata = {
  title: "Teste de Ansiedade Online Gratuito — GAD-7 em Português",
  description:
    "Faça o GAD-7, instrumento clínico validado para triagem de ansiedade generalizada. Gratuito, anônimo, sem cadastro. Resultado instantâneo com devolutiva.",
  keywords: [
    "teste de ansiedade",
    "GAD-7 português",
    "triagem ansiedade online",
    "sintomas ansiedade generalizada",
    "questionário ansiedade gratuito",
    "check-up ansiedade",
  ],
  alternates: { canonical: PAGE_URL },
  openGraph: {
    title: "Teste de Ansiedade Online Gratuito — GAD-7",
    description: "Triagem validada, anônima, resultado em 2 minutos.",
    url: PAGE_URL,
  },
};

const CITATIONS = [
  "Spitzer RL, Kroenke K, Williams JBW, Löwe B. A brief measure for assessing generalized anxiety disorder: the GAD-7. Arch Intern Med, 2006.",
  "Moreno AL et al. — propriedades psicométricas da versão brasileira do GAD-7.",
  "Versão oficial em português brasileiro (autorrelato): Pfizer / phqscreeners.com — instrumento de uso livre.",
];

const FAQS: FaqItem[] = [
  {
    q: "O teste GAD-7 dá diagnóstico de ansiedade?",
    a: "Não. O GAD-7 é um instrumento de triagem: ajuda a avaliar se os sintomas de ansiedade merecem atenção profissional, mas só um psiquiatra, psicólogo ou médico pode diagnosticar um transtorno de ansiedade.",
  },
  {
    q: "O teste é gratuito e anônimo mesmo?",
    a: "Sim. Não pedimos cadastro, e-mail nem cartão. Nada é gravado sem o seu consentimento explícito — e, mesmo com consentimento, só a escala, o escore e a faixa são salvos, de forma anônima.",
  },
  {
    q: "Quanto tempo demora?",
    a: "Cerca de 2 minutos. São 7 perguntas sobre as últimas 2 semanas, uma por tela, e você pode voltar para revisar qualquer resposta.",
  },
  {
    q: "Como funciona o escore do GAD-7?",
    a: "Cada uma das 7 perguntas vale de 0 a 3 pontos conforme a frequência do sintoma nas últimas 2 semanas. O total vai de 0 a 21 e é classificado nas faixas definidas pelo instrumento: mínimo, leve, moderado e grave.",
  },
  {
    q: "A versão em português é validada?",
    a: "Sim. O teste usa a versão oficial de autorrelato em português brasileiro (distribuída pela Pfizer em phqscreeners.com), e a versão brasileira do GAD-7 tem propriedades psicométricas estudadas (Moreno et al.).",
  },
  {
    q: "Sentir ansiedade é sempre um problema?",
    a: "Não — ansiedade é uma resposta normal em muitas situações. O GAD-7 ajuda a avaliar quando a frequência e a intensidade dos sintomas podem estar interferindo na sua qualidade de vida e merecem uma conversa com um profissional.",
  },
];

export default function AnsiedadePage() {
  return (
    <>
      <JsonLd
        data={medicalWebPageJsonLd({
          name: "Triagem de Ansiedade — GAD-7",
          url: PAGE_URL,
          description:
            "Instrumento de triagem GAD-7 para avaliação de sintomas de ansiedade generalizada.",
          conditionName: "Transtorno de ansiedade generalizada",
          citations: CITATIONS,
        })}
      />
      <JsonLd data={faqJsonLd(FAQS)} />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Check-up Mental", url: SITE_URL },
          { name: "Teste de ansiedade (GAD-7)", url: PAGE_URL },
        ])}
      />

      <main className="landing-aurora mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <LandingHero
          icon={<Wind className="h-9 w-9" aria-hidden />}
          eyebrow="Triagem gratuita · GAD-7"
          title="Teste de ansiedade online"
          lead="7 perguntas baseadas no GAD-7, instrumento validado para triagem de ansiedade generalizada. Resultado em cerca de 2 minutos."
          ctaHref="/teste/gad7"
          ctaLabel="Fazer teste agora — é gratuito"
          badges={["Anônimo", "Sem cadastro", "~2 min", "Instrumento validado"]}
        />

        <ComoFunciona />

        {/* O que é */}
        <section className="mb-12">
          <h2 className="mb-3 font-display text-2xl font-semibold text-foreground">
            O que é o GAD-7?
          </h2>
          <p className="mb-3 leading-relaxed text-muted-foreground">
            O GAD-7 (Generalized Anxiety Disorder-7) é um instrumento de triagem para ansiedade
            generalizada, desenvolvido e validado em estudos internacionais e disponível em
            português brasileiro (Moreno et al.).
          </p>
          <p className="leading-relaxed text-muted-foreground">
            Avalia a frequência de 7 sintomas nas últimas 2 semanas, com escore de 0 a 21,
            classificado em faixas: mínimo, leve, moderado e grave.
          </p>
        </section>

        {/* Aviso — ilha clara deliberada (clinical-safety) */}
        <section className="mb-12 bg-amber-50 border border-amber-200 rounded-xl p-5">
          <h2 className="font-semibold text-amber-900 mb-2">Importante saber</h2>
          <p className="text-amber-800 text-sm leading-relaxed">
            O GAD-7 é um instrumento de <strong>triagem</strong>, não de diagnóstico. Ansiedade
            é normal em muitas situações — o instrumento ajuda a avaliar quando os sintomas podem
            estar interferindo na qualidade de vida e merecem atenção profissional.
          </p>
        </section>

        <SymptomGrid
          title="Sintomas que o GAD-7 avalia"
          items={[
            "Sentir-se nervoso, ansioso ou muito tenso",
            "Dificuldade de parar ou controlar as preocupações",
            "Preocupação excessiva com diversas coisas",
            "Dificuldade para relaxar",
            "Agitação que dificulta permanecer sentado",
            "Irritabilidade ou aborrecimento fácil",
            "Sensação de que algo horrível vai acontecer",
          ]}
        />

        <InterpretationSection scale={gad7} />

        <QuandoProcurarAjuda />

        <FaqSection items={FAQS} />

        <CitationsBlock citations={CITATIONS} />

        <ReviewerBlock />

        <LandingCta
          title="Veja como você está com a ansiedade agora"
          ctaHref="/teste/gad7"
          ctaLabel="Começar o GAD-7 agora"
        />

        <OutrasTriagens current="/ansiedade" />
      </main>
    </>
  );
}
