import type { Metadata } from "next";
import { Cigarette } from "lucide-react";
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
import { fagerstrom } from "@/lib/scales";

const PAGE_URL = `${SITE_URL}/tabagismo`;

export const metadata: Metadata = {
  title: "Teste de Fagerström Online Gratuito — Dependência de Nicotina",
  description:
    "Faça o Teste de Fagerström, instrumento validado para medir o grau de dependência de nicotina. Gratuito, anônimo, resultado instantâneo.",
  keywords: [
    "teste de Fagerström",
    "dependência de nicotina teste",
    "teste tabagismo online",
    "grau de dependência cigarro",
    "parar de fumar teste",
    "questionário tabagismo gratuito",
  ],
  alternates: { canonical: PAGE_URL },
  openGraph: {
    title: "Teste de Fagerström — Dependência de Nicotina",
    description: "Triagem validada, anônima, resultado em 1 minuto.",
    url: PAGE_URL,
  },
};

const CITATIONS = [
  "Heatherton TF, Kozlowski LT, Frecker RC, Fagerström KO. The Fagerström Test for Nicotine Dependence. Br J Addict, 1991.",
  "Carmo JT, Pueschel AA. — versão brasileira validada do Teste de Fagerström (2002).",
  "INCA / Ministério da Saúde — protocolo de tratamento do tabagismo (SUS).",
];

const FAQS: FaqItem[] = [
  {
    q: "Para que serve o Teste de Fagerström?",
    a: "Ele mede o grau de dependência física de nicotina — de muito baixo a muito elevado. É o instrumento usado pelo próprio SUS no programa de tratamento do tabagismo, porque o grau de dependência ajuda o profissional a planejar a melhor estratégia para parar.",
  },
  {
    q: "O teste é gratuito e anônimo mesmo?",
    a: "Sim. Não pedimos cadastro, e-mail nem cartão. Nada é gravado sem o seu consentimento explícito — e, mesmo com consentimento, só a escala, o escore e a faixa são salvos, de forma anônima.",
  },
  {
    q: "Quanto tempo demora?",
    a: "Cerca de 1 minuto. São apenas 6 perguntas sobre o seu hábito atual de fumar.",
  },
  {
    q: "Como funciona o escore?",
    a: "Cada pergunta tem um peso definido pelo instrumento. O total vai de 0 a 10: 0–2 dependência muito baixa, 3–4 baixa, 5 média, 6–7 elevada e 8–10 muito elevada.",
  },
  {
    q: "Dependência alta significa que não vou conseguir parar?",
    a: "Não — significa que parar sozinho tende a ser mais difícil, e que o acompanhamento profissional faz mais diferença. O SUS oferece tratamento gratuito e estruturado para o tabagismo nas UBS.",
  },
  {
    q: "Vale para cigarro eletrônico?",
    a: "O Fagerström foi desenvolvido e validado para cigarros convencionais. Se a sua questão é com vape ou outros produtos de nicotina, a conversa com um profissional continua sendo o melhor caminho.",
  },
];

export default function TabagismoPage() {
  return (
    <>
      <JsonLd
        data={medicalWebPageJsonLd({
          name: "Teste de Fagerström — Dependência de Nicotina",
          url: PAGE_URL,
          description:
            "Teste de Fagerström (FTND) para avaliação do grau de dependência de nicotina.",
          conditionName: "Dependência de nicotina",
          citations: CITATIONS,
        })}
      />
      <JsonLd data={faqJsonLd(FAQS)} />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Check-up Mental", url: SITE_URL },
          { name: "Teste de tabagismo (Fagerström)", url: PAGE_URL },
        ])}
      />

      <main className="landing-aurora mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <LandingHero
          icon={<Cigarette className="h-9 w-9" aria-hidden />}
          eyebrow="Triagem gratuita · Fagerström"
          title="Teste de dependência de nicotina"
          lead="6 perguntas do Teste de Fagerström, o instrumento usado pelo SUS para medir o grau de dependência de nicotina. Resultado em 1 minuto."
          ctaHref="/teste/fagerstrom"
          ctaLabel="Fazer teste agora — é gratuito"
          badges={["Anônimo", "Sem cadastro", "~1 min", "Instrumento validado"]}
        />

        <ComoFunciona />

        <section className="mb-12">
          <h2 className="mb-3 font-display text-2xl font-semibold text-foreground">
            O que é o Teste de Fagerström?
          </h2>
          <p className="mb-3 leading-relaxed text-muted-foreground">
            O Teste de Fagerström (FTND) é o instrumento padrão internacional para medir
            dependência física de nicotina, com versão brasileira validada (Carmo &
            Pueschel, 2002) e adotada pelo INCA e pelo programa de tratamento do tabagismo
            do SUS.
          </p>
          <p className="leading-relaxed text-muted-foreground">
            São 6 perguntas rápidas sobre o seu hábito — do horário do primeiro cigarro do
            dia à quantidade fumada — com escore de 0 a 10 em cinco graus de dependência.
          </p>
        </section>

        {/* Aviso — ilha clara deliberada (clinical-safety) */}
        <section className="mb-12 bg-amber-50 border border-amber-200 rounded-xl p-5">
          <h2 className="font-semibold text-amber-900 mb-2">Importante saber</h2>
          <p className="text-amber-800 text-sm leading-relaxed">
            Dependência de nicotina não é falta de força de vontade — é uma condição de
            saúde que responde a tratamento. O SUS oferece programa <strong>gratuito</strong>{" "}
            de tratamento do tabagismo nas UBS.
          </p>
        </section>

        <SymptomGrid
          title="O que o Fagerström avalia"
          items={[
            "Quanto tempo após acordar vem o primeiro cigarro",
            "Dificuldade de não fumar em locais proibidos",
            "Qual cigarro do dia seria o mais difícil de largar",
            "Quantos cigarros por dia",
            "Fumar mais nas primeiras horas do dia",
            "Fumar mesmo doente, de cama",
          ]}
        />

        <InterpretationSection scale={fagerstrom} />

        <QuandoProcurarAjuda />

        <FaqSection items={FAQS} />

        <CitationsBlock citations={CITATIONS} />

        <ReviewerBlock />

        <LandingCta
          title="Descubra o seu grau de dependência"
          ctaHref="/teste/fagerstrom"
          ctaLabel="Começar o Fagerström agora"
        />

        <OutrasTriagens current="/tabagismo" />
      </main>
    </>
  );
}
