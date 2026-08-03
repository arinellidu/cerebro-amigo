using System.Text.Json;

namespace ApiGateway.Models;

// =============================================================================
// TENANCY
// =============================================================================

public class Cliente
{
    public Guid Id { get; set; }
    public string? WaId { get; set; }
    public string? Nome { get; set; }
    public string? Email { get; set; }
    public JsonDocument? Contexto { get; set; }
    public DateTime CriadoEm { get; set; }
}

public class Usuario
{
    public Guid Id { get; set; }
    public string Email { get; set; } = null!;
    public string SenhaHash { get; set; } = null!;
    public string Nome { get; set; } = null!;
    public string Role { get; set; } = "admin";
    public DateTime CriadoEm { get; set; }
    public DateTime? UltimoLogin { get; set; }
    public DateTime? DesativadoEm { get; set; }
    // T1-7: versão de sessão. Bump na troca/reset de senha revoga JWTs antigos (claim `tv`).
    public int TokenVersion { get; set; } = 1;
}

public class Medico
{
    public Guid Id { get; set; }
    public Guid UsuarioId { get; set; }
    public string Nome { get; set; } = null!;
    public string Crm { get; set; } = null!;
    public string? WaId { get; set; }
    public string Especialidade { get; set; } = "psiquiatria";
    public DateTime CriadoEm { get; set; }
}

// Paciente é 1-para-1 com Cliente. cliente_id é a PK e FK.
public class Paciente
{
    public Guid ClienteId { get; set; }
    public Guid MedicoResponsavelId { get; set; }
    public string? Cpf { get; set; }
    public DateOnly? DataNascimento { get; set; }
    public DateTime? ConsentimentoLgpdEm { get; set; }
    public string ConfigLembretes { get; set; } = "{}";
    public DateTime CriadoEm { get; set; }
}

// =============================================================================
// CONVERSAÇÃO
// =============================================================================

public class Conversa
{
    public Guid Id { get; set; }
    public Guid ClienteId { get; set; }
    public string Status { get; set; } = "aberta";
    public string? Intencao { get; set; }
    public DateTime CriadaEm { get; set; }
}

public class Mensagem
{
    public Guid Id { get; set; }
    public Guid ConversaId { get; set; }
    public string Papel { get; set; } = null!;
    public string Conteudo { get; set; } = null!;
    public string? ModeloUsado { get; set; }
    public int? TokensIn { get; set; }
    public int? TokensOut { get; set; }
    public decimal? CustoUsd { get; set; }
    public DateTime CriadaEm { get; set; }
}

// =============================================================================
// CLÍNICO
// =============================================================================

public class Prescricao
{
    public Guid Id { get; set; }
    public Guid PacienteId { get; set; }
    public Guid? MedicoId { get; set; }
    public string Medicamento { get; set; } = null!;
    public string DoseDescricao { get; set; } = null!;
    public TimeOnly[] Horarios { get; set; } = [];
    public DateTime InicioEm { get; set; }
    public DateTime? FimEm { get; set; }
    public string? ReceitaTipo { get; set; }
    public DateTime? ReceitaValidade { get; set; }
    public string? Observacoes { get; set; }
    public bool Ativa { get; set; } = true;
    public DateTime CriadaEm { get; set; }
}

public class PrescricaoEvento
{
    public Guid Id { get; set; }
    public Guid PacienteId { get; set; }
    public Guid? MedicoId { get; set; }
    public Guid? PrescricaoId { get; set; }
    public string Tipo { get; set; } = null!;
    public string Medicamento { get; set; } = null!;
    public string? MedicamentoAnterior { get; set; }
    public string? Motivo { get; set; }
    public DateTime CriadoEm { get; set; }
}

public class TomadaMedicacao
{
    public Guid Id { get; set; }
    public Guid PrescricaoId { get; set; }
    public Guid PacienteId { get; set; }
    public DateTime HorarioPrevisto { get; set; }
    public DateTime? HorarioReal { get; set; }
    public string Status { get; set; } = "pendente";
    public string? NotaPaciente { get; set; }
    public DateTime CriadoEm { get; set; }
}

public class Sintoma
{
    public Guid Id { get; set; }
    public Guid PacienteId { get; set; }
    public int? Humor { get; set; }
    public int? Ansiedade { get; set; }
    public decimal? SonoHoras { get; set; }
    public int? Energia { get; set; }
    public string? Nota { get; set; }
    public DateTime RegistradoEm { get; set; }
}

public class Evento
{
    public Guid Id { get; set; }
    public Guid PacienteId { get; set; }
    public string Titulo { get; set; } = null!;
    public string? Descricao { get; set; }
    public int? Intensidade { get; set; }
    public DateTime CriadoEm { get; set; }
}

public class Consulta
{
    public Guid Id { get; set; }
    public Guid PacienteId { get; set; }
    public Guid? MedicoId { get; set; }
    public DateTime IniciaEm { get; set; }
    public string Modalidade { get; set; } = "presencial";
    public string Status { get; set; } = "agendada";
    public string? Notas { get; set; }
    public DateTime CriadoEm { get; set; }
}

// =============================================================================
// CRISE E AUDITORIA (append-only)
// =============================================================================

// Criado pelo orchestrator-py. Gateway só lê. Nunca deletar.
public class ProtocoloCriseAcionado
{
    public Guid Id { get; set; }
    public Guid PacienteId { get; set; }
    public Guid? MedicoId { get; set; }
    public string Gatilho { get; set; } = null!;
    public double Confianca { get; set; }
    public DateTime CriadoEm { get; set; }
}

// Conteúdo append-only; flags lida/lida_em são mutáveis (marcar como lida é UX).
public class NotificacaoMedico
{
    public Guid Id { get; set; }
    public Guid MedicoId { get; set; }
    public Guid? PacienteId { get; set; }
    public string Severidade { get; set; } = "atencao";
    public string Tipo { get; set; } = null!;
    public string Titulo { get; set; } = null!;
    public string Mensagem { get; set; } = null!;
    public bool Lida { get; set; }
    public DateTime? LidaEm { get; set; }
    public DateTime CriadaEm { get; set; }
}

// Criado pelos agentes analíticos. Append-only.
public class AgenteExecucao
{
    public Guid Id { get; set; }
    public Guid? PacienteId { get; set; }
    public string Agente { get; set; } = null!;
    public DateTime IniciadoEm { get; set; }
    public DateTime? ConcluidoEm { get; set; }
    public bool? Sucesso { get; set; }
    public string? Erro { get; set; }
    public JsonDocument? Metadata { get; set; }
}

// =============================================================================
// PORTAL DO PACIENTE
// =============================================================================

public class PacienteCredencial
{
    public Guid PacienteId { get; set; }
    public string Email { get; set; } = null!;
    public string? SenhaHash { get; set; }
    public DateTime? SenhaDefinidaEm { get; set; }
    public bool SenhaTemporaria { get; set; }
    public int FalhasSeguidas { get; set; }
    public DateTime? BloqueadoAte { get; set; }
    public DateTime? UltimoLogin { get; set; }
}

public class MagicLink
{
    public Guid Id { get; set; }
    public Guid PacienteId { get; set; }
    public string TokenHash { get; set; } = null!;
    public string Proposito { get; set; } = "primeiro_acesso";
    public DateTime ExpiraEm { get; set; }
    public DateTime? UsadoEm { get; set; }
    public string? IpUso { get; set; }
    public DateTime CriadoEm { get; set; }
}

public class DiarioEntradaEntity
{
    public Guid Id { get; set; }
    public Guid PacienteId { get; set; }
    public string? Titulo { get; set; }
    public string Conteudo { get; set; } = null!;
    public int? Humor { get; set; }
    public string[] Tags { get; set; } = [];
    public bool CompartilhadaComMedico { get; set; }
    public DateTime CriadaEm { get; set; }
    public DateTime AtualizadaEm { get; set; }
    public string Tipo { get; set; } = "texto";        // texto | audio
    public string? Transcricao { get; set; }           // transcrição Amazon Transcribe
}

public class AcessoPaciente
{
    public Guid Id { get; set; }
    public Guid PacienteId { get; set; }
    public string Acao { get; set; } = null!;
    public string? Ip { get; set; }
    public string? UserAgent { get; set; }
    public DateTime CriadoEm { get; set; }
}

// =============================================================================
// CHECK-INS E PUSH
// =============================================================================

public class Checkin
{
    public Guid Id { get; set; }
    public Guid PacienteId { get; set; }
    public string Tipo { get; set; } = null!;
    public JsonDocument Payload { get; set; } = null!;
    public JsonDocument? Resposta { get; set; }
    public DateTime AgendadoPara { get; set; }
    public DateTime? EnviadoEm { get; set; }
    public DateTime? RespondidoEm { get; set; }
    public DateTime? ExpiradoEm { get; set; }
    public DateTime CriadoEm { get; set; }
}

public class PushSubscription
{
    public Guid Id { get; set; }
    public Guid PacienteId { get; set; }
    public string Endpoint { get; set; } = null!;
    public string P256dhKey { get; set; } = null!;
    public string AuthKey { get; set; } = null!;
    public string? UserAgent { get; set; }
    public DateTime? RevogadaEm { get; set; }
    public DateTime? UltimoUsoEm { get; set; }
    public DateTime CriadoEm { get; set; }
}

// =============================================================================
// IA ANALÍTICA
// =============================================================================

public class Insight
{
    public Guid Id { get; set; }
    public Guid PacienteId { get; set; }
    public Guid? MedicoId { get; set; }
    public string Agente { get; set; } = null!;
    public string Titulo { get; set; } = null!;
    public string Conteudo { get; set; } = null!;
    public string Severidade { get; set; } = "info";
    public DateTime? ValidoAte { get; set; }
    public JsonDocument? Metadata { get; set; }
    public DateTime? VisualizadoEm { get; set; }
    public DateTime? DescartadoEm { get; set; }
    public string? DescartadoMotivo { get; set; }
    public DateTime CriadoEm { get; set; }
}

// =============================================================================
// CATÁLOGO
// =============================================================================

// Editor de prompts dos agentes analíticos
public class Agente
{
    public Guid Id { get; set; }
    public string Nome { get; set; } = null!;
    public string SystemPrompt { get; set; } = null!;
    public string ModeloDefault { get; set; } = "sonnet";
    public bool Ativo { get; set; } = true;
    public DateTime AtualizadoEm { get; set; }
}

public class Medicamento
{
    public Guid Id { get; set; }
    public string? NomeComercial { get; set; }
    public string NomeGenerico { get; set; } = null!;
    public string ClasseTerapeutica { get; set; } = null!;
    public string? IndicacoesResumo { get; set; }
    public string[] Dosagens { get; set; } = [];
    public string[] FormasFarmaceuticas { get; set; } = [];
    public string? RegistroAnvisa { get; set; }
    public string? Laboratorio { get; set; }
    public string? Observacoes { get; set; }
    public bool EmDestaque { get; set; }
    public bool Ativo { get; set; } = true;
    public DateTime CriadoEm { get; set; }
}

// =============================================================================
// DTOs de auth
// =============================================================================

public record LoginRequest(string Email, string Senha);
public record LoginResponse(string Token, string Nome, string Role);

// =============================================================================
// DTO para editor de agentes (AgentesEndpoints)
// =============================================================================

public record AtualizarAgenteRequest(
    string? SystemPrompt,
    string? ModeloDefault,
    bool? Ativo);
