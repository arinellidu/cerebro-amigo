"""Timezone dos check-ins de medicação (DEBT G-4).

Horários de `prescricoes.horarios` são horário de parede LOCAL do paciente, não
UTC. Antes, o gerador combinava dia+hora com `tzinfo=UTC` → paciente em
America/Sao_Paulo recebia o lembrete 3h cedo. Estes testes fixam a conversão.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from app.core.tz import default_tz, local_slot_to_utc, resolve_patient_tz
from app.jobs.gerador_checkins_medicacao import GeradorCheckinsMedicacaoJob

_SP = ZoneInfo("America/Sao_Paulo")


# ─── local_slot_to_utc ──────────────────────────────────────────────────────

def test_local_slot_sao_paulo_para_utc():
    # 08:00 em São Paulo (UTC-3) = 11:00 UTC
    assert local_slot_to_utc(date(2026, 6, 14), time(8, 0), _SP) == datetime(
        2026, 6, 14, 11, 0, tzinfo=UTC
    )


def test_local_slot_utc_e_identidade():
    assert local_slot_to_utc(date(2026, 6, 14), time(8, 0), ZoneInfo("UTC")) == datetime(
        2026, 6, 14, 8, 0, tzinfo=UTC
    )


# ─── resolve_patient_tz ─────────────────────────────────────────────────────

def test_resolve_default_quando_ausente():
    assert resolve_patient_tz(None) == _SP
    assert resolve_patient_tz("{}") == _SP
    assert resolve_patient_tz({}) == _SP


def test_resolve_override_dict_e_json():
    manaus = ZoneInfo("America/Manaus")
    assert resolve_patient_tz({"timezone": "America/Manaus"}) == manaus
    assert resolve_patient_tz('{"timezone": "America/Manaus"}') == manaus


def test_resolve_invalido_cai_no_default():
    assert resolve_patient_tz({"timezone": "Marte/Olympus"}) == _SP
    assert resolve_patient_tz("nao-e-json") == _SP


def test_default_tz_e_sao_paulo():
    assert default_tz() == _SP


# ─── _gerar_horarios_na_janela ──────────────────────────────────────────────

def _slots(tz: ZoneInfo, fim=None):
    job = GeradorCheckinsMedicacaoJob()
    agora = datetime(2026, 6, 14, 0, 0, tzinfo=UTC)  # 13/06 21:00 em SP
    return job._gerar_horarios_na_janela(
        horarios=[time(8, 0)],
        agora=agora,
        ate=agora + timedelta(hours=48),
        inicio_prescricao=date(2026, 6, 1),
        fim_prescricao=fim,
        tz=tz,
    )


def test_janela_converte_horario_local_para_utc():
    # 08:00 SP = 11:00 UTC; janela [14/06 00:00, 16/06 00:00] UTC
    assert _slots(_SP) == [
        datetime(2026, 6, 14, 11, 0, tzinfo=UTC),
        datetime(2026, 6, 15, 11, 0, tzinfo=UTC),
    ]


def test_janela_respeita_fim_de_vigencia():
    assert _slots(_SP, fim=date(2026, 6, 14)) == [
        datetime(2026, 6, 14, 11, 0, tzinfo=UTC),
    ]


def test_regressao_g4_nao_e_mais_utc_ingenuo():
    # O bug antigo gerava 08:00 UTC (= 05:00 SP). Agora todo slot é 11:00 UTC.
    assert all(s.hour == 11 for s in _slots(_SP))
