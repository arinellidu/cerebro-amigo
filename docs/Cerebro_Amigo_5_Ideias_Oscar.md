# Cérebro Amigo V3 — 5 Ideias Transformadoras para Levar o Aplicativo ao OSCAR

> Documento de visão técnica e plano de implementação detalhado.
> Cada ideia inclui: contexto, arquitetura, modelo de dados, endpoints, telas, conformidade (LGPD/CFM) e roadmap.
>
> Junho 2026 · Confidencial

---

## Sumário Executivo

O Cérebro Amigo V3 já é um SaaS vertical completo para psiquiatria: prontuário, prescrição (Memed), teleconsulta P2P, IA conversacional (LangGraph + Bedrock), protocolo de crise, check-ins, diário do paciente, RAG sobre a história clínica, monitoramento de exames, measurement-based care e agora uma rede social exclusiva para médicos verificados por CRM.

As 5 ideias a seguir foram selecionadas por maximizar o diferencial competitivo, reaproveitar a infraestrutura existente (AWS Bedrock, .NET gateway, Python AI services, Next.js BFF) e endereçar lacunas que nenhum concorrente brasileiro cobre hoje.

| # | Ideia | Impacto | Esforço | Prioridade |
|---|-------|---------|---------|------------|
| 1 | Ambient AI Scribe | Máximo | Médio | 1º — já tem as peças |
| 2 | Predição de Crise (Early Warning) | Máximo | Alto | 2º — precisa dados |
| 3 | Terapia Digital (DTx) | Alto | Médio | 3º — retenção |
| 4 | FHIR + RNDS | Alto | Alto | Estratégico |
| 5 | Outcomes & Pesquisa Clínica | Máximo | Alto | Depende de massa |

---

## 1. Ambient AI Scribe — Transcrição + Nota Clínica Automática

### 1.1 Contexto e Problema

Psiquiatras gastam em média 15–20 minutos após cada consulta preenchendo evolução, CID-10, ajustes de medicação e plano terapêutico. Em 8 consultas por dia, são ~2h perdidas em burocracia. A teleconsulta do Cérebro Amigo (ADR-026, migration 0021_teleconsulta_video) já captura áudio bidirecional — mas hoje ele é descartado após a chamada.

### 1.2 Solução

Capturar o áudio da teleconsulta em streaming, transcrever em tempo real via **AWS Transcribe Medical** (pt-BR, vocabulário psiquiátrico custom), e ao final gerar automaticamente uma **evolução estruturada SOAP** (Subjetivo, Objetivo, Avaliação, Plano) usando **Claude Sonnet via Bedrock** — incluindo CID-10 sugerido, medicações mencionadas e próximos passos. O médico revisa, edita se necessário, e aprova com um clique.

### 1.3 Arquitetura Técnica

**Fluxo de dados:**

1. **Cliente (Next.js)**: MediaRecorder captura áudio da teleconsulta WebRTC → envia chunks via WebSocket ao BFF.
2. **BFF (Route Handler)**: proxy WebSocket para o **orchestrator-py**.
3. **Orchestrator-py**: envia chunks ao **AWS Transcribe Medical Streaming** → recebe transcrição parcial em tempo real → emite via SSE ao front (legenda ao vivo).
4. **Ao encerrar a chamada**: orchestrator-py acumula transcrição completa → chama **Claude Sonnet (Bedrock)** com prompt SOAP + contexto do paciente (RAG) → retorna draft de evolução.
5. **Gateway (.NET)**: recebe a evolução draft, salva como **rascunho** na tabela de evoluções (status='rascunho'). Médico revisa no dashboard e aprova.

### 1.4 Modelo de Dados (nova migration)

```sql
CREATE TABLE transcricoes_consulta (
  id UUID PRIMARY KEY,
  consulta_id UUID NOT NULL REFERENCES consultas(id),
  medico_id UUID NOT NULL REFERENCES medicos(id),
  paciente_id UUID NOT NULL REFERENCES clientes(id),
  transcricao_completa TEXT NOT NULL, -- texto bruto
  evolucao_draft JSONB, -- SOAP estruturado gerado pela IA
  cid_sugerido TEXT[], -- ex: ['F32.1', 'F41.0']
  medicacoes_detectadas JSONB, -- [{nome, dose, acao}]
  status TEXT DEFAULT 'rascunho', -- rascunho | aprovado | descartado
  aprovado_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);
```

### 1.5 Endpoints

- **WS /api/v1/teleconsulta/{id}/transcricao** — stream de áudio → transcrição parcial (WebSocket)
- **GET /api/v1/consultas/{id}/transcricao** — transcrição completa + evolução draft
- **POST /api/v1/consultas/{id}/transcricao/aprovar** — médico aprova o draft → cria evolução oficial
- **POST /api/v1/consultas/{id}/transcricao/descartar** — descarta e permite edição manual

### 1.6 Telas (Next.js)

- **Teleconsulta (existente)**: adicionar painel lateral com legenda ao vivo (transcrição parcial em tempo real).
- **Pós-consulta**: tela de revisão com evolução SOAP gerada, CID-10 chips editáveis, medicações detectadas com checkboxes. Botão "Aprovar e salvar no prontuário".
- **Prontuário**: badge "Gerado por IA" na evolução aprovada, com link para a transcrição completa.

### 1.7 Conformidade

- **LGPD**: transcrição é dado de saúde categoria especial. Armazenada cifrada em repouso (ADR-018). Áudio bruto NÃO é armazenado — apenas a transcrição textual. Paciente consente antes da teleconsulta (checkbox obrigatório).
- **CFM**: a evolução é sempre revisada pelo médico. A IA nunca "fecha" o prontuário sozinha. Badge "assistido por IA" no registro.
- **Audit trail**: log imutável de quem gerou, quem aprovou, quando editou (ADR-017).

### 1.8 Estimativa de Esforço

| Componente | Estimativa |
|------------|-----------|
| AWS Transcribe Medical (streaming) | 3–5 dias |
| Prompt SOAP (Bedrock, orchestrator-py) | 2–3 dias |
| Migration + endpoints gateway | 2 dias |
| BFF + WebSocket proxy | 2 dias |
| UI legenda + revisão pós-consulta | 3–4 dias |
| Testes + compliance | 2 dias |
| **TOTAL** | **~15–20 dias úteis** |

---

## 2. Predição de Crise — Early Warning System com IA

### 2.1 Contexto e Problema

O Cérebro Amigo já detecta crises em andamento (ADR-006, CriseEndpoints, classificador fail-safe). Mas detectar crise DEPOIS que aconteceu é como o airbag: salva, mas o impacto já ocorreu. O real diferencial é **prever a crise antes dela acontecer** e permitir intervenção preventiva.

### 2.2 Solução

Sistema preditivo que analisa sinais longitudinais do paciente (humor diário, check-ins, adesão a medicação, padrão de linguagem no diário, frequência de interação) e calcula um **score de risco de crise** (0–100) atualizado diariamente. Quando o score cruza um threshold, o médico recebe alerta antecipado com os fatores de risco identificados.

### 2.3 Sinais (Features) do Modelo

- **Humor score** (já coletado): tendência descendente nos últimos 7/14/30 dias.
- **Adesão medicamentosa**: % de medicações tomadas vs prescritas (portal paciente).
- **Frequência de diário**: paciente que para de escrever é sinal de alerta.
- **Sentimento NLP**: análise de sentimento no texto do diário (Bedrock, Haiku para custo baixo).
- **Check-in completude**: abandono de check-ins = desengajamento.
- **Padrão de sono** (se coletado): desregulação circadiana.
- **Histórico de crises**: recorrência temporal (sazonalidade, gatilhos conhecidos).
- **Mudança de medicação recente**: janela de risco pós-troca.

### 2.4 Arquitetura

**Job diário (agents-py / APScheduler)**: para cada paciente ativo, coleta features dos últimos 30 dias → passa pelo modelo (regressão logística inicialmente, depois gradient boosting ou LSTM) → salva score na tabela `risco_crise_scores`. Se score > threshold (configurável por médico, default 70), dispara notificação via **notifier-py** (push + e-mail) e cria entrada na **fila de atenção** (FilaAtencaoEndpoints).

### 2.5 Modelo de Dados

```sql
CREATE TABLE risco_crise_scores (
  id UUID PRIMARY KEY,
  paciente_id UUID NOT NULL REFERENCES clientes(id),
  medico_id UUID NOT NULL REFERENCES medicos(id),
  score INT NOT NULL CHECK (score BETWEEN 0 AND 100),
  fatores JSONB NOT NULL, -- [{fator, peso, valor_atual}]
  threshold INT NOT NULL DEFAULT 70,
  alerta_emitido BOOLEAN DEFAULT FALSE,
  data_referencia DATE NOT NULL,
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(paciente_id, data_referencia)
);
```

### 2.6 Telas

- **Dashboard do médico**: card "Pacientes em risco" com lista ordenada por score. Cores: verde (<40), amarelo (40–70), vermelho (>70).
- **Perfil do paciente**: gráfico temporal do score de risco (sparkline 30 dias). Fatores de risco com barras de contribuição.
- **Configuração**: médico ajusta threshold por paciente. Toggle ligar/desligar predição.
- **Alerta**: notificação push + card na fila de atenção: "João — score 82 — queda de humor + abandono de medicação".

### 2.7 Conformidade

- O score é **auxiliar**, nunca substitui avaliação clínica. Label: "Estimativa estatística — confirmar com avaliação clínica".
- Médico no loop em toda decisão (regra #4).
- Log imutável de scores e alertas (regra #5).
- NLP no diário usa Haiku (custo baixo) com prompt que NÃO gera diagnóstico — só score de sentimento.

### 2.8 Estimativa

**~25–30 dias úteis**

---

## 3. Terapia Digital (DTx) — Exercícios Guiados no Portal do Paciente

### 3.1 Contexto

Digital Therapeutics (DTx) são intervenções terapêuticas entregues via software, baseadas em evidência. A FDA já aprovou DTx para depressão (Freespira), insônia (Somryst) e abuso de substâncias (reSET). No Brasil, não existe SaaS psiquiátrico com DTx integrado ao prontuário.

### 3.2 Solução

Módulo de exercícios guiados no portal do paciente (`/p/terapia`), prescrito pelo médico como parte do plano terapêutico. Modalidades iniciais:

- **TCC (Terapia Cognitivo-Comportamental)**: registro de pensamentos automáticos, reestruturação cognitiva, exposição gradual.
- **DBT (Terapia Comportamental Dialética)**: mindfulness, tolerância ao desconforto, regulação emocional, eficácia interpessoal.
- **Psicoeducação**: módulos interativos sobre depressão, ansiedade, bipolaridade, TDAH — linguagem acessível.
- **Mindfulness guiado**: áudio de meditação (5/10/15min), respiração, body scan.
- **Ativação comportamental**: planejamento de atividades prazerosas, registro de progresso.

### 3.3 Modelo de Dados

```sql
-- Catálogo de exercícios (administrado)
CREATE TABLE dtx_exercicios (
  id UUID PRIMARY KEY,
  modalidade TEXT NOT NULL, -- tcc | dbt | psicoeducacao | mindfulness | ativacao
  titulo TEXT NOT NULL,
  descricao TEXT,
  conteudo JSONB NOT NULL, -- steps, perguntas, audio_url
  duracao_min INT,
  ordem INT DEFAULT 0,
  ativo BOOLEAN DEFAULT TRUE
);

-- Prescrição de protocolo DTx pelo médico
CREATE TABLE dtx_prescricoes (
  id UUID PRIMARY KEY,
  medico_id UUID REFERENCES medicos(id),
  paciente_id UUID REFERENCES clientes(id),
  modalidade TEXT NOT NULL,
  frequencia TEXT DEFAULT 'diaria', -- diaria | semanal | livre
  inicio DATE, fim DATE,
  notas TEXT,
  status TEXT DEFAULT 'ativa',
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

-- Sessões realizadas pelo paciente
CREATE TABLE dtx_sessoes (
  id UUID PRIMARY KEY,
  prescricao_id UUID REFERENCES dtx_prescricoes(id),
  exercicio_id UUID REFERENCES dtx_exercicios(id),
  paciente_id UUID REFERENCES clientes(id),
  respostas JSONB, -- respostas do paciente aos steps
  duracao_s INT, -- tempo gasto
  humor_antes INT, humor_depois INT, -- 1-10
  completou BOOLEAN DEFAULT FALSE,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.4 Telas do Paciente (`/p/terapia`)

- **Home DTx**: exercícios do dia (prescritos), streak de dias consecutivos, progresso semanal.
- **Exercício**: wizard step-by-step (texto, inputs, escala de humor antes/depois).
- **Mindfulness**: player de áudio com timer, animação de respiração.
- **Histórico**: calendário com sessões realizadas, gráfico de humor pré/pós.

### 3.5 Tela do Médico

No perfil do paciente: aba "Terapia Digital" com adesão (%), exercícios completados, evolução do humor pré/pós, e botão para prescrever novo protocolo DTx.

### 3.6 Monetização

- **Plano starter**: 1 módulo de psicoeducação gratuito.
- **Plano pro**: todos os módulos de TCC, DBT, mindfulness.
- **Plano enterprise**: módulos customizáveis pela clínica + white-label.

### 3.7 Estimativa

**~20–25 dias úteis**

---

## 4. Interoperabilidade FHIR R4 + RNDS

### 4.1 Contexto

A RNDS (Rede Nacional de Dados em Saúde) é a plataforma do Ministério da Saúde para interoperabilidade de dados clínicos no Brasil, baseada no padrão **FHIR R4**. A adesão está se tornando progressivamente obrigatória (já é para vacinas e exames laboratoriais). Nenhum SaaS psiquiátrico brasileiro está integrado à RNDS hoje.

### 4.2 Solução

Integração bidirecional com a RNDS:

- **Importar**: resultados de exames laboratoriais (hemograma, TSH, lítio sérico, função hepática) do SUS → alimentar monitoramento de exames (migration 0023).
- **Importar**: sumário de atendimentos prévios (Encounter/Condition) → enriquecer RAG da história clínica.
- **Exportar**: sumário de alta / evolução estruturada → contribuir com o prontuário nacional.
- **Validar**: interações medicamentosas cruzando prescrição Cérebro Amigo com medicações ativas na RNDS.

### 4.3 Arquitetura

**Novo serviço: `fhir-bridge-py`** (Python, FastAPI) — microserviço dedicado à tradução FHIR ↔ modelo interno. Comunica-se com o gateway via INTERNAL_API_TOKEN. Certificado ICP-Brasil (e-CNPJ) para autenticação na RNDS.

1. **Autenticação**: OAuth2 com certificado digital ICP-Brasil → token de acesso RNDS.
2. **Busca**: GET FHIR Patient (por CPF) → Observation, DiagnosticReport, MedicationStatement.
3. **Tradução**: FHIR Resource → modelo interno (exames_resultados, medicacoes, etc.).
4. **Exportação**: evolução aprovada → FHIR Encounter + Condition + MedicationRequest → POST RNDS.
5. **Validação**: comparar MedicationStatement (RNDS) × prescrição local → alertar interações.

### 4.4 Recursos FHIR Mapeados

| FHIR Resource | Tabela Cérebro Amigo | Direção |
|---------------|---------------------|---------|
| Patient | clientes | Import |
| Observation (lab) | exames_resultados (0023) | Import |
| DiagnosticReport | exames_resultados | Import |
| MedicationStatement | medicacoes | Import + Validação |
| Encounter | consultas + evolucoes | Export |
| Condition (CID-10) | evolucoes.cid | Export |
| MedicationRequest | prescricoes (Memed) | Export |

### 4.5 Conformidade

- Certificação **SBIS** (Sociedade Brasileira de Informática em Saúde) facilita licitações e credibilidade.
- Certificado **ICP-Brasil** (e-CNPJ) obrigatório para autenticar na RNDS.
- Dados importados cifrados em repouso (ADR-018). CPF minimizado (hash ou parcial no log).
- Consentimento do paciente para buscar dados na RNDS (LGPD Art. 11).

### 4.6 Estimativa

**~30–40 dias úteis** (inclui certificação)

---

## 5. Plataforma de Outcomes & Pesquisa Clínica

### 5.1 Contexto

O Cérebro Amigo acumula dados clínicos longitudinais valiosos: diagnósticos (CID-10), medicações, scores de escalas (PHQ-9, GAD-7 via measurement-based care), evolução, check-ins, humor. Hoje esses dados servem apenas ao médico individual. O valor agregado e anonimizado desses dados é **enorme** para pesquisa clínica, decisões baseadas em evidência, e como diferencial competitivo.

### 5.2 Solução

Dashboard de **outcomes populacionais** (dados anonimizados e agregados) acessível a médicos verificados na rede social. Funcionalidades:

- **Eficácia por medicamento**: melhoria média no PHQ-9/GAD-7 por medicação, dose e diagnóstico. _"Escitalopram 10mg em F32.1: redução média de 6.2 pontos no PHQ-9 em 8 semanas (n=342)"_.
- **Tempo até remissão**: curvas de Kaplan-Meier por diagnóstico e tratamento.
- **Taxa de abandono**: % de pacientes que param o acompanhamento por faixa etária, diagnóstico, tempo de tratamento.
- **NNT (Number Needed to Treat)**: para cada combinação medicação+diagnóstico.
- **Benchmarking**: médico vê seus outcomes vs média da plataforma (anonimizado). _"Seus pacientes com F41.0 melhoram 20% mais rápido que a média"_.
- **Insights para a rede social**: médicos podem publicar análises baseadas em dados reais (com gráficos gerados pela plataforma).

### 5.3 Arquitetura

**Pipeline ETL (agents-py, job noturno)**:

1. Extrai dados clínicos (evoluções, escalas, medicações, diagnósticos).
2. Anonimiza: remove PII, generaliza idades (faixas), remove CEPs.
3. Agrega em **materialized views** no PostgreSQL (outcomes_por_medicacao, outcomes_por_diagnostico, etc.).
4. Dashboard lê views agregadas — NUNCA acessa dados individuais.

### 5.4 Modelo de Dados

```sql
-- Consentimento do paciente para uso anonimizado
ALTER TABLE clientes ADD COLUMN consentimento_pesquisa BOOLEAN DEFAULT FALSE;
ALTER TABLE clientes ADD COLUMN consentimento_pesquisa_em TIMESTAMPTZ;

-- View materializada (exemplo)
CREATE MATERIALIZED VIEW outcomes_medicacao AS
SELECT medicacao, dose, diagnostico_cid,
  count(*) AS n,
  avg(score_final - score_inicial) AS delta_medio,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY semanas_ate_remissao) AS mediana_semanas
FROM (... join anonimizado ...) GROUP BY 1,2,3
HAVING count(*) >= 30; -- mínimo para significância
```

### 5.5 Telas

- **/rede/outcomes**: dashboard com filtros (diagnóstico, medicação, período). Gráficos de barras, Kaplan-Meier, heatmaps.
- **Benchmarking pessoal**: card no dashboard do médico: "Seus outcomes vs plataforma".
- **Publicar na rede social**: botão "Compartilhar insight" que gera post com gráfico embedado.

### 5.6 Conformidade

- **LGPD Art. 7, §4** e **Art. 11, II, c**: dados anonimizados para pesquisa não precisam de consentimento específico. Mas como boa prática, pedimos consentimento opt-in do paciente.
- **K-anonymity**: mínimo de 30 pacientes por grupo para publicar estatística (impede re-identificação).
- **Audit trail**: log de quem acessou qual view, quando.
- Dashboard NUNCA mostra dados individuais — sempre agregados.

### 5.7 Monetização

- **Plano pro**: acesso a outcomes gerais + benchmarking pessoal.
- **Plano enterprise**: filtros avançados, exportação de relatórios, API de dados agregados.
- **Licenciamento B2B**: venda de dados agregados anonimizados para indústria farmacêutica (Real World Evidence — RWE), universidades e seguradoras. Receita recorrente de alto valor.

### 5.8 Estimativa

**~35–45 dias úteis**

---

## Roadmap Consolidado

Ordem sugerida de implementação, considerando dependências e retorno:

| Fase | Ideia | Prazo | Depende de | Retorno |
|------|-------|-------|-----------|---------|
| Q3 2026 | 1. Ambient AI Scribe | 15–20d | Teleconsulta (pronto) | Retenção + WOW |
| Q3 2026 | 3. DTx | 20–25d | Portal paciente (pronto) | Retenção + MRR |
| Q4 2026 | 2. Predição de Crise | 25–30d | Dados acumulados 3+ meses | Diferenciação clínica |
| Q4 2026 | 4. FHIR/RNDS | 30–40d | Certificado ICP-Brasil | Regulatório + licitações |
| Q1 2027 | 5. Outcomes | 35–45d | Massa de dados (~6 meses) | MRR enterprise + RWE |

## Stack Unificada (sem mudança)

Todas as 5 ideias rodam na stack existente:

- **Gateway**: .NET 10 (endpoints REST + SignalR)
- **IA**: Python (orchestrator-py, agents-py) + AWS Bedrock (Haiku/Sonnet/Opus)
- **Frontend**: Next.js 16 + React 19 + Tailwind 4 + shadcn/ui
- **DB**: PostgreSQL (RDS) + pgvector + pgcrypto
- **Infra**: AWS sa-east-1
- **Novo** (apenas ideia 4): fhir-bridge-py (FastAPI) + certificado ICP-Brasil

---

*Documento gerado em Junho 2026 · Cérebro Amigo V3 · Confidencial*
