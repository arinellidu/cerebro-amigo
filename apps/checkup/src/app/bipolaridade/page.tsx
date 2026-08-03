import type { Metadata } from "next";
import { Activity } from "lucide-react";
import {
  LandingHero,
  ComoFunciona,
  SymptomGrid,
  LandingCta,
  OutrasTriagens,
} from "@/components/landing-blocks";
import {
  JsonLd,
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

const PAGE_URL = `${SITE_URL}/bipolaridade`;

export const metadata: Metadata = {
  title: "Teste de Bipolaridade Online Gratuito — MDQ em Português",
  description:
    "Faça o MDQ, instrumento validado para triagem de transtorno bipolar. Gratuito, anônimo, sem cadastro. Resultado instantâneo com orientações.",
  keywords: [
    "teste de bipolaridade",
    "MDQ português",
    "triagem transtorno bipolar",
    "sintomas de bipolaridade",
    "teste transtorno bipolar online",
    "questionário bipolaridade gratuito",
  ],
  alternates: { canonical: PAGE_URL },
  openGraph: {
    title: "Teste de Bipolaridade — MDQ",
    description: "Triagem validada, anônima, resultado em 3 minutos.",
    url: PAGE_URL,
  },
};

const CITATIONS = [
  "Hirschfeld RMA et al. Development and validation of a screening instrument for bipolar spectrum disorder: the Mood Disorder Questionnaire. Am J Psychiatry, 2000.",
  "Castelo MS et al. — validação da versão brasileira do MDQ (Rev Bras Psiquiatr, 2010).",
];

const FAQS: FaqItem[] = [
  {
    q: "O MDQ diz se eu sou bipolar?",
    a: "Não. O MDQ é um instrumento de triagem: ele indica se vale a pena investigar variações de humor e energia com um especialista. O diagnóstico de qualquer transtorno do humor só pode ser feito por um profissional, numa avaliação completa.",
  },
  {
    q: "O teste é gratuito e anônimo mesmo?",
    a: "Sim. Não pedimos cadastro, e-mail nem cartão. Nada é gravado sem o seu consentimento explícito — e, mesmo com consentimento, só a escala, o escore e a faixa são salvos, de forma anônima.",
  },
  {
    q: "Como funciona a triagem do MDQ?",
    a: "São 13 perguntas sobre períodos marcantes de humor e energia elevados, mais duas sobre simultaneidade e impacto. A triagem só é considerada positiva quando há 7 ou mais respostas 'sim', os episódios aconteceram no mesmo período e causaram problema moderado ou sério.",
  },
  {
    q: "Ter muita energia às vezes significa bipolaridade?",
    a: "Não. Variações de humor e energia fazem parte da vida. O MDQ procura padrões específicos — períodos marcantes, simultâneos e que causaram prejuízo real — que merecem uma conversa com um especialista.",
  },
  {
    q: "Por que o MDQ pergunta sobre a vida toda, e não sobre as últimas semanas?",
    a: "Porque os períodos de humor elevado podem ter acontecido há anos. O instrumento rastreia se eles já ocorreram em algum momento da vida — essa história é essencial para a avaliação profissional.",
  },
  {
    q: "Fiz o teste de depressão e deu alterado. Devo fazer o MDQ também?",
    a: "Pode ser útil: episódios depressivos e períodos de humor elevado podem fazer parte do mesmo quadro, e essa distinção muda a conduta do especialista. Leve os dois resultados para a consulta.",
  },
];

export default function BipolaridadePage() {
  return (
    <>
      <JsonLd
        data={medicalWebPageJsonLd({
          name: "Triagem de Bipolaridade — MDQ",
          url: PAGE_URL,
          description:
            "Instrumento de triagem MDQ (Mood Disorder Questionnaire) para rastreio de transtorno do espectro bipolar.",
          conditionName: "Transtorno bipolar",
          citations: CITATIONS,
        })}
      />
      <JsonLd data={faqJsonLd(FAQS)} />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Check-up Mental", url: SITE_URL },
          { name: "Teste de bipolaridade (MDQ)", url: PAGE_URL },
        ])}
      />

      <main className="landing-aurora mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <LandingHero
          icon={<Activity className="h-9 w-9" aria-hidden />}
          eyebrow="Triagem gratuita · MDQ"
          title="Teste de bipolaridade online"
          lead="15 perguntas do MDQ, instrumento validado para rastrear períodos de humor e energia fora do habitual. Resultado em cerca de 3 minutos."
          ctaHref="/teste/mdq"
          ctaLabel="Fazer teste agora — é gratuito"
          badges={["Anônimo", "Sem cadastro", "~3 min", "Instrumento validado"]}
        />

        <ComoFunciona />

        <section className="mb-12">
          <h2 className="mb-3 font-display text-2xl font-semibold text-foreground">
            O que é o MDQ?
          </h2>
          <p className="mb-3 leading-relaxed text-muted-foreground">
            O MDQ (Mood Disorder Questionnaire) é o instrumento de triagem mais usado no mundo
            para transtorno do espectro bipolar, com versão brasileira validada (Castelo et
            al., 2010). Ele rastreia períodos marcantes em que humor, energia e
            comportamento ficaram acima do habitual.
          </p>
          <p className="leading-relaxed text-muted-foreground">
            A triagem positiva considera três condições ao mesmo tempo: a quantidade de
            sinais, se eles ocorreram no mesmo período e se causaram problemas reais — é mais
            do que somar pontos.
          </p>
        </section>

        {/* Aviso — ilha clara deliberada (clinical-safety) */}
        <section className="mb-12 bg-amber-50 border border-amber-200 rounded-xl p-5">
          <h2 className="font-semibold text-amber-900 mb-2">Importante saber</h2>
          <p className="text-amber-800 text-sm leading-relaxed">
            O MDQ é um instrumento de <strong>triagem</strong>, não de diagnóstico. Uma
            triagem positiva significa apenas que vale conversar com um psiquiatra — só a
            avaliação completa, com sua história de vida, pode esclarecer o que esses
            períodos significam.
          </p>
        </section>

        <SymptomGrid
          title="Padrões que o MDQ rastreia"
          items={[
            "Períodos de ânimo muito acima do habitual",
            "Irritabilidade com brigas ou discussões",
            "Autoconfiança fora do comum",
            "Dormir muito menos sem sentir falta",
            "Falar mais ou mais rápido que de costume",
            "Pensamentos acelerados",
            "Muito mais energia e atividade",
            "Gastos ou comportamentos de risco incomuns",
          ]}
        />

        <section className="mb-12">
          <h2 className="mb-4 font-display text-2xl font-semibold text-foreground">
            Como o resultado é apresentado
          </h2>
          <p className="mb-4 leading-relaxed text-muted-foreground">
            O MDQ soma os "sim" nos 13 primeiros itens (escore 0–13), mas o escore
            sozinho não determina o resultado. A triagem positiva exige as três
            condições ao mesmo tempo:
          </p>
          <ol className="mb-4 list-decimal list-inside space-y-2 text-muted-foreground">
            <li>
              <span className="text-foreground font-medium">7 ou mais "sim"</span> nos 13 itens de humor e energia
            </li>
            <li>
              Os comportamentos ocorreram <span className="text-foreground font-medium">no mesmo período</span> (item 14)
            </li>
            <li>
              Causaram <span className="text-foreground font-medium">problemas moderados ou sérios</span> na sua vida (item 15)
            </li>
          </ol>
          <p className="text-sm text-muted-foreground">
            As faixas são do instrumento, não um veredito: só um profissional de saúde
            pode interpretar o seu resultado no seu contexto de vida.
          </p>
        </section>

        <QuandoProcurarAjuda />

        <FaqSection items={FAQS} />

        <CitationsBlock citations={CITATIONS} />

        <ReviewerBlock />

        <LandingCta
          title="Entenda seus períodos de humor e energia"
          ctaHref="/teste/mdq"
          ctaLabel="Começar o MDQ agora"
        />

        <OutrasTriagens current="/bipolaridade" />
      </main>
    </>
  );
}
