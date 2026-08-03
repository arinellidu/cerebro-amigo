"""Configuração tipada centralizada.

Carrega variáveis de ambiente via pydantic-settings. Camada LLM é
provider-switchável (ADR-015): `LLM_PROVIDER=anthropic` (default operacional,
auth via ANTHROPIC_API_KEY) ou `LLM_PROVIDER=bedrock` (auth via IAM role /
AWS_PROFILE). Trocar de provider = trocar uma env var.
"""

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

    # ─── App ───
    app_env: Literal["development", "staging", "production"] = "development"
    log_level: str = "INFO"
    frontend_url: str = "http://localhost:3000"
    shadow_mode: bool = Field(
        default=False,
        description="Se True, processa toda a conversa mas NÃO envia ao paciente. "
        "Usado na fase de validação shadow contra o orchestrator Go.",
    )
    max_retry_audit: int = 2
    # ADR-063: ativa camadas 1-3 (screen determinístico, retry, modo degradado).
    # Default False: comportamento histórico (fail-safe = crise) preservado até
    # LISTA_ATESTADA=True + INSTABILIDADE_COPY.atestado=True em crisis_copy.py.
    crisis_resilience_enabled: bool = False

    # ─── Provider LLM (ADR-015) ───
    # anthropic = API direta (default operacional). bedrock = AWS, atrás da flag.
    llm_provider: Literal["anthropic", "bedrock"] = "anthropic"

    # ─── Anthropic API (LLM_PROVIDER=anthropic) ───
    anthropic_api_key: SecretStr | None = None
    anthropic_model_haiku: str = "claude-haiku-4-5-20251001"
    anthropic_model_sonnet: str = "claude-sonnet-4-6"
    anthropic_model_opus: str = "claude-opus-4-8"

    # ─── AWS Bedrock (LLM_PROVIDER=bedrock — auth via IAM role) ───
    aws_region: str = "sa-east-1"
    bedrock_region: str = "sa-east-1"
    bedrock_model_haiku: str = "global.anthropic.claude-haiku-4-5-20251001-v1:0"
    bedrock_model_sonnet: str = "global.anthropic.claude-sonnet-4-6"
    bedrock_model_opus: str = "global.anthropic.claude-opus-4-8"

    # ─── LangSmith ───
    langsmith_tracing: bool = True
    langsmith_api_key: SecretStr | None = None
    langsmith_project: str = "cerebro-amigo-v3"
    # Default fail-safe (DEBT T0-4): LangSmith é cloud de terceiro fora do
    # Brasil; traces sobem só com metadata. Dev pode setar
    # LANGSMITH_HIDE_INPUTS/OUTPUTS=false explicitamente para depurar.
    langsmith_hide_inputs: bool = True
    langsmith_hide_outputs: bool = True
    pii_redaction_enabled: bool = True

    # ─── Postgres ─── URL format: postgresql://user:pass@host/db
    postgres_dsn: SecretStr = Field(validation_alias="POSTGRES_DSN_URL")

    # ─── Auth interna ───
    internal_api_token: SecretStr

    # ─── Serviços internos ───
    notifier_url: str = Field(
        default="http://localhost:8083", validation_alias="NOTIFIER_PY_URL"
    )

    # ─── Cifragem em repouso (ADR-018) ───
    # Modo legacy: None/vazio = não cifra (dev). Em prod é obrigatória.
    encryption_key: SecretStr | None = Field(default=None, validation_alias="ENCRYPTION_KEY")

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

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache
def get_settings() -> Settings:
    """Singleton cacheado das configurações."""
    return Settings()  # type: ignore[call-arg]
