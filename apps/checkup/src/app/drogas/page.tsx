import type { Metadata } from "next";
import { Pill } from "lucide-react";
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

const PAGE_URL = `${SITE_URL}/drogas`;

export const metadata: Metadata = {
  title: "Teste de Uso de Drogas Online Gratuito — ASSIST da OMS em Português",
  description:
    "Faça o ASSIST, o teste da OMS que avalia o risco do uso de substâncias — maconha, cocaína, sedativos e outras. Gratuito, anônimo, resultado por substância.",
  keywords: [
    "teste de uso de drogas",
    "ASSIST teste OMS",
    "triagem uso de substâncias",
    "teste dependência química online",
    "risco uso de maconha cocaína",
    "questionário drogas gratuito",
  ],
  alternates: { canonical: PAGE_URL },
  openGraph: {
    title: "Teste de Uso de Substâncias — ASSIST (OMS)",
    description: "Triagem validada da OMS, anônima, resultado por substância.",
    url: PAGE_URL,
  },
};

const CITATIONS = [
  "WHO ASSIST Working Group. The Alcohol, Smoking and Substance Involvement Screening Test (ASSIST). Addiction, 2002.",
  "Henrique IFS et al. — validação da versão brasileira do ASSIST (Rev Assoc Med Bras, 2004).",
  "Material SUPERA — SENAD/Ministério da Saúde (UNIFESP).",
];

const FAQS: FaqItem[] = [
  {
    q: "O ASSIST diz se eu sou dependente químico?",
    a: "Não. O ASSIST é um instrumento de triagem da OMS: ele estima o nível de risco do seu padrão de uso, substância por substância (baixo, moderado ou alto). Só uma avaliação profissional pode diagnosticar qualquer condição.",
  },
  {
    q: "O teste é gratuito e anônimo mesmo?",
    a: "Sim — e aqui isso importa em dobro. Não pedimos cadastro, e-mail nem cartão; não registramos IP. Nada é gravado sem o seu consentimento explícito, e mesmo com consentimento só a faixa de risco é salva, de forma anônima.",
  },
  {
    q: "Quais substâncias o teste avalia?",
    a: "As 10 classes do instrumento da OMS: tabaco, álcool, maconha, cocaína/crack, anfetaminas/êxtase, inalantes, sedativos sem prescrição, alucinógenos, opioides e outras. Você responde apenas sobre as que já usou — o teste se adapta.",
  },
  {
    q: "Quanto tempo demora?",
    a: "Depende das suas respostas: quem nunca usou nenhuma substância termina em segundos; quem responde sobre 2 ou 3 substâncias leva de 3 a 5 minutos.",
  },
  {
    q: "Como funciona o resultado?",
    a: "Cada substância recebe um escore próprio, classificado nas faixas da OMS: risco baixo, moderado ou alto. O resultado mostra a tabela completa — e o PDF leva isso para a sua consulta.",
  },
  {
    q: "E se o resultado indicar risco alto?",
    a: "O resultado vem com orientações de próximos passos. O CAPS AD atende gratuitamente pelo SUS, sem julgamento — e interromper o uso abruptamente sem orientação pode ser arriscado para algumas substâncias, por isso a avaliação profissional vem primeiro.",
  },
];

export default function DrogasPage() {
  return (
    <>
      <JsonLd
        data={medicalWebPageJsonLd({
          name: "Triagem de Uso de Substâncias — ASSIST (OMS)",
          url: PAGE_URL,
          description:
            "Instrumento de triagem ASSIST, da Organização Mundial da Saúde, para avaliação do risco do uso de substâncias psicoativas.",
          conditionName: "Transtornos por uso de substâncias",
          citations: CITATIONS,
        })}
      />
      <JsonLd data={faqJsonLd(FAQS)} />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Check-up Mental", url: SITE_URL },
          { name: "Teste de uso de substâncias (ASSIST)", url: PAGE_URL },
        ])}
      />

      <main className="landing-aurora mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <LandingHero
          icon={<Pill className="h-9 w-9" aria-hidden />}
          eyebrow="Triagem gratuita · ASSIST (OMS)"
          title="Teste de uso de substâncias"
          lead="O instrumento da Organização Mundial da Saúde que avalia, substância por substância, o risco do seu padrão de uso. As perguntas se adaptam às suas respostas."
          ctaHref="/teste/assist"
          ctaLabel="Fazer teste agora — é gratuito"
          badges={["Anônimo", "Sem cadastro", "2–5 min", "Instrumento da OMS"]}
        />

        <ComoFunciona />

        <section className="mb-12">
          <h2 className="mb-3 font-display text-2xl font-semibold text-foreground">
            O que é o ASSIST?
          </h2>
          <p className="mb-3 leading-relaxed text-muted-foreground">
            O ASSIST (Alcohol, Smoking and Substance Involvement Screening Test) foi
            desenvolvido pela Organização Mundial da Saúde para estimar o risco associado ao
            uso de substâncias psicoativas. A versão brasileira é validada (Henrique et al.,
            2004) e usada nos materiais do Ministério da Saúde.
          </p>
          <p className="leading-relaxed text-muted-foreground">
            Diferente de outros testes, ele avalia cada substância separadamente: você indica
            o que já usou na vida e responde sobre os últimos 3 meses apenas das que se
            aplicam. Cada substância recebe um escore e uma faixa de risco — baixo, moderado
            ou alto.
          </p>
        </section>

        {/* Aviso — ilha clara deliberada (clinical-safety) */}
        <section className="mb-12 bg-amber-50 border border-amber-200 rounded-xl p-5">
          <h2 className="font-semibold text-amber-900 mb-2">Importante saber</h2>
          <p className="text-amber-800 text-sm leading-relaxed">
            O ASSIST é um instrumento de <strong>triagem</strong>, não de diagnóstico — e
            risco não é rótulo. Este espaço é anônimo e sem julgamento; se o uso de alguma
            substância estiver pesando, o CAPS AD atende <strong>gratuitamente</strong> pelo
            SUS.
          </p>
        </section>

        <SymptomGrid
          title="O que o ASSIST avalia, por substância"
          items={[
            "Frequência de uso nos últimos 3 meses",
            "Desejo forte ou urgência de consumir",
            "Problemas de saúde, sociais, legais ou financeiros",
            "Deixar de fazer o que era esperado",
            "Preocupação de pessoas próximas",
            "Tentativas de diminuir ou parar sem conseguir",
          ]}
        />

        {/* Interpretação — faixas da OMS (o ASSIST não usa o motor genérico) */}
        <section className="mb-12">
          <h2 className="mb-3 font-display text-2xl font-semibold text-foreground">
            Como interpretar as faixas
          </h2>
          <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
            <p>
              <strong className="text-foreground">Risco baixo</strong> — o padrão atual tem
              baixa probabilidade de causar problemas; vale manter a atenção.
            </p>
            <p>
              <strong className="text-foreground">Risco moderado</strong> — o padrão de uso
              já traz risco real de problemas de saúde e de outros prejuízos; uma conversa
              com profissional agora evita que cresça.
            </p>
            <p>
              <strong className="text-foreground">Risco alto</strong> — padrão compatível
              com uso de alta gravidade; avaliação profissional é o próximo passo, com
              prioridade.
            </p>
            <p className="text-xs">
              Os pontos de corte são os do instrumento da OMS (para álcool, as faixas são
              diferentes das demais substâncias). A interpretação final é sempre do
              profissional que avaliar o conjunto.
            </p>
          </div>
        </section>

        <QuandoProcurarAjuda />

        <FaqSection items={FAQS} />

        <CitationsBlock citations={CITATIONS} />

        <ReviewerBlock />

        <LandingCta
          title="Veja o risco do seu padrão de uso, substância por substância"
          ctaHref="/teste/assist"
          ctaLabel="Começar o ASSIST agora"
        />

        <OutrasTriagens current="/drogas" />
      </main>
    </>
  );
}
