import type { Metadata } from "next";
import { Wine } from "lucide-react";
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
import { audit } from "@/lib/scales";

const PAGE_URL = `${SITE_URL}/alcool`;

export const metadata: Metadata = {
  title: "Teste de Alcoolismo Online Gratuito — AUDIT da OMS em Português",
  description:
    "Faça o AUDIT, o teste da OMS para avaliar o uso de álcool. Gratuito, anônimo, sem cadastro. Resultado instantâneo com devolutiva e orientações.",
  keywords: [
    "teste de alcoolismo",
    "AUDIT teste álcool",
    "quanto álcool é demais",
    "teste uso de álcool OMS",
    "triagem álcool online",
    "questionário álcool gratuito",
  ],
  alternates: { canonical: PAGE_URL },
  openGraph: {
    title: "Teste de Uso de Álcool — AUDIT (OMS)",
    description: "Triagem validada da OMS, anônima, resultado em 3 minutos.",
    url: PAGE_URL,
  },
};

const CITATIONS = [
  "Babor TF, Higgins-Biddle JC, Saunders JB, Monteiro MG. AUDIT — The Alcohol Use Disorders Identification Test. World Health Organization.",
  "Lima CT et al. — validação da versão brasileira do AUDIT (2005).",
  "Material SUPERA — SENAD/Ministério da Saúde (UNIFESP): AUDIT para uso na atenção primária.",
];

const FAQS: FaqItem[] = [
  {
    q: "O AUDIT diz se eu sou alcoólatra?",
    a: "Não. O AUDIT é um instrumento de triagem da OMS: ele estima o nível de risco do seu padrão de consumo (baixo risco, uso de risco, uso nocivo ou possível dependência). Só uma avaliação profissional pode diagnosticar qualquer condição.",
  },
  {
    q: "O teste é gratuito e anônimo mesmo?",
    a: "Sim. Não pedimos cadastro, e-mail nem cartão. Nada é gravado sem o seu consentimento explícito — e, mesmo com consentimento, só a escala, o escore e a faixa são salvos, de forma anônima.",
  },
  {
    q: "O que conta como 'uma dose'?",
    a: "Uma dose padrão equivale a uma lata de cerveja, uma taça de vinho ou uma dose de destilado. O teste usa essa referência nas perguntas sobre quantidade.",
  },
  {
    q: "Como funciona o escore do AUDIT?",
    a: "São 10 perguntas sobre os últimos 12 meses. O total vai de 0 a 40 e é classificado nas zonas definidas pela OMS: 0–7 baixo risco, 8–15 uso de risco, 16–19 uso nocivo e 20 ou mais, possível dependência.",
  },
  {
    q: "Bebo socialmente. Vale a pena fazer o teste?",
    a: "Sim — o AUDIT foi desenhado justamente para diferenciar o consumo de baixo risco do consumo que merece atenção, antes de virar um problema maior.",
  },
  {
    q: "E se o resultado indicar risco alto?",
    a: "O resultado vem com orientações de próximos passos. O CAPS AD oferece atendimento gratuito pelo SUS para questões com álcool, e o seu médico também pode orientar o caminho — sem julgamento.",
  },
];

export default function AlcoolPage() {
  return (
    <>
      <JsonLd
        data={medicalWebPageJsonLd({
          name: "Triagem de Uso de Álcool — AUDIT (OMS)",
          url: PAGE_URL,
          description:
            "Instrumento de triagem AUDIT, da Organização Mundial da Saúde, para avaliação do padrão de consumo de álcool.",
          conditionName: "Transtornos por uso de álcool",
          citations: CITATIONS,
        })}
      />
      <JsonLd data={faqJsonLd(FAQS)} />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Check-up Mental", url: SITE_URL },
          { name: "Teste de uso de álcool (AUDIT)", url: PAGE_URL },
        ])}
      />

      <main className="landing-aurora mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <LandingHero
          icon={<Wine className="h-9 w-9" aria-hidden />}
          eyebrow="Triagem gratuita · AUDIT (OMS)"
          title="Teste de uso de álcool online"
          lead="10 perguntas do AUDIT, o instrumento da Organização Mundial da Saúde para avaliar o padrão de consumo de álcool. Resultado em cerca de 3 minutos."
          ctaHref="/teste/audit"
          ctaLabel="Fazer teste agora — é gratuito"
          badges={["Anônimo", "Sem cadastro", "~3 min", "Instrumento da OMS"]}
        />

        <ComoFunciona />

        <section className="mb-12">
          <h2 className="mb-3 font-display text-2xl font-semibold text-foreground">
            O que é o AUDIT?
          </h2>
          <p className="mb-3 leading-relaxed text-muted-foreground">
            O AUDIT (Alcohol Use Disorders Identification Test) foi desenvolvido pela
            Organização Mundial da Saúde para identificar padrões de consumo de álcool que
            merecem atenção — do uso de risco à possível dependência. A versão brasileira é
            validada e amplamente usada na atenção primária do SUS.
          </p>
          <p className="leading-relaxed text-muted-foreground">
            São 10 perguntas sobre os últimos 12 meses: quantidade e frequência, sinais de
            dependência e problemas recentes relacionados ao álcool. O escore vai de 0 a 40,
            classificado nas zonas de risco da OMS.
          </p>
        </section>

        {/* Aviso — ilha clara deliberada (clinical-safety) */}
        <section className="mb-12 bg-amber-50 border border-amber-200 rounded-xl p-5">
          <h2 className="font-semibold text-amber-900 mb-2">Importante saber</h2>
          <p className="text-amber-800 text-sm leading-relaxed">
            O AUDIT é um instrumento de <strong>triagem</strong>, não de diagnóstico — e
            risco não é rótulo. Se o seu padrão de consumo estiver pesando, existe
            atendimento gratuito e sem julgamento pelo SUS (CAPS AD).
          </p>
        </section>

        <SymptomGrid
          title="O que o AUDIT avalia"
          items={[
            "Frequência e quantidade do consumo",
            "Episódios de beber seis ou mais doses",
            "Dificuldade de parar depois de começar",
            "Deixar de fazer o que era esperado por causa do álcool",
            "Beber pela manhã para se sentir bem",
            "Culpa ou remorso após beber",
            "Lapsos de memória relacionados à bebida",
            "Preocupação de outras pessoas com o seu consumo",
          ]}
        />

        <InterpretationSection scale={audit} />

        <QuandoProcurarAjuda />

        <FaqSection items={FAQS} />

        <CitationsBlock citations={CITATIONS} />

        <ReviewerBlock />

        <LandingCta
          title="Veja em que zona está o seu consumo"
          ctaHref="/teste/audit"
          ctaLabel="Começar o AUDIT agora"
        />

        <OutrasTriagens current="/alcool" />
      </main>
    </>
  );
}
