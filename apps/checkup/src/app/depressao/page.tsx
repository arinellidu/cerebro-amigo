import type { Metadata } from "next";
import { CloudRain } from "lucide-react";
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
import { phq9 } from "@/lib/scales";

const PAGE_URL = `${SITE_URL}/depressao`;

export const metadata: Metadata = {
  title: "Teste de Depressão Online Gratuito — PHQ-9 em Português",
  description:
    "Faça o PHQ-9, instrumento clínico validado para triagem de depressão. Gratuito, anônimo, sem cadastro. Resultado instantâneo com devolutiva e relatório PDF.",
  keywords: [
    "teste de depressão",
    "PHQ-9 português",
    "triagem depressão online",
    "sintomas depressão",
    "questionário depressão gratuito",
    "check-up depressão",
  ],
  alternates: { canonical: PAGE_URL },
  openGraph: {
    title: "Teste de Depressão Online Gratuito — PHQ-9",
    description: "Triagem validada, anônima, resultado em 3 minutos.",
    url: PAGE_URL,
  },
};

const CITATIONS = [
  "Kroenke K, Spitzer RL, Williams JBW. The PHQ-9: validity of a brief depression severity measure. J Gen Intern Med, 2001.",
  "Santos IS et al., Cad. Saúde Pública, 2013 — validação brasileira do PHQ-9.",
  "Versão oficial em português brasileiro (autorrelato): Pfizer / phqscreeners.com — instrumento de uso livre.",
];

const FAQS: FaqItem[] = [
  {
    q: "O teste PHQ-9 dá diagnóstico de depressão?",
    a: "Não. O PHQ-9 é um instrumento de triagem: ele indica se os seus sintomas merecem atenção profissional, mas só um psiquiatra, psicólogo ou médico pode diagnosticar depressão. Use o resultado como ponto de partida para essa conversa.",
  },
  {
    q: "O teste é gratuito e anônimo mesmo?",
    a: "Sim. Não pedimos cadastro, e-mail nem cartão. Nada é gravado sem o seu consentimento explícito — e, mesmo com consentimento, só a escala, o escore e a faixa são salvos, de forma anônima.",
  },
  {
    q: "Quanto tempo demora?",
    a: "Cerca de 3 minutos. São 9 perguntas sobre as últimas 2 semanas, uma por tela, e você pode voltar para revisar qualquer resposta.",
  },
  {
    q: "Como funciona o escore do PHQ-9?",
    a: "Cada uma das 9 perguntas vale de 0 a 3 pontos conforme a frequência do sintoma nas últimas 2 semanas. O total vai de 0 a 27 e é classificado nas faixas definidas pelo instrumento: mínimo, leve, moderado, moderadamente grave e grave.",
  },
  {
    q: "A versão em português é validada?",
    a: "Sim. O teste usa a versão oficial de autorrelato em português brasileiro (distribuída pela Pfizer em phqscreeners.com), e o PHQ-9 tem validação publicada para a população brasileira (Santos et al., 2013).",
  },
  {
    q: "O que eu faço com o resultado?",
    a: "Você pode baixar um relatório em PDF com o seu escore e a faixa, pensado para levar ao seu médico ou psicólogo na próxima consulta.",
  },
];

export default function DepressaoPage() {
  return (
    <>
      <JsonLd
        data={medicalWebPageJsonLd({
          name: "Triagem de Depressão — PHQ-9",
          url: PAGE_URL,
          description:
            "Instrumento de triagem PHQ-9 para avaliação de sintomas depressivos.",
          conditionName: "Depressão",
          citations: CITATIONS,
        })}
      />
      <JsonLd data={faqJsonLd(FAQS)} />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Check-up Mental", url: SITE_URL },
          { name: "Teste de depressão (PHQ-9)", url: PAGE_URL },
        ])}
      />

      <main className="landing-aurora mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <LandingHero
          icon={<CloudRain className="h-9 w-9" aria-hidden />}
          eyebrow="Triagem gratuita · PHQ-9"
          title="Teste de depressão online"
          lead="9 perguntas baseadas no PHQ-9, instrumento clínico validado amplamente usado por psiquiatras e clínicos gerais. Resultado em cerca de 3 minutos."
          ctaHref="/teste/phq9"
          ctaLabel="Fazer teste agora — é gratuito"
          badges={["Anônimo", "Sem cadastro", "~3 min", "Instrumento validado"]}
        />

        <ComoFunciona />

        {/* O que é */}
        <section className="mb-12">
          <h2 className="mb-3 font-display text-2xl font-semibold text-foreground">
            O que é o PHQ-9?
          </h2>
          <p className="mb-3 leading-relaxed text-muted-foreground">
            O PHQ-9 (Patient Health Questionnaire-9) é um instrumento de triagem para depressão
            desenvolvido e validado cientificamente, amplamente usado em consultórios e hospitais
            no mundo todo — inclusive no Brasil, com tradução validada por Santos et al. (2013).
          </p>
          <p className="leading-relaxed text-muted-foreground">
            Ele avalia a frequência de 9 sintomas nas últimas 2 semanas, com escore de 0 a 27.
            Os resultados são classificados em faixas: mínimo, leve, moderado, moderadamente
            grave e grave.
          </p>
        </section>

        {/* O que ele NÃO é — ilha clara deliberada (clinical-safety) */}
        <section className="mb-12 bg-amber-50 border border-amber-200 rounded-xl p-5">
          <h2 className="font-semibold text-amber-900 mb-2">Importante saber</h2>
          <p className="text-amber-800 text-sm leading-relaxed">
            O PHQ-9 é um instrumento de <strong>triagem</strong>, não de diagnóstico. Um resultado
            elevado indica que pode valer a pena buscar uma avaliação profissional — mas apenas
            um psiquiatra, psicólogo ou médico pode diagnosticar depressão. Use este resultado
            como ponto de partida para uma conversa com o seu profissional de saúde.
          </p>
        </section>

        <SymptomGrid
          title="Sintomas que o PHQ-9 avalia"
          items={[
            "Pouco interesse ou prazer em fazer as coisas",
            "Sentir-se para baixo, deprimido ou sem perspectiva",
            "Dificuldades com sono — insônia ou dormir demais",
            "Cansaço ou pouca energia",
            "Falta de apetite ou comer demais",
            "Dificuldade de concentração",
            "Sentir-se mal consigo mesmo",
            "Agitação ou lentidão incomuns",
            "Pensamentos de se machucar",
          ]}
        />

        <InterpretationSection scale={phq9} />

        <QuandoProcurarAjuda />

        <FaqSection items={FAQS} />

        <CitationsBlock citations={CITATIONS} />

        <ReviewerBlock />

        <LandingCta
          title="Pronto para verificar como você está?"
          ctaHref="/teste/phq9"
          ctaLabel="Começar o PHQ-9 agora"
        />

        <OutrasTriagens current="/depressao" />
      </main>
    </>
  );
}
