import type { Devolutiva, DevolutivaInput } from "./types";

// Fallbacks estáticos revisados — produto, não emergência.
// Ativados quando IA falha, resposta inválida ou contém conteúdo proibido.
const PHQ9_FALLBACKS: Record<string, Devolutiva> = {
  minimal: {
    acolhimento: "Você deu um passo importante ao parar para verificar como está se sentindo.",
    leitura: [
      "Seus resultados sugerem sintomas mínimos de depressão nas últimas duas semanas.",
      "O PHQ-9 é um instrumento de triagem que mede frequência de sintomas — não é um diagnóstico.",
    ],
    limites: "Esta triagem não substitui uma avaliação por profissional de saúde.",
    proximos_passos: [
      "Continue observando como você se sente nas próximas semanas.",
      "Se notar mudanças, considere conversar com seu médico ou um psicólogo.",
    ],
  },
  mild: {
    acolhimento: "Reconhecer que algo não está bem já é um ato de cuidado consigo mesmo.",
    leitura: [
      "Seus resultados sugerem sintomas leves de depressão nas últimas duas semanas.",
      "Sintomas leves são comuns em períodos de estresse e merecem atenção — não ignorar.",
    ],
    limites: "Esta triagem não substitui uma avaliação por profissional de saúde.",
    proximos_passos: [
      "Conversar com seu médico de confiança é um bom próximo passo.",
      "Atenção ao sono, rotina e momentos de descanso podem ajudar.",
      "Se os sintomas persistirem por mais de duas semanas, procure apoio profissional.",
    ],
  },
  moderate: {
    acolhimento: "Você fez bem em parar e verificar. O que você está sentindo tem nome e tem tratamento.",
    leitura: [
      "Seus resultados sugerem sintomas moderados de depressão nas últimas duas semanas.",
      "Sintomas moderados costumam afetar o dia a dia — trabalho, relações, disposição.",
    ],
    limites: "Esta triagem não substitui uma avaliação por profissional de saúde.",
    proximos_passos: [
      "Buscar uma avaliação com psiquiatra ou psicólogo é o passo mais importante agora.",
      "Conte para alguém de confiança como você está se sentindo.",
      "Se tiver plano de saúde, verifique a cobertura para saúde mental.",
    ],
  },
  moderately_severe: {
    acolhimento: "Você não precisa passar por isso sozinho. Buscar ajuda é a decisão certa.",
    leitura: [
      "Seus resultados sugerem sintomas moderadamente graves de depressão nas últimas duas semanas.",
      "Neste nível de sintomas, o apoio profissional faz uma diferença real.",
    ],
    limites: "Esta triagem não substitui uma avaliação por profissional de saúde.",
    proximos_passos: [
      "Marque uma consulta com psiquiatra o quanto antes — o UBS ou CAPS pode ser um caminho acessível.",
      "Não fique sozinho com isso: conte para alguém de confiança.",
      "Se tiver dificuldade de acesso, o CVV (188) oferece escuta 24 horas.",
    ],
  },
  severe: {
    acolhimento: "Você fez algo importante ao chegar até aqui. Merece cuidado — e ele está disponível.",
    leitura: [
      "Seus resultados sugerem sintomas graves de depressão nas últimas duas semanas.",
      "Sintomas graves merecem avaliação profissional urgente.",
    ],
    limites: "Esta triagem não substitui uma avaliação por profissional de saúde.",
    proximos_passos: [
      "Procure atendimento com psiquiatra o mais rápido possível — CAPS, UBS ou pronto-socorro.",
      "O CVV atende 24h pelo 188 e pelo chat em cvv.org.br.",
      "Conta para alguém próximo que você está passando por um momento difícil.",
    ],
  },
};

const GAD7_FALLBACKS: Record<string, Devolutiva> = {
  minimal: {
    acolhimento: "Parar para verificar como você está se sentindo é um cuidado que faz diferença.",
    leitura: [
      "Seus resultados sugerem sintomas mínimos de ansiedade nas últimas duas semanas.",
      "O GAD-7 avalia frequência de sintomas de ansiedade generalizada — não é um diagnóstico.",
    ],
    limites: "Esta triagem não substitui uma avaliação por profissional de saúde.",
    proximos_passos: [
      "Mantenha atenção aos seus níveis de estresse.",
      "Se notar aumento dos sintomas, considere conversar com um profissional.",
    ],
  },
  mild: {
    acolhimento: "Sentir ansiedade é humano — e cuidar disso também é.",
    leitura: [
      "Seus resultados sugerem sintomas leves de ansiedade nas últimas duas semanas.",
      "Sintomas leves podem se intensificar em períodos de pressão — vale observar.",
    ],
    limites: "Esta triagem não substitui uma avaliação por profissional de saúde.",
    proximos_passos: [
      "Técnicas de respiração e rotina regular de sono costumam ajudar.",
      "Se os sintomas persistirem, considere conversar com seu médico ou psicólogo.",
    ],
  },
  moderate: {
    acolhimento: "O que você sente tem solução — e pedir ajuda é o caminho mais direto.",
    leitura: [
      "Seus resultados sugerem sintomas moderados de ansiedade nas últimas duas semanas.",
      "Em nível moderado, a ansiedade costuma interferir no trabalho, nas relações e no sono.",
    ],
    limites: "Esta triagem não substitui uma avaliação por profissional de saúde.",
    proximos_passos: [
      "Conversar com psicólogo ou médico é o próximo passo mais importante.",
      "Anote o que dispara a ansiedade — pode ajudar na consulta.",
    ],
  },
  severe: {
    acolhimento: "Você não precisa carregar isso sozinho. Existem caminhos de melhora reais.",
    leitura: [
      "Seus resultados sugerem sintomas graves de ansiedade nas últimas duas semanas.",
      "Neste nível, o apoio profissional é o recurso mais eficaz disponível.",
    ],
    limites: "Esta triagem não substitui uma avaliação por profissional de saúde.",
    proximos_passos: [
      "Busque avaliação com psiquiatra ou psicólogo o quanto antes.",
      "CAPS e UBS oferecem atendimento em saúde mental pelo SUS.",
      "O CVV (188) oferece escuta 24h se você precisar de alguém para conversar agora.",
    ],
  },
};

// ASRS-18: SEM verdict (Mattos 2006 não tem cutoff validado p/ BR). Único fallback,
// independente do escore — nunca afirma triagem positiva/negativa.
const ASRS_FALLBACK: Devolutiva = {
  acolhimento: "Você fez bem em parar para observar como tem se sentido nos últimos meses.",
  leitura: [
    "O ASRS-18 é um instrumento que organiza sintomas frequentemente associados ao TDAH em adultos — desatenção, inquietação e impulsividade.",
    "Ele é um ponto de partida para uma conversa, não um diagnóstico: no Brasil ainda não há pontos de corte validados para interpretar a pontuação isoladamente.",
  ],
  limites:
    "Esta triagem não substitui uma avaliação por profissional de saúde, que considera história de vida, contexto e outros critérios.",
  proximos_passos: [
    "Leve suas respostas a um psiquiatra ou psicólogo para uma avaliação completa.",
    "Anote exemplos concretos do dia a dia que ajudem a ilustrar o que você percebe.",
  ],
};

// AUDIT — zonas da OMS. Linguagem de uso/risco, nunca "alcoolismo" como rótulo da pessoa.
const AUDIT_FALLBACKS: Record<string, Devolutiva> = {
  low_risk: {
    acolhimento: "Parar para olhar com honestidade para o próprio consumo já é um cuidado importante.",
    leitura: [
      "Seus resultados sugerem um padrão de consumo de álcool de baixo risco nos últimos 12 meses.",
      "O AUDIT é um instrumento de triagem da OMS — ele estima risco, não é um diagnóstico.",
    ],
    limites: "Esta triagem não substitui uma avaliação por profissional de saúde.",
    proximos_passos: [
      "Continue atento(a) a mudanças no seu padrão de consumo, especialmente em períodos de estresse.",
      "Se em algum momento o álcool começar a pesar, conversar com um profissional ajuda.",
    ],
  },
  risky_use: {
    acolhimento: "Responder com sinceridade sobre o próprio consumo exige coragem — você fez isso.",
    leitura: [
      "Seus resultados sugerem um padrão de consumo de risco nos últimos 12 meses.",
      "Consumo de risco significa que o padrão atual aumenta a chance de problemas de saúde — e que reduzir agora é mais fácil do que depois.",
    ],
    limites: "Esta triagem não substitui uma avaliação por profissional de saúde.",
    proximos_passos: [
      "Conversar com seu médico sobre o seu consumo é um próximo passo concreto.",
      "Observe as situações em que você mais bebe — esse registro ajuda muito na consulta.",
    ],
  },
  harmful_use: {
    acolhimento: "O que você está enfrentando tem caminho de cuidado — e começa com um passo como este.",
    leitura: [
      "Seus resultados sugerem um padrão de consumo nocivo nos últimos 12 meses.",
      "Nesse nível, o álcool provavelmente já está afetando sua saúde, suas relações ou suas responsabilidades.",
    ],
    limites: "Esta triagem não substitui uma avaliação por profissional de saúde.",
    proximos_passos: [
      "Procure uma avaliação profissional — seu médico, um psiquiatra ou o CAPS AD (atendimento gratuito pelo SUS).",
      "Conte para alguém de confiança que você quer cuidar disso — apoio próximo faz diferença.",
    ],
  },
  probable_dependence: {
    acolhimento: "Chegar até o fim deste teste com honestidade é um ato de coragem. Você não está sozinho(a) nisso.",
    leitura: [
      "Seus resultados sugerem sinais compatíveis com possível dependência de álcool.",
      "Dependência é uma condição de saúde — tem tratamento e tem equipe preparada para ajudar, sem julgamento.",
    ],
    limites: "Esta triagem não substitui uma avaliação por profissional de saúde.",
    proximos_passos: [
      "Procure avaliação o quanto antes: CAPS AD (gratuito pelo SUS), seu médico ou um psiquiatra.",
      "Evite parar de beber abruptamente por conta própria — a avaliação profissional orienta a forma segura.",
      "O CVV (188) oferece escuta 24h se você precisar conversar agora.",
    ],
  },
};

// Fagerström — graus de dependência de nicotina.
const FAGERSTROM_FALLBACKS: Record<string, Devolutiva> = {
  very_low: {
    acolhimento: "Olhar para o próprio hábito de fumar é o primeiro movimento de quem quer mudança.",
    leitura: [
      "Seus resultados sugerem um grau muito baixo de dependência de nicotina.",
      "Esse é um momento favorável: quanto menor a dependência, maior a chance de sucesso ao parar.",
    ],
    limites: "Esta triagem não substitui uma avaliação por profissional de saúde.",
    proximos_passos: [
      "Se quiser parar, seu médico ou a UBS podem orientar o caminho — o SUS tem programa gratuito de tratamento do tabagismo.",
      "Defina uma data para parar — ter um marco aumenta a chance de conseguir.",
    ],
  },
  low: {
    acolhimento: "Você deu um passo real ao medir o seu hábito — isso já muda a relação com ele.",
    leitura: [
      "Seus resultados sugerem um grau baixo de dependência de nicotina.",
      "Com apoio adequado, a maioria das pessoas nesse nível consegue parar.",
    ],
    limites: "Esta triagem não substitui uma avaliação por profissional de saúde.",
    proximos_passos: [
      "Procure o programa de tratamento do tabagismo do SUS (UBS) ou converse com seu médico.",
      "Identifique seus gatilhos — café, bebida, estresse — e planeje substitutos.",
    ],
  },
  medium: {
    acolhimento: "Reconhecer o tamanho do hábito é o que permite enfrentá-lo de verdade.",
    leitura: [
      "Seus resultados sugerem um grau médio de dependência de nicotina.",
      "Nesse nível, o apoio profissional aumenta bastante a chance de parar com sucesso.",
    ],
    limites: "Esta triagem não substitui uma avaliação por profissional de saúde.",
    proximos_passos: [
      "Procure seu médico ou a UBS — o tratamento do tabagismo pelo SUS é gratuito e funciona.",
      "Conte para pessoas próximas que você está tentando parar — apoio social pesa a favor.",
    ],
  },
  high: {
    acolhimento: "Você foi honesto(a) com algo difícil — e é exatamente assim que a mudança começa.",
    leitura: [
      "Seus resultados sugerem um grau elevado de dependência de nicotina.",
      "Dependência elevada não é falta de força de vontade — é uma condição que responde a tratamento.",
    ],
    limites: "Esta triagem não substitui uma avaliação por profissional de saúde.",
    proximos_passos: [
      "Procure avaliação profissional — seu médico ou o programa de tabagismo do SUS na UBS.",
      "Leve este resultado à consulta: ele ajuda o profissional a planejar o tratamento com você.",
    ],
  },
  very_high: {
    acolhimento: "Chegar até aqui já mostra que uma parte de você quer cuidar disso. Ela merece apoio.",
    leitura: [
      "Seus resultados sugerem um grau muito elevado de dependência de nicotina.",
      "Nesse nível, tentar parar sozinho(a) costuma ser muito difícil — e o acompanhamento profissional muda esse jogo.",
    ],
    limites: "Esta triagem não substitui uma avaliação por profissional de saúde.",
    proximos_passos: [
      "Procure seu médico ou a UBS o quanto antes — o SUS oferece tratamento gratuito e estruturado para o tabagismo.",
      "Marque a consulta antes de marcar a data de parar: o plano certo vem primeiro.",
    ],
  },
};

// MDQ — bipolaridade: rótulo sensível. SEMPRE estático (sem LLM, decisão ADR-048).
const MDQ_FALLBACKS: Record<string, Devolutiva> = {
  negative: {
    acolhimento: "Você dedicou um tempo para se conhecer melhor — isso tem valor em si.",
    leitura: [
      "Suas respostas não atingiram os critérios de triagem do MDQ.",
      "O MDQ rastreia períodos marcantes de humor e energia elevados — uma triagem negativa não descarta outras questões de humor que mereçam atenção.",
    ],
    limites: "Esta triagem não substitui uma avaliação por profissional de saúde.",
    proximos_passos: [
      "Se algo no seu humor ou energia ainda te preocupa, vale conversar com um profissional — mesmo com a triagem negativa.",
      "Considere fazer também a triagem de depressão (PHQ-9), se ainda não fez.",
    ],
  },
  positive: {
    acolhimento: "Você acaba de dar um passo importante — e o que vem agora tem caminho claro.",
    leitura: [
      "Suas respostas atingiram os critérios de triagem do MDQ, o que sugere que vale investigar variações de humor e energia com um especialista.",
      "Uma triagem positiva NÃO é um diagnóstico: só uma avaliação completa, com sua história de vida, pode esclarecer o que esses períodos significam.",
    ],
    limites: "Esta triagem não substitui uma avaliação por profissional de saúde.",
    proximos_passos: [
      "Procure um psiquiatra para uma avaliação completa — leve este resultado para a consulta.",
      "Anote exemplos dos períodos em que você se sentiu assim (quando, quanto tempo, o que aconteceu).",
      "Se estiver passando por um momento difícil agora, o CVV (188) oferece escuta 24h.",
    ],
  },
};

// MSI-BPD — sem cutoff validado p/ BR: fallback único, sem verdict (igual ASRS).
const MSI_BPD_FALLBACK: Devolutiva = {
  acolhimento: "Responder a perguntas tão pessoais com honestidade é um gesto de coragem e de autocuidado.",
  leitura: [
    "O MSI-BPD organiza padrões de emoções intensas, relações e impulsividade que merecem atenção quando causam sofrimento.",
    "Ele é um ponto de partida para uma conversa, não um diagnóstico: padrões como esses só podem ser compreendidos numa avaliação completa, com sua história de vida.",
  ],
  limites:
    "Esta triagem não substitui uma avaliação por profissional de saúde, que considera contexto, história e outros critérios.",
  proximos_passos: [
    "Leve suas respostas a um psiquiatra ou psicólogo para uma avaliação completa.",
    "Se as emoções estiverem muito intensas agora, o CVV (188) oferece escuta 24h, todos os dias.",
  ],
};

// ASSIST — uso de substâncias: tema sensível, SEMPRE estático (sem LLM, ADR-049).
// A banda é a PIOR faixa entre as substâncias; a tabela por substância é
// renderizada deterministicamente pela UI, nunca por texto gerado.
const ASSIST_FALLBACKS: Record<string, Devolutiva> = {
  low_risk: {
    acolhimento: "Responder com honestidade sobre uso de substâncias é um cuidado real consigo mesmo(a).",
    leitura: [
      "Suas respostas sugerem baixo risco relacionado ao uso de substâncias no momento.",
      "O ASSIST é o instrumento de triagem da OMS — ele estima risco por substância, não é um diagnóstico.",
    ],
    limites: "Esta triagem não substitui uma avaliação por profissional de saúde.",
    proximos_passos: [
      "Continue atento(a) a mudanças no seu padrão de uso, especialmente em períodos difíceis.",
      "Se algo mudar, conversar com um profissional de saúde é o melhor primeiro passo.",
    ],
  },
  moderate_risk: {
    acolhimento: "Olhar de frente para o próprio uso exige coragem — e você acabou de fazer isso.",
    leitura: [
      "Suas respostas sugerem risco moderado para pelo menos uma substância — o padrão atual merece atenção antes que cresça.",
      "Risco moderado significa que reduzir agora é mais fácil do que depois, e que apoio profissional acelera esse caminho.",
    ],
    limites: "Esta triagem não substitui uma avaliação por profissional de saúde.",
    proximos_passos: [
      "Converse com um profissional — seu médico ou o CAPS AD (atendimento gratuito pelo SUS, sem julgamento).",
      "Observe as situações em que o uso acontece — esse registro ajuda muito na consulta.",
    ],
  },
  high_risk: {
    acolhimento: "Chegar até o fim deste teste com honestidade é um ato de coragem. Você não está sozinho(a).",
    leitura: [
      "Suas respostas sugerem risco alto para pelo menos uma substância — um padrão que merece cuidado profissional agora.",
      "Isso é uma condição de saúde, com equipe preparada para ajudar sem julgamento — não uma falha sua.",
    ],
    limites: "Esta triagem não substitui uma avaliação por profissional de saúde.",
    proximos_passos: [
      "Procure avaliação o quanto antes: CAPS AD (gratuito pelo SUS), seu médico ou um psiquiatra.",
      "Evite interromper o uso abruptamente por conta própria — a avaliação profissional orienta a forma segura.",
      "O CVV (188) oferece escuta 24h se você precisar conversar agora.",
    ],
  },
};

const GENERIC_FALLBACK: Devolutiva = {
  acolhimento: "Você deu um passo importante ao parar para verificar como está.",
  leitura: [
    "Seus resultados foram registrados. Cada pessoa responde de um jeito diferente a instrumentos de triagem.",
    "Esta triagem avalia sintomas recentes — não é uma avaliação completa da sua saúde.",
  ],
  limites: "Esta triagem não substitui uma avaliação por profissional de saúde.",
  proximos_passos: [
    "Conversar com um profissional de saúde é sempre o melhor próximo passo.",
    "O CVV (188) oferece escuta 24h se você precisar.",
  ],
};

export function getFallback(input: DevolutivaInput): Devolutiva {
  if (input.scaleId === "asrs18") return ASRS_FALLBACK;
  if (input.scaleId === "msi_bpd") return MSI_BPD_FALLBACK;
  const maps: Record<string, Record<string, Devolutiva>> = {
    phq9: PHQ9_FALLBACKS,
    gad7: GAD7_FALLBACKS,
    audit: AUDIT_FALLBACKS,
    fagerstrom: FAGERSTROM_FALLBACKS,
    mdq: MDQ_FALLBACKS,
    assist: ASSIST_FALLBACKS,
  };
  return maps[input.scaleId]?.[input.band] ?? GENERIC_FALLBACK;
}
