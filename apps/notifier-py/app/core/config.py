"""Configuração tipada do notifier-py."""

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr
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
    notifier_mode: Literal["scheduled", "manual"] = "scheduled"
    scheduler_interval_seconds: int = 60

    # DB — URL format para asyncpg
    postgres_dsn: SecretStr = Field(validation_alias="POSTGRES_DSN_URL")

    # Auth
    internal_api_token: SecretStr

    # VAPID
    vapid_public_key: str
    vapid_private_key: str
    vapid_subject: str

    # Push tuning
    push_ttl_seconds: int = 3600
    push_urgency: Literal["very-low", "low", "normal", "high"] = "normal"

    # E-mail — provider switch (espelha LLM_PROVIDER; ADR-073). O call-site só
    # chama app.core.email.send_email(); não sabe qual provider está ativo.
    #   resend (PRIMÁRIO/vigente): auth RESEND_API_KEY; domínio verificado.
    #   ses    (ALTERNATIVA):      SES v2 in-region (LGPD), IAM role; HOJE
    #                              bloqueado (sandbox + domínio não verificado, CK-4).
    email_provider: Literal["resend", "ses"] = Field(default="resend", validation_alias="EMAIL_PROVIDER")
    ses_region: str = Field(default="sa-east-1", validation_alias="SES_REGION")

    # Email fallback (quando push falha em TODOS os devices). Ligado por padrão —
    # lembrete de medicação que não chega tem peso clínico. Só envia de fato se
    # o provider estiver configurado (sem chave/SDK, loga e não envia); pode ser
    # desligado com EMAIL_FALLBACK_ENABLED=false.
    resend_api_key: SecretStr | None = Field(default=None, validation_alias="RESEND_API_KEY")
    email_from: str = Field(default="Cérebro Amigo <noreply@cerebroamigo.com.br>", validation_alias="EMAIL_FROM")
    email_fallback_enabled: bool = Field(default=True, validation_alias="EMAIL_FALLBACK_ENABLED")

    # Lembretes de consulta (push/email 24h e 1h antes). Desligar = não despacha.
    consulta_lembretes_enabled: bool = Field(default=True)

    # Crise — entrega garantida do alerta ao médico (ADR-041, Fase 1).
    # Timings da escada de escalonamento (sem ack do médico → sobe de estágio).
    # Valores carecem de validação clínica (ver ADR-041) — ajustáveis por env.
    crise_ack_timeout_segundos: int = 600   # sem ack > 10min → estágio 1 (reforço + OPS)
    crise_ops_timeout_segundos: int = 1800  # sem ack > 30min → estágio 2 (OPS crítico)
    crise_email_max_tentativas: int = 5     # falhas de e-mail antes de OPS "indisponível"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
