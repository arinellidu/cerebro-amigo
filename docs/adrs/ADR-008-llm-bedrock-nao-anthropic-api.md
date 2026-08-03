# ADR-008: LLM via AWS Bedrock In-Region (sa-east-1), não ANTHROPIC_API_KEY

**Status:** Superseded by [ADR-015](ADR-015-llm-provider-switchavel.md)
**Data:** 2026-05-29
**Decisores:** Patrick Arinelli, Adonai Arinelli
**Categoria:** Stack / Compliance

> **Superseded (2026-06-01):** A premissa central deste ADR — residência de dado
> no Brasil via Bedrock In-Region — **não se concretiza** em `sa-east-1`: os
> perfis de inferência `global.` processam dados fora do BR e não há perfil
> in-region/Geo da América do Sul. Sem o ganho de residência, "Bedrock-only"
> deixa de se justificar. O [ADR-015](ADR-015-llm-provider-switchavel.md) torna a
> camada LLM provider-switchável (Anthropic API como default operacional;
> Bedrock vivo atrás de flag). O conteúdo abaixo é mantido para histórico.

## Contexto

O V2 do Cérebro Amigo consumia Claude diretamente via `ANTHROPIC_API_KEY`
(API da Anthropic, com endpoints `https://api.anthropic.com`). O dado de
inferência transitava para servidores fora do Brasil.

O V3 roda inteiramente na AWS, região `sa-east-1` (São Paulo). O sistema
processa dados de saúde mental — categoria especial de dado pessoal sob
a LGPD — e a empresa opera sob responsabilidade civil do médico titular.

Em 2024-2025, a Anthropic disponibilizou Claude 3.x e 4.x via **AWS Bedrock
In-Region**, inclusive na região `sa-east-1`, permitindo inferência com
Claude sem que os dados saiam do Brasil.

## Decisão

**Chamar Claude (Haiku, Sonnet, Opus 4.7) exclusivamente via AWS Bedrock
In-Region (sa-east-1), autenticado por IAM role da EC2. Não usar
`ANTHROPIC_API_KEY`.**

Concretamente:

- Autenticação: SigV4 via IAM role (produção) ou `AWS_PROFILE` (dev local).
  Sem API keys gerenciadas no código ou `.env`.
- SDK: `boto3` com `bedrock-runtime` client ou `langchain-aws` para
  integração LangGraph. Detalhes em
  `apps/orchestrator-py/references/bedrock-client.md`.
- Modelos (variáveis de ambiente):
  - `BEDROCK_MODEL_HAIKU`: detecção de crise, classificação, auditoria.
  - `BEDROCK_MODEL_SONNET`: extração de sintomas, resposta ao paciente.
  - `BEDROCK_MODEL_OPUS`: análise de padrões densa (agents-py, opcional).
- Região: `AWS_REGION=sa-east-1` / `BEDROCK_REGION=sa-east-1`.

## Alternativas consideradas

### Alternativa A — Manter ANTHROPIC_API_KEY (API direta da Anthropic)

**Argumento a favor:** Acesso direto ao modelo mais novo, sem intermediário
AWS. Menor latência teórica (sem hop Bedrock). Mais simples de configurar
em dev (uma variável vs IAM role).

**Por que rejeitamos:**

1. **Dado de inferência sai do Brasil.** A API da Anthropic processa
   requisições em servidores nos EUA. Para dado de saúde mental (LGPD
   Art. 11 — categoria especial), transferência internacional de dado
   exige consentimento explícito e salvaguardas específicas. Bedrock
   In-Region mantém o dado no Brasil, evitando toda essa carga regulatória.

2. **Gestão de API key é risco de segurança.** API keys vazam (commits,
   logs, variáveis de ambiente comprometidas). IAM roles com escopo
   mínimo de `bedrock:InvokeModel` e `bedrock:InvokeModelWithResponseStream`
   são revogáveis instantaneamente, auditáveis via CloudTrail, e sem
   segredo para vazar.

3. **Já estamos na AWS.** O produto usa EC2, RDS, Lambda, S3 na sa-east-1.
   Bedrock é mais uma integração na mesma plataforma, com billing
   consolidado, IAM unificado, e CloudWatch logs já configurados.

4. **Disponibilidade dos modelos confirmada.** Claude Haiku, Sonnet e
   Opus 4.7 estão disponíveis em sa-east-1 via Bedrock (verificado
   maio 2026). Não há diferença de capacidade relevante para nosso caso
   de uso.

### Alternativa B — Azure OpenAI (GPT-4o / GPT-4.1)

**Por que rejeitamos:**

1. **Produto já fechou a dependência Azure.** Azure Key Vault, Document
   Intelligence e Azure OpenAI foram removidos do V3 (decisão anterior
   à formalização deste ADR). Reintroduzir Azure OpenAI para LLM
   contradiria essa decisão e reintroduziria uma conta de cloud secundária.

2. **Qualidade inferior em PT-BR clínico.** Claude 3.x e 4.x consistentemente
   superam GPT-4o em nuance de português brasileiro e contexto clínico
   (benchmark interno, maio 2026). Para produto cujo diferencial é
   qualidade da IA clínica, trocar de modelo seria desvantagem competitiva.

3. **Sem ganho de compliance.** Azure também fica fora do Brasil
   (região `brazilsouth` tem latência e disponibilidade menores que
   `sa-east-1`). Residência de dado no Brasil não melhoraria.

### Alternativa C — Modelo self-hosted (Llama 3, Mixtral via Ollama/vLLM)

**Argumento a favor:** Zero custo de inferência (além da EC2), dado nunca
sai da instância, sem dependência de provedor externo.

**Por que rejeitamos:**

1. **Qualidade insuficiente para caso de uso clínico.** Detecção de crise,
   extração estruturada de sintomas e resposta empática em PT-BR clínico
   requerem um modelo frontier. Llama 3 70B e Mixtral 8x22B ficam
   visivelmente abaixo de Claude Sonnet em tarefas clínicas (avaliado
   internamente).

2. **Custo de infraestrutura real.** Rodar Llama 3 70B em velocidade
   aceitável exige g5.4xlarge+ (~US$1.6/hora). Bedrock com Haiku+Sonnet
   sai significativamente mais barato no nosso volume esperado.

3. **Manutenção de modelo é trabalho de engenharia de ML.** O produto
   é SaaS de psiquiatria, não plataforma de IA. Manter modelos
   atualizados, evitar regressões com novos pesos, gerenciar VRAM —
   isso compete com tempo de desenvolvimento de produto.

## Consequências aceitas

1. **IAM role em dev exige `AWS_PROFILE` configurado.** Desenvolvedores
   precisam de `~/.aws/credentials` com perfil que tenha permissão
   `bedrock:InvokeModel` em sa-east-1. Onboarding é mais complexo que
   "copiar a API key do Notion". Documentado em `docs/setup-guide.md`.

2. **Custo variável de inferência.** Bedrock cobra por token. SHADOW_MODE
   e roteamento Haiku/Sonnet/Opus por etapa mitigam custo. Monitorar
   via AWS Cost Explorer.

3. **Acoplamento à AWS.** Mudar de cloud exigiria trocar o client Bedrock.
   A migração seria limitada aos serviços Python — o resto do produto
   (EC2, RDS, Lambda) já está na AWS de qualquer forma.

4. **`ANTHROPIC_API_KEY` não existe mais no projeto.** Qualquer resíduo
   de V2 que a referencie é bug de migração — remover imediatamente.
   Grep: `git grep -r ANTHROPIC_API_KEY` deve retornar vazio.

## Gatilhos de revisão

- **Bedrock deixar de oferecer Claude em sa-east-1** ou remover modelos
  que usamos (improvável, mas monitorar).
- **LGPD ou ANS exigir processamento em datacenter específico** não
  coberto pela sa-east-1 da AWS.
- **Custo de inferência Bedrock crescer 5x** sem melhoria proporcional
  de performance (ponto de reavaliação de self-hosted).
- **Qualidade de modelo self-hosted alcançar Claude Sonnet** em benchmark
  clínico PT-BR sustentado por 6+ meses.

## Referências

- ADR-002: decisão de Python + LangGraph para a camada de IA.
- ADR-004: tratamento de LGPD em traces de LangSmith.
- `skill python-ai-services`: convenções de client Bedrock e roteamento
  de modelo por etapa.
- `apps/orchestrator-py/references/bedrock-client.md`: implementação
  do client.
