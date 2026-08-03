"""Configuração tipada do agents-py."""

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # App
    app_env: Literal["development", "staging", "production"] = "development"
    log_level: str = "INFO"
    agents_mode: Literal["scheduled", "manual"] = "scheduled"

    # ─── Cadências do scheduler (ADR-009) ─────────────────────────────────
    # Cada agente tem sua própria cadência em vez de um IntervalTrigger global.
    # Ajuste via variáveis de ambiente sem redeployar o código.

    # Fallback para jobs operacionais (gerador_checkins, gerador_questionarios).
    scheduler_interval_seconds: int = 300

    # Fuso para interpretar horários de check-in cadastrados pelo médico (DEBT
    # G-4). Os horários de prescrição são horários de parede LOCAIS do paciente,
    # não UTC. Override por paciente em pacientes.config_lembretes.timezone.
    default_timezone: str = "America/Sao_Paulo"  # DEFAULT_TIMEZONE

    # SHADOW: novas automações proativas (checkin_humor, alerta_nao_adesao)
    # logam o que fariam SEM efeito até validação clínica (clinical-safety).
    # Não altera os jobs legados nem os agentes analíticos.
    shadow_mode: bool = False  # SHADOW_MODE

    # checkin_humor (dirigido por conduta do médico)
    checkin_humor_hora_utc_default: int = 12

    # alerta_nao_adesao (dirigido por conduta do médico)
    alerta_nao_adesao_janela_dias_default: int = 7
    alerta_nao_adesao_limiar_default: int = 2
    alerta_nao_adesao_dedup_horas: int = 24

    # gerador_renovacao_receita (A4) — antecedência do alerta de vencimento.
    renovacao_antecedencia_dias: int = 7  # RENOVACAO_ANTECEDENCIA_DIAS

    # recall_inativos — paciente sem retorno há N dias (recuperação de receita).
    recall_inativo_dias: int = 90  # RECALL_INATIVO_DIAS
    recall_dedup_dias: int = 30    # RECALL_DEDUP_DIAS

    # Agentes sensíveis à janela de consulta — precisam de resposta rápida.
    resumidor_interval_seconds: int = 300   # RESUMIDOR_INTERVAL_SECONDS
    diario_interval_seconds: int = 300      # DIARIO_INTERVAL_SECONDS

    # Agentes analíticos — dados mudam devagar; cadência longa poupa recursos.
    # ATENÇÃO: risco_silencioso tem dedup_window_hours=168 (7 dias). Rodar a
    # 24h gera 6 scans completos/semana descartados pela dedup. Correto após
    # ADR-014 implementar dedup-no-SQL em _listar_candidatos.
    adesao_interval_hours: int = 6          # ADESAO_INTERVAL_HOURS
    padroes_interval_hours: int = 12        # PADROES_INTERVAL_HOURS
    risco_silencioso_interval_hours: int = 24  # RISCO_SILENCIOSO_INTERVAL_HOURS

    # ─── Gate de custo LLM diário (ADR-011) ───
    # Teto diário (America/Sao_Paulo) que PAUSA o despacho de agentes batch
    # NÃO-críticos. risco_silencioso (safety-relevant) e o plano interativo
    # (orchestrator: crise/conversa) NUNCA são gateados. Fail-open por design:
    # se a contagem falhar, o batch prossegue — a trava real é o limite mensal
    # na Console da Anthropic. <= 0 desabilita o gate. $5 é placeholder; calibrar
    # com custo_usd real acumulado.
    max_daily_llm_usd: float = 5.0          # MAX_DAILY_LLM_USD

    # ─── Provider LLM (ADR-015) ───
    # anthropic = API direta (default operacional). bedrock = AWS, atrás da flag.
    llm_provider: Literal["anthropic", "bedrock"] = "anthropic"

    # Anthropic API (LLM_PROVIDER=anthropic — auth via ANTHROPIC_API_KEY)
    anthropic_api_key: SecretStr | None = None
    anthropic_model_haiku: str = "claude-haiku-4-5-20251001"
    anthropic_model_sonnet: str = "claude-sonnet-4-6"
    anthropic_model_opus: str = "claude-opus-4-8"

    # AWS Bedrock (LLM_PROVIDER=bedrock — auth via IAM role)
    aws_region: str = "sa-east-1"
    bedrock_region: str = "sa-east-1"
    # IDs = inference profiles (prefixo global.). On-demand puro (anthropic.*)
    # dá ValidationException "model identifier is invalid" no Converse sa-east-1.
    bedrock_model_haiku: str = "global.anthropic.claude-haiku-4-5-20251001-v1:0"
    bedrock_model_sonnet: str = "global.anthropic.claude-sonnet-4-6"
    bedrock_model_opus: str = "global.anthropic.claude-opus-4-8"

    # ─── Embeddings / RAG (ADR-028) ───
    # Embedding é SEMPRE Bedrock in-region, independente de LLM_PROVIDER: Anthropic
    # não tem API de embedding e a LGPD exige inferência no Brasil. O modelo
    # cohere.embed-multilingual-v3 roda ON-DEMAND em sa-east-1 (sem profile global.*,
    # que rotearia cross-region). Em dev sem credenciais AWS, EMBEDDINGS_ENABLED=false.
    embeddings_enabled: bool = True            # EMBEDDINGS_ENABLED
    bedrock_embed_model: str = "cohere.embed-multilingual-v3"
    embed_dim: int = 1024                      # casa com vector(1024) da migration 0022
    rag_top_k: int = 8                         # RAG_TOP_K — resultados por busca
    rag_index_interval_hours: int = 12         # RAG_INDEX_INTERVAL_HOURS — cadência reindex
    rag_chunk_max_chars: int = 1600            # ~400 tokens — split de texto longo
    rag_chunk_overlap_chars: int = 200

    # LangSmith
    langsmith_tracing: bool = True
    langsmith_api_key: SecretStr | None = None
    langsmith_project: str = "cerebro-amigo-v3"
    # Default fail-safe (DEBT T0-4): LangSmith é cloud de terceiro fora do
    # Brasil; traces sobem só com metadata. Dev pode setar
    # LANGSMITH_HIDE_INPUTS/OUTPUTS=false explicitamente para depurar.
    langsmith_hide_inputs: bool = True
    langsmith_hide_outputs: bool = True
    pii_redaction_enabled: bool = True

    # Postgres — URL format para asyncpg
    postgres_dsn: SecretStr = Field(validation_alias="POSTGRES_DSN_URL")

    # Auth interna
    internal_api_token: SecretStr

    # Cifra de aplicação (ADR-018). Ausente ⇒ crypto vira no-op (modo legacy).
    # O indexador RAG e o hydration decifram a fonte com esta chave antes de
    # embeddar/exibir; sem ela, leem plaintext (estado atual, cifra não-ligada).
    encryption_key: SecretStr | None = None  # ENCRYPTION_KEY

    # Resumidor
    resumidor_lead_min_min: int = 30
    resumidor_lead_min_max: int = 120

    # ─── Adesão ────────────────────────────────────────────────────────
    # AVISO: thresholds abaixo são DEFAULTS PROVISÓRIOS para desenvolvimento.
    # Em produção exigem revisão e aprovação da psiquiatra responsável
    # (ver ADR-006). Não são números clínicos validados.

    adesao_janela_dias: int = 30

    # Adesão de medicação: taxa global (% de doses tomadas)
    adesao_threshold_taxa_media: float = 0.70   # < 70% → severidade média
    adesao_threshold_taxa_alta: float = 0.50    # < 50% → severidade alta

    # Doses consecutivas perdidas
    adesao_threshold_consecutivas_media: int = 3   # 3+ perdidas em sequência
    adesao_threshold_consecutivas_alta: int = 5    # 5+ perdidas em sequência

    # Queda na taxa entre primeira e segunda metade da janela (pontos %)
    adesao_threshold_queda_trend_pp: float = 15.0

    # Tolerância para classificar tomada 'pendente' como perdida (horas
    # após horario_previsto)
    adesao_tolerancia_pendente_horas: int = 6

    # Adesão comportamental (independente de medicação)
    adesao_threshold_inatividade_dias: int = 7
    adesao_threshold_queda_engajamento_pct: float = 0.50

    # ─── Risco silencioso ──────────────────────────────────────────────
    # AVISO: thresholds abaixo são DEFAULTS PROVISÓRIOS para desenvolvimento.
    # Em produção exigem revisão e aprovação da psiquiatra responsável
    # (ver ADR-006). Não são números clínicos validados.

    risco_silencioso_threshold_dias_absoluto: int = 14
    risco_silencioso_threshold_p95_multiplicador: float = 1.5
    risco_silencioso_minimo_amostras_historico: int = 5
    risco_silencioso_janela_historico_dias: int = 180
    # Sinais negativos antes do silêncio (graduação)
    risco_silencioso_humor_threshold_baixo: int = 3
    risco_silencioso_ansiedade_threshold_alto: int = 8
    risco_silencioso_janela_crise_recente_dias: int = 30
    risco_silencioso_janela_crise_critica_dias: int = 14

    # ─── Padrões ───────────────────────────────────────────────────────
    # AVISO: thresholds abaixo são DEFAULTS PROVISÓRIOS para desenvolvimento.
    # Em produção exigem revisão e aprovação da psiquiatra responsável
    # (ver ADR-006). Não são números clínicos validados.

    padroes_janela_dias: int = 30
    padroes_minimo_registros: int = 8
    # Tendência (slope linear): unidades por semana, em escala 0-10
    padroes_slope_min_pontos_semana: float = 0.5   # |slope|*7 ≥ 0.5/semana
    padroes_slope_max_p_value: float = 0.10        # p-valor da regressão
    # Step change (quebra entre primeira e segunda metade da janela)
    padroes_step_change_min_diff: float = 1.5      # diferença de médias ≥ 1.5
    padroes_step_change_max_p_value: float = 0.10
    # Volatilidade
    padroes_stddev_threshold_media: float = 2.0    # stddev ≥ 2.0/10 → trigger
    padroes_stddev_threshold_alta: float = 2.8     # stddev ≥ 2.8 → alta

    # ─── Diário ────────────────────────────────────────────────────────

    diario_janela_dias: int = 14
    diario_minimo_entradas: int = 2
    diario_lead_min_min: int = 30   # mesma janela do resumidor
    diario_lead_min_max: int = 120

    # ─── Transcrição de áudio (Azure AI Speech + Blob, ADR-082) ────────
    # Fast transcription (REST síncrono): os bytes vão direto na request —
    # diário de voz e teleconsulta nem tocam storage. O escriba PRESENCIAL usa
    # o container efêmero (SAS assinada pelo gateway): baixa, transcreve e
    # DELETA em seguida (LGPD); lifecycle de 1 dia no container é a rede de
    # segurança. A região do Speech pode diferir do resto do runtime — fast
    # transcription não existe em toda região; eastus cobre.
    azure_speech_key: SecretStr | None = None                 # AZURE_SPEECH_KEY
    azure_speech_region: str = "eastus"                       # AZURE_SPEECH_REGION
    azure_storage_connection_string: SecretStr | None = None  # AZURE_STORAGE_CONNECTION_STRING
    blob_container_audio: str = "audio-efemero"               # BLOB_CONTAINER_AUDIO
    transcribe_timeout_s: float = 600.0  # consulta presencial é longa (ADR-075); teleconsulta cabe folgado

    @model_validator(mode="after")
    def _validate_llm_provider(self) -> "Settings":
        """Fail-fast: a auth exigida depende do provider selecionado (ADR-015)."""
        if self.llm_provider == "anthropic" and not self.anthropic_api_key:
            raise ValueError(
                "LLM_PROVIDER=anthropic exige ANTHROPIC_API_KEY no ambiente."
            )
        if self.llm_provider == "bedrock" and not self.bedrock_region:
            raise ValueError(
                "LLM_PROVIDER=bedrock exige BEDROCK_REGION (região AWS) no ambiente."
            )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
