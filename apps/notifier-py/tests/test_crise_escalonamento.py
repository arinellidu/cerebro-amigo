"""Escada de escalonamento do alerta de crise (ADR-041, Fase 1).

Testa a decisão PURA (`_proxima_etapa`) e a redução de eventos
(`_estado_de_eventos`) SEM tocar no banco — é o miolo de segurança da entrega
garantida ao médico. Se a escada decidir errado, um paciente em crise pode
ficar sem cobertura ou o médico pode ser escalado indevidamente.
"""

from __future__ import annotations

from app.medico_notify import _estado_de_eventos, _EstadoAlerta, _proxima_etapa

ACK = 600
OPS = 1800


def _st(**kw) -> _EstadoAlerta:
    base = {
        "email_enviado": False,
        "email_falhas": 0,
        "ops_sem_email": False,
        "ops_email_indispo": False,
        "ops_estagio1": False,
        "ops_estagio2": False,
        "reforco_enviado": False,
    }
    base.update(kw)
    return _EstadoAlerta(**base)


def _etapa(idade: float, st: _EstadoAlerta) -> str:
    return _proxima_etapa(idade, st, ack_timeout_s=ACK, ops_timeout_s=OPS)


# ─── _proxima_etapa: a escada ────────────────────────────────────────────────


def test_email_inicial_enquanto_nada_enviado_e_dentro_do_ack():
    # Antes do ack_timeout e sem e-mail confirmado: garantir o e-mail inicial.
    assert _etapa(0, _st()) == "email_inicial"
    assert _etapa(ACK - 1, _st()) == "email_inicial"


def test_email_enviado_recente_aguarda():
    assert _etapa(ACK - 1, _st(email_enviado=True)) == "aguardando"


def test_sem_ack_apos_ack_timeout_reforca():
    assert _etapa(ACK, _st(email_enviado=True)) == "reforco_estagio1"


def test_reforco_ja_feito_aguarda_ate_ops_timeout():
    # "reforço/estágio 1 cumprido" = marcador OPS gravado (independe do e-mail).
    st = _st(email_enviado=True, ops_estagio1=True)
    assert _etapa(ACK + 1, st) == "aguardando"


def test_sem_ack_apos_ops_timeout_escala_ops():
    st = _st(email_enviado=True, ops_estagio1=True)
    assert _etapa(OPS, st) == "ops_estagio2"


def test_ops2_ja_feito_nao_repete():
    st = _st(email_enviado=True, ops_estagio1=True, ops_estagio2=True)
    assert _etapa(OPS + 999, st) == "aguardando"


def test_reforco_pendente_tem_prioridade_sobre_ops():
    # Watchdog ficou fora: já passou de ops_timeout, mas o estágio 1 nunca saiu.
    # Faz o reforço primeiro (catch-up); o OPS vem no tick seguinte.
    st = _st(email_enviado=True)
    assert _etapa(OPS + 10, st) == "reforco_estagio1"


# ─── FAIL-SAFE: e-mail fora não pode travar a escada (ADR-041, must-fix) ──────


def test_email_down_persistente_ainda_escala_por_idade():
    # Bug corrigido: e-mail nunca confirmado (Resend fora) NÃO pode prender a
    # escada em 'email_inicial'. Passado o ack_timeout, tem que escalar.
    assert _etapa(ACK, _st(email_enviado=False)) == "reforco_estagio1"
    # Com o estágio 1 (OPS sem_ack) já registrado, ainda sem e-mail e sem ack,
    # o OPS crítico por idade tem que disparar — mesmo com o canal de e-mail fora.
    assert _etapa(OPS, _st(email_enviado=False, ops_estagio1=True)) == "ops_estagio2"


def test_email_down_nao_fica_preso_em_email_inicial_em_idade_alta():
    # Regressão direta do must-fix: idade altíssima + e-mail nunca enviado NÃO
    # pode retornar 'email_inicial' para sempre (o canal mais quebrado escalava
    # MENOS que o caso brando). Tem que estar numa etapa de escalação.
    assert _etapa(99_999, _st()) != "email_inicial"


# ─── _estado_de_eventos: redução das linhas append-only ──────────────────────


def test_estado_vazio():
    st = _estado_de_eventos([])
    assert not st.email_enviado
    assert st.email_falhas == 0
    assert not st.reforco_enviado


def test_estado_conta_falhas_e_marca_enviado():
    eventos = [
        {"canal": "in_app", "evento": "enviado", "estagio": 0, "detalhe": None},
        {"canal": "email", "evento": "falhou", "estagio": 0, "detalhe": "http_502"},
        {"canal": "email", "evento": "falhou", "estagio": 0, "detalhe": "http_502"},
        {"canal": "email", "evento": "enviado", "estagio": 0, "detalhe": "ok"},
    ]
    st = _estado_de_eventos(eventos)
    assert st.email_enviado is True
    assert st.email_falhas == 2


def test_estado_detecta_reforco_e_ops():
    eventos = [
        {"canal": "email", "evento": "enviado", "estagio": 0, "detalhe": "ok"},
        {"canal": "email", "evento": "enviado", "estagio": 1, "detalhe": "ok"},
        {"canal": "ops", "evento": "enfileirado", "estagio": 1, "detalhe": "sem_ack_estagio1"},
        {"canal": "ops", "evento": "falhou", "estagio": 0, "detalhe": "email_indisponivel"},
    ]
    st = _estado_de_eventos(eventos)
    assert st.reforco_enviado is True
    assert st.ops_estagio1 is True
    assert st.ops_email_indispo is True
