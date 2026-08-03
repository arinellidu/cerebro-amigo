"""Timezone de agendamento de check-ins (DEBT G-4).

Os horários que o médico cadastra (ex.: `prescricoes.horarios`) são horários
de **parede no fuso do paciente**, não UTC. Antes, os geradores combinavam
dia+hora com `tzinfo=UTC` direto — um paciente em America/Sao_Paulo (UTC-3)
recebia o lembrete 3h cedo. Este módulo converte (dia local + hora local) →
instante UTC, usando o fuso do paciente quando configurado ou o default do
produto caso contrário.

Nada clínico: só aritmética de fuso. Usa `zoneinfo` (respeita regras de
horário de verão do fuso, se houver).
"""

from __future__ import annotations

import json
from datetime import UTC, date, datetime, time
from functools import lru_cache
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import structlog

from app.core.config import get_settings

logger = structlog.get_logger(__name__)

_FALLBACK_TZ = "America/Sao_Paulo"


@lru_cache(maxsize=64)
def _zone(name: str) -> ZoneInfo:
    return ZoneInfo(name)


def default_tz() -> ZoneInfo:
    """Fuso padrão do produto (env `DEFAULT_TIMEZONE`; default America/Sao_Paulo).

    Config inválida não derruba o job clínico: cai no fallback com warning.
    """
    name = get_settings().default_timezone
    try:
        return _zone(name)
    except (ZoneInfoNotFoundError, ValueError):
        logger.warning("tz.default_invalido", configurado=name, usando=_FALLBACK_TZ)
        return _zone(_FALLBACK_TZ)


def resolve_patient_tz(config_lembretes: Any) -> ZoneInfo:
    """Fuso do paciente a partir de `pacientes.config_lembretes` (JSON), com
    fallback no default do produto.

    `config_lembretes` pode ser dict ou string JSON e trazer
    `{"timezone": "America/Manaus"}`. Ausente, malformado ou inválido → default.
    Defensivo de propósito: dado de paciente nunca deve quebrar a geração.
    """
    cfg: Any = config_lembretes
    if isinstance(cfg, str):
        try:
            cfg = json.loads(cfg)
        except Exception:
            cfg = None
    name = cfg.get("timezone") if isinstance(cfg, dict) else None
    if not name:
        return default_tz()
    try:
        return _zone(str(name))
    except (ZoneInfoNotFoundError, ValueError):
        logger.warning("tz.paciente_invalido", configurado=name, usando="default")
        return default_tz()


def local_slot_to_utc(dia: date, hora: time, tz: ZoneInfo) -> datetime:
    """Combina (dia, hora) como horário de parede em `tz` e devolve UTC.

    Ex.: (2026-06-14, 08:00, America/Sao_Paulo) → 2026-06-14 11:00+00:00.
    Descarta qualquer tzinfo de `hora` (usa só hora/minuto/segundo de parede).
    """
    wall = datetime(
        dia.year, dia.month, dia.day, hora.hour, hora.minute, hora.second, tzinfo=tz
    )
    return wall.astimezone(UTC)
