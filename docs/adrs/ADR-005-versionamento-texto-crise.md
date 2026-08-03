# ADR-005: Versionamento e revisão do texto de crise

**Status:** Accepted
**Data:** 2026-05-21
**Decisores:** Equipe de engenharia + psiquiatra responsável clínico
**Categoria:** Segurança clínica

## Contexto

Quando o classificador detecta sinal de risco de auto-extermínio, auto-lesão,
ideação ativa ou desesperança aguda, o orchestrator dispara o **Protocolo
de Crise**. O paciente recebe um texto pré-aprovado contendo:

- Acolhimento explícito.
- Aviso de que a psiquiatra foi notificada.
- Recursos imediatos (CVV 188, SAMU 192).
- Orientação para situações de risco imediato.

**Este texto NÃO é gerado por LLM.** Ele é uma string constante no código,
versionada, com hash criptográfico, enviada literalmente ao paciente.

O motivo é simples: o conteúdo dessa mensagem pode salvar uma vida ou
agravar uma situação. Confiar em LLM para gerar texto em momento de
crise é inaceitável porque:

- LLMs alucinam (poderiam inventar um telefone errado, instruções
  inadequadas, ou tom contraindicado).
- LLMs derivam entre versões e atualizações de modelo, mudando
  comportamento sem notificação.
- O texto exige aprovação clínica e potencialmente revisão jurídica
  (ex.: se o produto futuramente recomendar serviços específicos por
  região).
- Em incidente, a equipe precisa poder responder exatamente que texto
  foi enviado, baseado em qual versão, aprovado por quem, quando.

A implementação atual vive em `app/conversation/crisis_copy.py` no
serviço orchestrator-py, com:

```python
@dataclass(frozen=True)
class CrisisCopy:
    versao: str
    texto: str
    hash_sha256: str

CRISIS_COPY = CrisisCopy(versao="v1", texto=_TEXTO_V1, hash_sha256=<auto>)
```

Cada acionamento grava em `protocolos_crise_acionados.metadata` (via
`notificacoes_medico`) o `copy_versao` e `copy_hash` da versão usada.

Este ADR formaliza como o texto é alterado e revisado.

## Decisão

**O texto de crise é um artefato controlado com processo de mudança
explícito:**

### 1. Princípios invioláveis

- O texto **nunca é gerado por LLM** em hipótese alguma, mesmo em
  variações regionais ou personalizações por médico.
- Cada versão tem identificador (`v1`, `v2`, ...) imutável e hash
  SHA-256 do conteúdo, ambos gravados no código fonte.
- Cada acionamento do protocolo registra qual versão foi enviada
  (campo `metadata` em `notificacoes_medico` e/ou coluna dedicada
  futura em `protocolos_crise_acionados`).

### 2. Processo de mudança

Para alterar o texto:

1. **Issue/RFC** descrevendo a motivação clínica da mudança
   (atualização de número do CVV, refinamento de tom, ajuste após
   feedback de paciente real, mudança regulatória).
2. **Proposta concreta** com texto novo + diff em relação ao atual.
3. **Revisão clínica** pela psiquiatra responsável clínico do produto.
   O nome da revisora, data e parecer formal devem ser registrados na
   PR (Pull Request) que implementa a mudança.
4. **Revisão jurídica** quando aplicável (ex.: se a mudança envolve
   menção a serviços de saúde específicos, recomendação de canal de
   atendimento, ou linguagem que pode ser interpretada como conselho
   clínico).
5. **PR de código** que:
   - Adiciona nova versão (`_TEXTO_V2`) preservando a anterior no
     histórico do arquivo.
   - Atualiza `CRISIS_COPY` para apontar para a nova.
   - O hash é recalculado automaticamente no `_versionar()` helper.
6. **Teste de regressão**: o dataset de eval de detecção de crise
   roda antes do merge — qualquer regressão na detecção é resolvida
   antes do deploy.
7. **Comunicação no log de release** explicitando "v1 → v2", com
   resumo da mudança e aprovação clínica.

### 3. Auditoria histórica

- Versões antigas permanecem no código (não são removidas) por pelo
  menos 5 anos, para que casos clínicos antigos possam ser
  reconstruídos exatamente.
- A trilha em `protocolos_crise_acionados` referencia `copy_versao +
  copy_hash`. Dado um incidente histórico, é possível recuperar o
  texto exato enviado àquele paciente naquele momento.

### 4. Restrição a mudanças automatizadas

Bots de dependência (Dependabot, Renovate) NÃO devem alterar este
arquivo. CI deve falhar PRs que modifiquem `crisis_copy.py` sem
aprovação de pessoa com papel `clinical-reviewer` no repositório.

(Implementação: CODEOWNERS específico para `crisis_copy.py` + label
obrigatório `clinical-reviewed` antes de merge.)

### 5. Variação por idioma e região

A versão atual (`v1`) é em português brasileiro com referências brasileiras
(CVV 188, SAMU 192). Se o produto for expandido para outros países ou
regiões com serviços diferentes, cada localização tem sua própria versão
versionada independentemente:

```
CRISIS_COPY_BR_V1
CRISIS_COPY_PT_V1
CRISIS_COPY_AR_V1
```

A seleção é feita no `crisis_protocol` baseado no `idioma` ou `regiao`
do `cliente`. Mas para a versão atual do produto (Brasil only), só
existe `CRISIS_COPY` (BR-PT).

## Alternativas consideradas

### Alternativa A — Permitir geração por LLM com guardrails

**Argumento a favor:** Texto mais natural e adaptado ao tom de cada
paciente.

**Por que rejeitamos absolutamente:**

1. **Risco clínico inaceitável.** Em crise, alucinação é catastrófica.
2. **Auditabilidade impossível.** Não há como provar regulatoriamente
   exatamente o que foi enviado se o modelo gerou na hora.
3. **Custo de "guardrails" superior ao benefício.** Para garantir que
   um texto gerado nunca alucine telefone, nunca contenha conselho,
   nunca mude tom, exigiria meta-modelo + revisão + retry — mais caro
   e menos confiável que uma string constante.

Esta alternativa não está em consideração séria. Foi listada apenas
para registrar formalmente que foi rejeitada.

### Alternativa B — Texto em DB editável pela psiquiatra via dashboard

**Argumento a favor:** Cada psiquiatra (multi-tenant) personaliza o
texto enviado aos seus pacientes.

**Argumentos contra:**

1. **Aumenta surface area de erro.** Qualquer edição via UI pode
   introduzir erro (telefone digitado errado, frase truncada) que
   chega a paciente em crise.
2. **Distribui responsabilidade clínica difusamente.** Hoje a equipe
   do produto + psiquiatra revisora respondem pela qualidade do texto.
   Com edição livre, responsabilidade migra para cada psiquiatra
   individualmente — não é o desenho de produto que queremos.
3. **Audit trail mais complicado.** Cada psiquiatra tem versão própria,
   tabela de versões por tenant, etc.

**Reconsideração futura:** quando o produto tiver muitos tenants em
regiões com necessidades distintas, vale revisitar. Mas mesmo assim,
provavelmente como **seleção entre versões pré-aprovadas pelo produto**
(menu de variantes), não edição livre.

### Alternativa C — Sem versionamento; mudanças são apenas commits no
arquivo

**Argumento a favor:** Mais leve. Git já é histórico.

**Por que rejeitamos:**

1. **Sem `copy_versao` no trace, fica difícil reconstruir incidente
   antigo.** Git tem histórico, mas reconciliar "qual era o texto em
   2027-03-15 às 14h22?" com o commit ativo nesse momento requer
   trabalho. Versão + hash no DB resolve isso direto.

2. **Hash permite verificar integridade.** Se alguém comprometesse o
   código fonte e mudasse o texto sem mudar a versão, o hash mudaria
   e seria detectável.

## Consequências aceitas

1. **Mudar o texto é processo deliberado, não trivial.** Aceitamos
   essa fricção como custo de segurança. Em casos urgentes
   (ex.: número do CVV mudou), o processo pode ser executado em horas,
   não dias.

2. **Versões antigas ficam no código.** Aumenta levemente o tamanho
   do arquivo ao longo do tempo. Aceitável — comentários separando
   versões mantêm legibilidade.

3. **Nenhuma personalização automática do texto.** Mesmo nome do
   paciente não é inserido. Texto é literal. Aceitamos perda de
   "personalização" em troca de garantia de literalidade.

4. **Adiciona um papel no time (clinical-reviewer).** Se a psiquiatra
   responsável estiver indisponível por dias, mudanças no texto ficam
   bloqueadas. Aceitável — é o desenho correto. Para urgência clínica
   real (ex.: erro grave no texto descoberto), processo de hotfix
   acelerado pode ser definido sem comprometer a revisão.

5. **CI/CD complica levemente.** CODEOWNERS + label requirement
   adicionam etapas. Aceitável.

## Gatilhos de revisão

- **Incidente onde texto enviado se mostre clinicamente inadequado** —
  além de corrigir o texto via processo, revisar o processo de revisão
  em si para entender onde falhou.

- **Mudança regulatória obrigando texto específico ou recursos
  específicos** (ex.: novo número nacional de saúde mental, regulação
  da ANS, lei estadual). Trigger imediato.

- **Expansão multi-país** — exige extensão para variantes por região,
  ver seção 5.

- **Volume de tenants tornar inviável uma versão única para todos**
  — reconsiderar Alternativa B numa versão restrita (menu de
  variantes, não edição livre).

## Referências

- `app/conversation/crisis_copy.py` — implementação atual.
- ADR-006: fail-safe do classificador — complemento à decisão de como
  responder quando a classificação falha tecnicamente.
- ABP (Associação Brasileira de Psiquiatria) — guidelines sobre
  comunicação em crise.
- CFM (Conselho Federal de Medicina) — Resolução 2.317/2022 sobre
  telemedicina e responsabilidade clínica.
