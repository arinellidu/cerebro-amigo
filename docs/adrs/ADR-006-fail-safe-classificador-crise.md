# ADR-006: Fail-safe do classificador de crise

**Status:** Accepted
**Data:** 2026-05-21
**Decisores:** Equipe de engenharia + psiquiatra responsável clínico
**Categoria:** Segurança clínica

## Contexto

O classificador de crise (nó `detect_crisis` no grafo conversacional) é o
primeiro filtro de segurança do produto. Para cada mensagem do paciente,
ele decide: há sinal de risco de auto-extermínio, auto-lesão, ideação ativa
ou passiva, desesperança aguda? Se sim, o protocolo de crise dispara
(ver ADR-005); se não, o grafo segue para classificação de medicação,
extração de sintomas e geração de resposta.

A classificação é feita por uma chamada Claude Haiku com structured output,
configurada com `temperature=0`, timeout de 15s e `max_retries=2`.

**Em algum momento, esta chamada vai falhar.** Causas possíveis:
- Anthropic API indisponível ou degradada.
- Rate limiting (429).
- Timeout de rede.
- Output do modelo não conformante ao schema (raríssimo com Claude, mas
  possível).
- Bug em biblioteca cliente.
- Falha de credencial (chave expirada, rotacionada incorretamente).

A pergunta de design é: **quando o classificador falha tecnicamente,
qual o comportamento padrão?**

Há essencialmente dois polos:

- **Fail-open**: assumir "não é crise" e seguir o fluxo normal (resposta
  gerada via Sonnet, persistência de sintomas, etc.).
- **Fail-closed**: assumir "é crise" e disparar protocolo + notificar
  médico.

## Decisão

**Fail-closed. Quando o classificador de crise falha por qualquer motivo
técnico, o sistema assume `crise_detectada=True` com `nivel="alto"`,
`confianca=0.0` e `gatilhos=["classifier_error"]`.**

Isso dispara:
- Protocolo de crise (texto fixo ao paciente).
- Notificação ao médico (severidade=critica).
- Marcação da conversa como `humano`.
- Pausa da automação no paciente.

A trilha `protocolos_crise_acionados` registra normalmente, com
`gatilho='classifier_error'` permitindo distinguir auditorias futuras
entre acionamentos por classificação real vs. por falha técnica.

A implementação atual já segue esta política:

```python
async def detect_crisis(state: ConversaState) -> dict:
    llm = with_schema(haiku(), CrisisDetectionOutput)
    try:
        result: CrisisDetectionOutput = await llm.ainvoke([...])
    except Exception as exc:
        # Fail-safe: classificador falhou → trata como crise.
        logger.exception("crisis.detect.failed", error=str(exc))
        return {
            "crise": {
                "detectada": True,
                "confianca": 0.0,
                "nivel": "alto",
                "gatilhos": ["classifier_error"],
            }
        }
    # ... caminho normal
```

## Alternativas consideradas

### Alternativa A — Fail-open (assumir não-crise)

**Argumento a favor:**

1. **Reduz falsos positivos.** A maioria das mensagens não é crise. Em
   uma falha técnica, o resultado mais provável estatisticamente é
   "não-crise".

2. **Não polui notificações do médico** com falsos alarmes técnicos.

3. **Não amedronta paciente** que enviou mensagem trivial com texto de
   crise inesperado.

**Por que rejeitamos:**

1. **Erro de Tipo II é catastrófico.** Falso negativo em detecção de
   risco de suicídio é o pior erro possível do sistema. Mesmo que
   apenas 1 em 10.000 falhas técnicas seja sobre uma crise real, esse
   1 caso justifica a política inteira.

2. **Falsos positivos são gerenciáveis.** O médico recebe notificação,
   verifica que foi falha técnica (gatilho `classifier_error` no DB),
   reabilita automação para o paciente. Tempo perdido: minutos. Custo
   emocional: baixo se o médico já entender o sistema.

3. **Mensagem de crise para paciente que não está em crise** é
   incômoda mas não causa dano clínico (texto é informativo e
   empático). Pior caso: paciente fica confuso e contata a
   psiquiatra. Aceitável.

4. **A trilha `gatilho='classifier_error'` permite triagem rápida.**
   Médico filtra notificações de crise por gatilho e identifica
   facilmente os disparos por falha técnica vs. detecção real.

### Alternativa B — Fail-open com retry agressivo

**Argumento a favor:** Tenta de novo várias vezes; só fail-open se
falhar todas.

**Por que rejeitamos:**

1. **Latência.** O paciente está esperando resposta. Cada retry
   adiciona 5-15s. Após 3 retries falhos, o paciente já passou um
   minuto sem feedback.

2. **Sem garantia.** Se o problema é estrutural (Anthropic API caída),
   retries não ajudam.

3. **A configuração atual já tem `max_retries=2`.** Isso já cobre
   falhas transientes. O fail-safe entra após esses retries falharem.

### Alternativa C — Modo degradado com classificador local (regex/lista
de palavras)

**Argumento a favor:** Quando o LLM falha, ainda dá pra fazer uma
checagem básica por palavras-chave de risco (`suicídio`, `me matar`,
`sumir`) e responder apropriadamente.

**Argumentos contra:**

1. **Falso senso de segurança.** Lista de palavras-chave para
   ideação suicida tem recall muito baixo em português brasileiro
   coloquial — pacientes usam metáforas, eufemismos, gírias regionais.
   "Tô afundando", "não vejo saída", "queria sumir" — nenhuma palavra
   óbvia.

2. **Complexidade adicional.** Manter lista de palavras-chave clinica
   é trabalho contínuo e específico de cada região/cultura.

3. **A política fail-closed atual é mais conservadora.** Mesmo essas
   mensagens metafóricas disparam o protocolo porque o classificador
   LLM funciona bem nelas — mas se o LLM falha, fail-closed protege
   mesmo essas.

A regex como fallback **antes** do LLM (não como substituto após falha)
pode ser considerada no futuro como camada extra — palavras
explícitas disparam crise mesmo sem chamar LLM, e o LLM continua
sendo a camada principal. Isto seria um ADR separado.

### Alternativa D — Encaminhar para humano imediatamente (sem texto fixo)

**Argumento a favor:** Em falha técnica, o paciente recebe "estamos com
instabilidade, sua psiquiatra entrará em contato" — sem disparar o
texto de crise.

**Por que rejeitamos parcialmente:**

1. **Em mensagem de risco real, o paciente precisa dos recursos
   imediatos** (CVV 188, SAMU 192). "Aguarde a psiquiatra" não basta
   quando há risco iminente.

2. **A confusão para o paciente é a mesma** (recebe mensagem inesperada
   em formato diferente do normal).

**Híbrido aceito:** o texto fixo de crise (ver ADR-005) já inclui
acolhimento + aviso ao médico + recursos imediatos. Em falha técnica,
enviar este texto cobre o caso real (se for crise) e é apenas levemente
incômodo no caso falso (não é crise). Cobertura do pior caso prevalece
sobre conforto no melhor caso.

## Consequências aceitas

1. **Falhas técnicas geram falsos positivos.** Cada falha do classificador
   é um acionamento de crise. Aceitamos como custo de segurança.

2. **O médico vai receber notificações que são "falhas técnicas".**
   Documentar claramente no dashboard/UX que `gatilho =
   'classifier_error'` significa "falha técnica, verificar e reabilitar
   automação se for o caso", separado visualmente de classificações
   reais.

3. **Métrica importante para monitorar:** taxa de
   `classifier_error` ao longo do tempo. Se subir, é sinal de problema
   estrutural com a integração Anthropic. Alerta em monitoring (não
   no dashboard clínico) quando passar de threshold (ex.: > 1% das
   chamadas em janela de 1h).

4. **Reabilitação após falsa crise.** O paciente fica com `automacao_pausada=true`
   até o médico desfazer. Em caso de falsa crise por falha técnica, o
   médico precisa de UI clara para reabilitar. Se o produto tiver
   muitos falsos positivos por falhas técnicas, UX fica ruim para
   médico — daí a importância da métrica do ponto 3.

5. **Não há fila para retry posterior automática.** Se a classificação
   falha, o sistema decide na hora (fail-closed) e segue. Não tenta
   reclassificar a mesma mensagem mais tarde. Aceitável — o objetivo
   é responder ao paciente agora, não otimizar para classificação
   tardia.

## Gatilhos de revisão

- **Taxa de `classifier_error` sustentadamente alta** (> 0.5% em
  janela mensal). Trigger para investigar root cause; pode justificar
  fallback Alternativa C como mitigação temporária se a degradação
  for crônica em algum provider.

- **Feedback clínico** consistente de que falsos positivos por falha
  técnica criam impacto operacional excessivo no médico. Possíveis
  ajustes: aumentar timeout, adicionar fallback técnico, ou aceitar
  modo "atrasar resposta + retry síncrono" antes de fail-closed.

- **Outro modelo (não-LLM) ter precisão equivalente ao Haiku.**
  Classificadores específicos de risco suicida em PT-BR podem
  surgir; se uma alternativa for confiável **e** local (sem
  dependência de API externa), o desenho fail-safe pode evoluir
  para "tenta LLM, fallback para classificador local, fail-closed só
  se ambos falharem".

- **Custo dos falsos positivos clínicos** ultrapassar o custo do
  esquema atual. Improvável, mas mensurável.

## Princípio guia

Esta decisão materializa o princípio: **em segurança clínica, custo
de falso positivo < custo de falso negativo**. Quando o sistema não
sabe, ele protege. Esta orientação é geral e se aplica também a outros
nós críticos no futuro (ex.: nó de auditoria de resposta também é
fail-closed: quando falha, escala para humano em vez de enviar
resposta não auditada).

## Referências

- `app/conversation/nodes/crisis.py` — implementação atual do
  fail-safe.
- ADR-005: texto fixo enviado quando o protocolo é acionado.
- ADR-002: arquitetura geral da camada conversacional.
- Princípio de "fail-safe" em design de sistemas críticos (engenharia
  de segurança).
