namespace ApiGateway.Services;

/// <summary>
/// Avalia se a assinatura do médico libera o acesso ao dashboard (ADR-055).
/// Função pura, sem DI — testável e reusada na exposição de status (Fase B) e no
/// gate de enforcement (Fase D).
///
/// INVARIANTE CLÍNICA (ADR-055 / clinical-safety regra #2 e #3): este gate vale
/// SOMENTE para a UI do dashboard do médico. NUNCA deve ser aplicado a crise
/// (/api/v1/crise/*), portal do paciente (/api/v1/portal/paciente/*), chamadas
/// internas serviço-a-serviço (/internal/*) nem auth. E em status desconhecido/
/// ausente ele falha ABERTO (libera) de propósito: bloquear por engano (cegar o
/// médico para uma crise de paciente criado no prazo) é pior do que liberar uma
/// tela a mais.
/// </summary>
public static class AssinaturaGate
{
    public static AssinaturaSituacao Avaliar(
        string? status, DateTime? prazoPagamentoAte, DateTime? trialAte, DateTime nowUtc)
    {
        return AvaliarBase(status, prazoPagamentoAte, trialAte, nowUtc);
    }

    /// <summary>
    /// Sobrecarga que também deriva o estado "trial read-only" (ADR-065): médico
    /// recém-cadastrado, em prazo, AINDA SEM plano pago. Nesse estado o dashboard é
    /// liberado para LEITURA, mas a escrita (exceto pacientes) é bloqueada pelo
    /// <c>ReadOnlyTrialFilter</c> e a IA pelo <c>FeatureGateFilter</c>. Quem já tem
    /// plano pago (código conhecido no catálogo) nunca é read-only.
    /// </summary>
    public static AssinaturaSituacao Avaliar(
        string? status, DateTime? prazoPagamentoAte, DateTime? trialAte, DateTime nowUtc, string? plano)
    {
        var sit = AvaliarBase(status, prazoPagamentoAte, trialAte, nowUtc);
        // Plano pago = código existente no catálogo (starter/pro/master/enterprise).
        // pendente/trial/null/"" → não é plano pago → candidato a read-only.
        var temPlanoPago = PlanCatalog.TryGet(plano) is not null;
        var trialReadOnly = sit.Liberado
            && (sit.Motivo is "pendente_em_prazo" or "pendente_sem_prazo")
            && !temPlanoPago;
        return sit with { TrialReadOnly = trialReadOnly };
    }

    private static AssinaturaSituacao AvaliarBase(
        string? status, DateTime? prazoPagamentoAte, DateTime? trialAte, DateTime nowUtc)
    {
        switch ((status ?? "").Trim().ToLowerInvariant())
        {
            case "ativa":
                return new(true, false, "ativa", null);

            case "pendente":
                // Sem prazo gravado: defensivo, libera com aviso (não bloqueia por dado ausente).
                if (prazoPagamentoAte is null)
                    return new(true, true, "pendente_sem_prazo", null);
                return prazoPagamentoAte.Value >= nowUtc
                    ? new(true, true, "pendente_em_prazo", DiasAte(prazoPagamentoAte.Value, nowUtc))
                    : new(false, false, "pendente_vencido", 0);

            case "trial": // legado (ADR-055 depreca; mantido p/ assinaturas antigas)
                return (trialAte is null || trialAte.Value >= nowUtc)
                    ? new(true, true, "trial_legado", trialAte is null ? null : DiasAte(trialAte.Value, nowUtc))
                    : new(false, false, "trial_vencido", 0);

            case "suspensa":
                return new(false, false, "suspensa", null);

            case "cancelada":
                return new(false, false, "cancelada", null);

            default:
                // Fail-open clínico: status estranho/ausente nunca bloqueia.
                return new(true, false, "desconhecido", null);
        }
    }

    private static int DiasAte(DateTime alvo, DateTime nowUtc) =>
        Math.Max(0, (int)Math.Ceiling((alvo - nowUtc).TotalDays));
}

/// <param name="Liberado">true = acesso ao dashboard permitido.</param>
/// <param name="EmPrazo">true = ainda no prazo de pagamento → mostrar banner de aviso.</param>
/// <param name="Motivo">rótulo do estado (ativa, pendente_em_prazo, pendente_vencido, suspensa, ...).</param>
/// <param name="DiasRestantes">dias até vencer o prazo (null quando não se aplica).</param>
/// <param name="TrialReadOnly">true = trial de aquisição (ADR-065): leitura liberada,
/// escrita (exceto pacientes) e IA bloqueadas. Só preenchido pela sobrecarga que recebe `plano`.</param>
public record AssinaturaSituacao(
    bool Liberado, bool EmPrazo, string Motivo, int? DiasRestantes, bool TrialReadOnly = false);
