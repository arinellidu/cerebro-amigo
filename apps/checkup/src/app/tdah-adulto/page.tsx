import type { Metadata } from "next";
import { Zap } from "lucide-react";
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
import { asrs18 } from "@/lib/scales";

const PAGE_URL = `${SITE_URL}/tdah-adulto`;

export const metadata: Metadata = {
  title: "Teste de TDAH Adulto Online — ASRS-18 em Português",
  description:
    "Faça a triagem de TDAH adulto com o ASRS-18, instrumento da OMS na versão brasileira validada. Gratuito, anônimo e sem cadastro.",
  keywords: [
    "teste TDAH adulto",
    "ASRS-18 português",
    "triagem TDAH online",
    "sintomas TDAH adulto",
    "déficit de atenção adulto",
    "hiperatividade adulto",
  ],
  alternates: { canonical: PAGE_URL },
  openGraph: {
    title: "Teste de TDAH Adulto — ASRS-18",
    description: "Triagem da OMS para TDAH em adultos, versão brasileira validada. Gratuito e anônimo.",
    url: PAGE_URL,
  },
};

const CITATIONS = [
  "Kessler RC et al. The World Health Organization Adult ADHD Self-Report Scale (ASRS). Psychol Med, 2005.",
  "Mattos P et al., Rev Psiq Clín, 2006 — adaptação transcultural brasileira do ASRS-18.",
  "Instrumento desenvolvido pela Organização Mundial da Saúde (OMS) — uso livre.",
];

const FAQS: FaqItem[] = [
  {
    q: "O ASRS-18 dá diagnóstico de TDAH?",
    a: "Não. O ASRS-18 é um instrumento de triagem, e o diagnóstico de TDAH em adultos exige avaliação clínica completa, feita por psiquiatra ou outro profissional habilitado — incluindo histórico desde a infância e impacto em diferentes áreas da vida.",
  },
  {
    q: "Por que o resultado não diz se eu tenho TDAH?",
    a: "Porque a versão brasileira do ASRS-18 (Mattos et al., 2006) não tem pontos de corte validados para a população do Brasil. Por isso esta triagem não classifica o resultado como positivo ou negativo: ela organiza suas respostas num registro estruturado para você levar a um profissional.",
  },
  {
    q: "O teste é gratuito e anônimo mesmo?",
    a: "Sim. Não pedimos cadastro, e-mail nem cartão. Nada é gravado sem o seu consentimento explícito — e, mesmo com consentimento, só a escala, o escore e a faixa são salvos, de forma anônima.",
  },
  {
    q: "Quanto tempo demora e como o teste é dividido?",
    a: "Cerca de 5 minutos. São 18 perguntas sobre os últimos 6 meses: a Parte A (9 itens) cobre desatenção e a Parte B (9 itens) cobre hiperatividade e impulsividade.",
  },
  {
    q: "A versão em português é validada?",
    a: "Sim. O ASRS-18 foi desenvolvido pela OMS e a versão brasileira foi publicada por Mattos et al. na Revista de Psiquiatria Clínica em 2006. Os itens usados aqui são transcritos dessa versão, sem paráfrase.",
  },
  {
    q: "TDAH em adultos existe mesmo?",
    a: "Sim. Estimativas apontam que cerca de 2,5% dos adultos vivem com TDAH, muitos sem diagnóstico. Sintomas como dificuldade de foco, impulsividade e desorganização persistentes podem afetar trabalho, estudos e relações.",
  },
];

export default function TDAHAdultoPage() {
  return (
    <>
      <JsonLd
        data={medicalWebPageJsonLd({
          name: "Triagem de TDAH Adulto — ASRS-18",
          url: PAGE_URL,
          description:
            "Instrumento de triagem ASRS-18 da OMS para TDAH em adultos.",
          conditionName: "Transtorno de déficit de atenção e hiperatividade (TDAH) em adultos",
          citations: CITATIONS,
        })}
      />
      <JsonLd data={faqJsonLd(FAQS)} />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Check-up Mental", url: SITE_URL },
          { name: "Teste de TDAH adulto (ASRS-18)", url: PAGE_URL },
        ])}
      />

      <main className="landing-aurora mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <LandingHero
          icon={<Zap className="h-9 w-9" aria-hidden />}
          eyebrow="ASRS-18 · OMS"
          title="Teste de TDAH para adultos"
          lead="Triagem com o ASRS-18, instrumento da OMS na versão brasileira validada (Mattos et al., 2006). 18 perguntas sobre os últimos 6 meses — um ponto de partida para conversar com um profissional, não um diagnóstico."
          ctaHref="/teste/asrs18"
          ctaLabel="Começar triagem"
          badges={["Anônimo", "Sem cadastro", "~5 min", "Instrumento da OMS"]}
        />

        <ComoFunciona />

        {/* O que é */}
        <section className="mb-12">
          <h2 className="mb-3 font-display text-2xl font-semibold text-foreground">
            O que é o ASRS-18?
          </h2>
          <p className="mb-3 leading-relaxed text-muted-foreground">
            O ASRS-18 (Adult ADHD Self-Report Scale) é um instrumento desenvolvido pela
            Organização Mundial da Saúde (OMS) para triagem de TDAH em adultos. A versão
            brasileira validada foi publicada por Mattos et al. (Rev Psiq Clín, 2006).
          </p>
          <p className="leading-relaxed text-muted-foreground">
            O instrumento avalia 18 sintomas em duas partes: a Parte A (9 itens) cobre
            desatenção e a Parte B (9 itens) cobre hiperatividade e impulsividade. Como ainda
            não há pontos de corte validados para a população brasileira, esta triagem
            organiza suas respostas para você levar a um profissional — sem dar um veredito.
          </p>
        </section>

        {/* Aviso — ilha clara deliberada (clinical-safety) */}
        <section className="mb-12 bg-amber-50 border border-amber-200 rounded-xl p-5">
          <h2 className="font-semibold text-amber-900 mb-2">TDAH em adultos é mais comum do que se pensa</h2>
          <p className="text-amber-800 text-sm leading-relaxed">
            TDAH não é exclusividade da infância — estima-se que cerca de 2,5% dos adultos
            vivem com o transtorno, muitos sem diagnóstico. Sintomas como dificuldade de foco,
            impulsividade e desorganização persistente podem afetar profundamente a vida
            profissional e pessoal.
          </p>
        </section>

        <SymptomGrid
          title="Sintomas que o ASRS-18 avalia"
          items={[
            "Dificuldade de manter atenção em tarefas longas",
            "Cometer erros por descuido",
            "Dificuldade de seguir instruções até o fim",
            "Dificuldade de se organizar",
            "Evitar tarefas que exigem esforço mental sustentado",
            "Perder objetos necessários com frequência",
            "Distrair-se facilmente com estímulos externos",
            "Esquecer compromissos do dia a dia",
            "Mexer as mãos ou os pés quando está sentado",
            "Impulsividade nas decisões ou nas falas",
          ]}
        />

        <InterpretationSection scale={asrs18} />

        <QuandoProcurarAjuda />

        <FaqSection items={FAQS} />

        <CitationsBlock citations={CITATIONS} />

        <ReviewerBlock />

        <LandingCta
          title="Organize o que você sente para levar a um profissional"
          ctaHref="/teste/asrs18"
          ctaLabel="Começar o ASRS-18 agora"
        />

        <OutrasTriagens current="/tdah-adulto" />
      </main>
    </>
  );
}
