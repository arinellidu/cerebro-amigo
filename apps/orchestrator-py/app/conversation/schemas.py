"""Schemas de saída estruturada das chamadas LLM (alinhados ao schema do DB)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class CrisisDetectionOutput(BaseModel):
    """Saída do nó detect_crisis (Haiku).

    Conservadora: falso positivo é tolerável; falso negativo NÃO é.
    """

    crise_detectada: bool = Field(
        ...,
        description="True se a mensagem contém qualquer sinal de risco de "
        "auto-extermínio, auto-lesão, ideação suicida, plano suicida, "
        "desesperança aguda ou risco a terceiros. Na dúvida, True.",
    )
    confianca: float = Field(..., ge=0.0, le=1.0)
    nivel: Literal["nenhum", "baixo", "moderado", "alto", "critico"] = Field(
        ...,
        description=(
            "nenhum: sem sinal. "
            "baixo: tristeza/angústia sem ideação. "
            "moderado: ideação passiva ('queria não existir'). "
            "alto: ideação ativa sem plano. "
            "critico: plano, meios, intenção iminente."
        ),
    )
    gatilhos: list[str] = Field(
        default_factory=list,
        description="Categorias detectadas (NÃO trechos verbatim). "
        "Ex.: ['ideacao_ativa', 'desesperanca', 'isolamento'].",
    )


class MedicationResponseOutput(BaseModel):
    """Saída do nó classify_medication (Haiku).

    `status` mapeia para a coluna `tomadas_medicacao.status`.
    """

    eh_resposta_medicacao: bool = Field(
        ...,
        description="True somente se a mensagem responde claramente ao "
        "check-in de medicação enviado previamente. Mensagens espontâneas "
        "sobre medicação devem ser False (vão para o fluxo geral).",
    )
    status: Literal["tomado", "esquecido", "atrasado", "outro"] | None = Field(
        None,
        description=(
            "tomado: paciente confirma que tomou. "
            "esquecido: paciente diz que esqueceu/não tomou. "
            "atrasado: tomou fora do horário. "
            "outro: ambíguo ou diferente. "
            "None se eh_resposta_medicacao=False."
        ),
    )
    nota_paciente: str | None = Field(
        None,
        description="Texto adicional relevante para o médico (justificativa, "
        "efeito colateral mencionado, etc). Paráfrase, sem verbatim do paciente.",
    )


class SymptomExtractionOutput(BaseModel):
    """Saída do nó extract_symptoms (Sonnet).

    Mapeia diretamente para a tabela `sintomas`. Todos os campos numéricos
    de escala são 0-10 com CHECK constraint no DB (humor, ansiedade).
    Demais inteiros ficam livres mas conservadores entre 0 e 10.
    Use None onde não houver evidência clara - sem chutes.
    """

    humor: int | None = Field(
        None, ge=0, le=10,
        description="Humor reportado, 0=péssimo / 10=ótimo. None se não inferível.",
    )
    ansiedade: int | None = Field(
        None, ge=0, le=10,
        description="Nível de ansiedade reportado, 0=nenhuma / 10=intensa. "
        "None se não inferível.",
    )
    sono_horas: float | None = Field(
        None, ge=0.0, le=24.0,
        description="Horas de sono na última noite, se mencionado.",
    )
    sono_qualidade: int | None = Field(
        None, ge=0, le=10,
        description="Qualidade subjetiva do sono, 0=péssimo / 10=ótimo.",
    )
    energia: int | None = Field(None, ge=0, le=10)
    apetite: int | None = Field(None, ge=0, le=10)
    irritabilidade: int | None = Field(None, ge=0, le=10)
    nota: str | None = Field(
        None,
        description="Paráfrase em terceira pessoa do que o paciente relatou, "
        "sem trechos verbatim. Ex.: 'Relata sono fragmentado e cansaço diurno.' "
        "None se não houver nada parafraseável.",
    )

    def has_any_signal(self) -> bool:
        """True se ao menos um campo foi preenchido — para evitar INSERTs vazios."""
        return any(
            getattr(self, f) is not None
            for f in (
                "humor", "ansiedade", "sono_horas", "sono_qualidade",
                "energia", "apetite", "irritabilidade", "nota",
            )
        )


class AuditOutput(BaseModel):
    """Saída do nó audit_response (Haiku)."""

    decisao: Literal["enviar", "reescrever", "bloquear"] = Field(
        ...,
        description=(
            "enviar: resposta segura. "
            "reescrever: problemas corrigíveis. "
            "bloquear: conteúdo perigoso; escala para humano."
        ),
    )
    motivo: str = Field(..., description="Justificativa curta.")
    flags: list[str] = Field(default_factory=list)
