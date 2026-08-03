-- =============================================================================
-- Cérebro Amigo V3 — DDL base
-- Aplica sobre Postgres (RDS sa-east-1) com pgvector e pgcrypto habilitados.
-- Execute uma única vez num schema limpo.
-- =============================================================================

-- Extensões
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

-- =============================================================================
-- TENANCY
-- =============================================================================

CREATE TABLE clientes (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wa_id            TEXT UNIQUE,
    nome             TEXT,
    email            TEXT UNIQUE,
    contexto         JSONB,
    criado_em        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE usuarios (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email            TEXT UNIQUE NOT NULL,
    senha_hash       TEXT NOT NULL,
    nome             TEXT NOT NULL,
    role             TEXT NOT NULL DEFAULT 'admin',
    criado_em        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ultimo_login     TIMESTAMPTZ
);

CREATE TABLE medicos (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id       UUID NOT NULL REFERENCES usuarios(id),
    nome             TEXT NOT NULL,
    crm              TEXT NOT NULL,
    wa_id            TEXT,
    especialidade    TEXT NOT NULL DEFAULT 'psiquiatria',
    criado_em        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX medicos_usuario_id_idx ON medicos(usuario_id);

CREATE TABLE pacientes (
    -- cliente_id duplica como PK; paciente é sempre 1-para-1 com cliente.
    cliente_id             UUID PRIMARY KEY REFERENCES clientes(id),
    medico_responsavel_id  UUID NOT NULL REFERENCES medicos(id),
    cpf                    TEXT,
    data_nascimento        DATE,
    consentimento_lgpd_em  TIMESTAMPTZ,
    config_lembretes       TEXT NOT NULL DEFAULT '{}',
    criado_em              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX pacientes_medico_idx ON pacientes(medico_responsavel_id);

-- =============================================================================
-- CONVERSAÇÃO
-- =============================================================================

CREATE TABLE conversas (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id   UUID NOT NULL REFERENCES clientes(id),
    status       TEXT NOT NULL DEFAULT 'aberta',
    intencao     TEXT,
    criada_em    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX conversas_cliente_em_idx ON conversas(cliente_id, criada_em);

CREATE TABLE mensagens (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversa_id    UUID NOT NULL REFERENCES conversas(id),
    papel          TEXT NOT NULL, -- user | assistant | system
    conteudo       TEXT NOT NULL,
    modelo_usado   TEXT,
    tokens_in      INT,
    tokens_out     INT,
    custo_usd      NUMERIC(10, 6),
    criada_em      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX mensagens_conversa_em_idx ON mensagens(conversa_id, criada_em);

-- RAG futuro — embedding por paciente/tenant
CREATE TABLE conhecimento (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL,     -- medico_id como tenant
    conteudo    TEXT NOT NULL,
    embedding   vector(1536),
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX conhecimento_tenant_idx ON conhecimento(tenant_id);

-- Mensagens inbound crus (webhook WhatsApp legado / canal futuro)
CREATE TABLE inbound_messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canal       TEXT NOT NULL,
    payload     JSONB NOT NULL,
    processado  BOOL NOT NULL DEFAULT FALSE,
    recebido_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- CLÍNICO
-- =============================================================================

CREATE TABLE prescricoes (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id          UUID NOT NULL REFERENCES clientes(id),
    medico_id            UUID REFERENCES medicos(id),
    medicamento          TEXT NOT NULL,
    dose_descricao       TEXT NOT NULL,
    horarios             TIME[] NOT NULL DEFAULT '{}',
    inicio_em            DATE NOT NULL DEFAULT CURRENT_DATE,
    fim_em               DATE,
    receita_tipo         TEXT,
    receita_validade     DATE,
    observacoes          TEXT,
    ativa                BOOL NOT NULL DEFAULT TRUE,
    criada_em            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX prescricoes_paciente_idx ON prescricoes(paciente_id, ativa);

-- Audit trail de prescrições — append-only
CREATE TABLE prescricao_eventos (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id           UUID NOT NULL REFERENCES clientes(id),
    medico_id             UUID REFERENCES medicos(id),
    prescricao_id         UUID REFERENCES prescricoes(id),
    tipo                  TEXT NOT NULL, -- adicao | troca | ajuste | remocao
    medicamento           TEXT NOT NULL,
    medicamento_anterior  TEXT,
    motivo                TEXT,
    criado_em             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX prescricao_eventos_paciente_idx ON prescricao_eventos(paciente_id, criado_em);

CREATE TABLE tomadas_medicacao (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prescricao_id     UUID NOT NULL REFERENCES prescricoes(id),
    paciente_id       UUID NOT NULL REFERENCES clientes(id),
    horario_previsto  TIMESTAMPTZ NOT NULL,
    horario_real      TIMESTAMPTZ,
    status            TEXT NOT NULL DEFAULT 'pendente', -- pendente | tomada | esquecida | pulou
    nota_paciente     TEXT,
    criado_em         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX tomadas_paciente_horario_idx ON tomadas_medicacao(paciente_id, horario_previsto);

CREATE TABLE sintomas (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id    UUID NOT NULL REFERENCES clientes(id),
    humor          INT,             -- 1-10
    ansiedade      INT,             -- 1-10
    sono_horas     NUMERIC(4, 1),
    energia        INT,             -- 1-10
    nota           TEXT,
    registrado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX sintomas_paciente_em_idx ON sintomas(paciente_id, registrado_em);

CREATE TABLE eventos (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id  UUID NOT NULL REFERENCES clientes(id),
    titulo       TEXT NOT NULL,
    descricao    TEXT,
    intensidade  INT,
    criado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX eventos_paciente_em_idx ON eventos(paciente_id, criado_em);

CREATE TABLE consultas (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id  UUID NOT NULL REFERENCES clientes(id),
    medico_id    UUID REFERENCES medicos(id),
    inicia_em    TIMESTAMPTZ NOT NULL,
    modalidade   TEXT NOT NULL DEFAULT 'presencial', -- presencial | teleconsulta
    status       TEXT NOT NULL DEFAULT 'agendada',   -- agendada | confirmada | realizada | cancelada
    notas        TEXT,
    criado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX consultas_paciente_inicia_idx ON consultas(paciente_id, inicia_em);

-- Questionários clínicos padronizados (PHQ-9, GAD-7, etc.)
CREATE TABLE questionarios (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo      TEXT UNIQUE NOT NULL, -- phq9 | gad7
    nome        TEXT NOT NULL,
    ativo       BOOL NOT NULL DEFAULT TRUE,
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE questionarios_respostas (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id      UUID NOT NULL REFERENCES clientes(id),
    questionario_id  UUID NOT NULL REFERENCES questionarios(id),
    respostas        JSONB NOT NULL,
    score_total      INT,
    interpretacao    TEXT,
    respondido_em    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX questionarios_respostas_paciente_idx ON questionarios_respostas(paciente_id, respondido_em);

-- =============================================================================
-- CRISE E AUDITORIA (APPEND-ONLY — sem UPDATE/DELETE em massa)
-- =============================================================================

-- Criado exclusivamente pelo orchestrator-py quando protocolo de crise é acionado.
-- Gateway só lê (via timeline). Nunca deletar.
CREATE TABLE protocolos_crise_acionados (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id  UUID NOT NULL REFERENCES clientes(id),
    medico_id    UUID REFERENCES medicos(id),
    gatilho      TEXT NOT NULL,
    confianca    FLOAT NOT NULL DEFAULT 0,
    criado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX crise_paciente_em_idx ON protocolos_crise_acionados(paciente_id, criado_em);

-- Criado exclusivamente pelo orchestrator-py/agents-py. Gateway marca lida/nao-lida.
-- O conteúdo é append-only; apenas os flags de leitura são mutáveis.
CREATE TABLE notificacoes_medico (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    medico_id    UUID NOT NULL REFERENCES medicos(id),
    paciente_id  UUID REFERENCES clientes(id),
    severidade   TEXT NOT NULL DEFAULT 'atencao', -- critico | urgente | atencao | info
    tipo         TEXT NOT NULL,
    titulo       TEXT NOT NULL,
    mensagem     TEXT NOT NULL,
    lida         BOOL NOT NULL DEFAULT FALSE,
    lida_em      TIMESTAMPTZ,
    criada_em    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX notificacoes_medico_idx ON notificacoes_medico(medico_id, lida, criada_em DESC);

-- Registro de execuções dos agentes analíticos — append-only.
CREATE TABLE agente_execucoes (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id   UUID REFERENCES clientes(id),
    agente        TEXT NOT NULL,
    iniciado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    concluido_em  TIMESTAMPTZ,
    sucesso       BOOL,
    erro          TEXT,
    metadata      JSONB
);
CREATE INDEX agente_execucoes_paciente_idx ON agente_execucoes(paciente_id, iniciado_em);
CREATE INDEX agente_execucoes_agente_sucesso_idx ON agente_execucoes(agente, sucesso, iniciado_em);

-- =============================================================================
-- PORTAL DO PACIENTE
-- =============================================================================

CREATE TABLE pacientes_credenciais (
    paciente_id       UUID PRIMARY KEY REFERENCES clientes(id),
    email             TEXT NOT NULL,
    senha_hash        TEXT,
    senha_definida_em TIMESTAMPTZ,
    senha_temporaria  BOOL NOT NULL DEFAULT FALSE,
    falhas_seguidas   INT NOT NULL DEFAULT 0,
    bloqueado_ate     TIMESTAMPTZ,
    ultimo_login      TIMESTAMPTZ
);
CREATE UNIQUE INDEX pacientes_credenciais_email_idx ON pacientes_credenciais(email);

CREATE TABLE magic_links (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id  UUID NOT NULL REFERENCES clientes(id),
    token_hash   TEXT UNIQUE NOT NULL,
    proposito    TEXT NOT NULL DEFAULT 'primeiro_acesso', -- primeiro_acesso | recuperacao
    expira_em    TIMESTAMPTZ NOT NULL,
    usado_em     TIMESTAMPTZ,
    ip_uso       INET,
    criado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE diario_entradas (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id              UUID NOT NULL REFERENCES clientes(id),
    titulo                   TEXT,
    conteudo                 TEXT NOT NULL,
    humor                    INT,
    tags                     TEXT[] NOT NULL DEFAULT '{}',
    compartilhada_com_medico BOOL NOT NULL DEFAULT FALSE,
    criada_em                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizada_em            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX diario_paciente_em_idx ON diario_entradas(paciente_id, criada_em DESC);

CREATE TABLE acessos_paciente (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id  UUID NOT NULL REFERENCES clientes(id),
    acao         TEXT NOT NULL, -- login | magic_link_usado | senha_alterada
    ip           INET,
    user_agent   TEXT,
    criado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX acessos_paciente_idx ON acessos_paciente(paciente_id, criado_em DESC);

-- =============================================================================
-- CHECK-INS E PUSH
-- =============================================================================

CREATE TABLE checkins (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id    UUID NOT NULL REFERENCES clientes(id),
    tipo           TEXT NOT NULL, -- medicacao | humor_diario | questionario_phq9 | questionario_gad7
    payload        JSONB NOT NULL DEFAULT '{}',
    resposta       JSONB,
    agendado_para  TIMESTAMPTZ NOT NULL,
    enviado_em     TIMESTAMPTZ,
    respondido_em  TIMESTAMPTZ,
    expirado_em    TIMESTAMPTZ,
    criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX checkins_paciente_pendente_idx ON checkins(paciente_id, agendado_para)
    WHERE respondido_em IS NULL AND expirado_em IS NULL;

CREATE TABLE push_subscriptions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id    UUID NOT NULL REFERENCES clientes(id),
    endpoint       TEXT UNIQUE NOT NULL,
    p256dh_key     TEXT NOT NULL,
    auth_key       TEXT NOT NULL,
    user_agent     TEXT,
    revogada_em    TIMESTAMPTZ,
    ultimo_uso_em  TIMESTAMPTZ,
    criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE notificacoes_enviadas (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id           UUID NOT NULL REFERENCES clientes(id),
    push_subscription_id  UUID REFERENCES push_subscriptions(id),
    titulo                TEXT NOT NULL,
    corpo                 TEXT,
    enviada_em            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    entregue              BOOL
);

-- =============================================================================
-- IA ANALÍTICA
-- =============================================================================

CREATE TABLE insights (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id       UUID NOT NULL REFERENCES clientes(id),
    medico_id         UUID REFERENCES medicos(id),
    agente            TEXT NOT NULL, -- resumo_pre_consulta | adesao | risco_silencioso | padroes | diario
    titulo            TEXT NOT NULL,
    conteudo          TEXT NOT NULL,
    severidade        TEXT NOT NULL DEFAULT 'info', -- critico | urgente | atencao | info
    valido_ate        TIMESTAMPTZ,
    metadata          JSONB,
    visualizado_em    TIMESTAMPTZ,
    descartado_em     TIMESTAMPTZ,
    descartado_motivo TEXT,
    criado_em         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX insights_medico_pendente_idx ON insights(medico_id, criado_em DESC)
    WHERE descartado_em IS NULL;
CREATE INDEX insights_paciente_idx ON insights(paciente_id, criado_em DESC);

-- =============================================================================
-- CATÁLOGO
-- =============================================================================

-- Editor de prompts dos agentes analíticos (lido pelo agents-py)
CREATE TABLE agentes (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome           TEXT NOT NULL,
    system_prompt  TEXT NOT NULL,
    modelo_default TEXT NOT NULL DEFAULT 'sonnet',
    ativo          BOOL NOT NULL DEFAULT TRUE,
    atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Catálogo de medicamentos psiquiátricos (seed de dados, não gerado por LLM)
CREATE TABLE medicamentos (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome_comercial         TEXT,
    nome_generico          TEXT NOT NULL,
    classe_terapeutica     TEXT NOT NULL,
    indicacoes_resumo      TEXT,
    dosagens               TEXT[] NOT NULL DEFAULT '{}',
    formas_farmaceuticas   TEXT[] NOT NULL DEFAULT '{}',
    registro_anvisa        TEXT,
    laboratorio            TEXT,
    observacoes            TEXT,
    em_destaque            BOOL NOT NULL DEFAULT FALSE,
    ativo                  BOOL NOT NULL DEFAULT TRUE,
    criado_em              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX medicamentos_search_idx ON medicamentos(nome_generico, classe_terapeutica)
    WHERE ativo = TRUE;

-- =============================================================================
-- SEED: questionários padrão
-- =============================================================================
INSERT INTO questionarios (codigo, nome)
VALUES
    ('phq9', 'PHQ-9 — Escala de Depressão'),
    ('gad7', 'GAD-7 — Escala de Ansiedade Generalizada');
