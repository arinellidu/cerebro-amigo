using ApiGateway.Models;
using Microsoft.EntityFrameworkCore;

namespace ApiGateway.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options)
    : DbContext(options)
{
    // ─── Tenancy ──────────────────────────────────────────────────────────────
    public DbSet<Cliente> Clientes => Set<Cliente>();
    public DbSet<Usuario> Usuarios => Set<Usuario>();
    public DbSet<Medico> Medicos => Set<Medico>();
    public DbSet<Paciente> Pacientes => Set<Paciente>();

    // ─── Conversação ─────────────────────────────────────────────────────────
    public DbSet<Conversa> Conversas => Set<Conversa>();
    public DbSet<Mensagem> Mensagens => Set<Mensagem>();

    // ─── Clínico ─────────────────────────────────────────────────────────────
    public DbSet<Prescricao> Prescricoes => Set<Prescricao>();
    public DbSet<PrescricaoEvento> PrescricaoEventos => Set<PrescricaoEvento>();
    public DbSet<TomadaMedicacao> TomadasMedicacao => Set<TomadaMedicacao>();
    public DbSet<Sintoma> Sintomas => Set<Sintoma>();
    public DbSet<Evento> Eventos => Set<Evento>();
    public DbSet<Consulta> Consultas => Set<Consulta>();

    // ─── Crise e auditoria (append-only) ─────────────────────────────────────
    public DbSet<ProtocoloCriseAcionado> ProtocolosCriseAcionados => Set<ProtocoloCriseAcionado>();
    public DbSet<NotificacaoMedico> NotificacoesMedico => Set<NotificacaoMedico>();
    public DbSet<AgenteExecucao> AgenteExecucoes => Set<AgenteExecucao>();

    // ─── Portal do paciente ──────────────────────────────────────────────────
    public DbSet<PacienteCredencial> PacientesCredenciais => Set<PacienteCredencial>();
    public DbSet<MagicLink> MagicLinks => Set<MagicLink>();
    public DbSet<DiarioEntradaEntity> DiarioEntradas => Set<DiarioEntradaEntity>();
    public DbSet<AcessoPaciente> AcessosPaciente => Set<AcessoPaciente>();

    // ─── Check-ins e push ────────────────────────────────────────────────────
    public DbSet<Checkin> Checkins => Set<Checkin>();
    public DbSet<PushSubscription> PushSubscriptions => Set<PushSubscription>();

    // ─── IA analítica ─────────────────────────────────────────────────────────
    public DbSet<Insight> Insights => Set<Insight>();

    // ─── Catálogo ────────────────────────────────────────────────────────────
    public DbSet<Agente> Agentes => Set<Agente>();
    public DbSet<Medicamento> Medicamentos => Set<Medicamento>();

    protected override void OnModelCreating(ModelBuilder mb)
    {
        // ─── TENANCY ──────────────────────────────────────────────────────────

        mb.Entity<Cliente>(b =>
        {
            b.ToTable("clientes");
            b.HasKey(x => x.Id);
            b.HasIndex(x => x.WaId).IsUnique();
            b.HasIndex(x => x.Email).IsUnique();
            b.Property(x => x.Contexto).HasColumnType("jsonb");
        });

        mb.Entity<Usuario>(b =>
        {
            b.ToTable("usuarios");
            b.HasKey(x => x.Id);
            b.HasIndex(x => x.Email).IsUnique();
        });

        mb.Entity<Medico>(b =>
        {
            b.ToTable("medicos");
            b.HasKey(x => x.Id);
            b.HasOne<Usuario>().WithMany().HasForeignKey(x => x.UsuarioId);
        });

        mb.Entity<Paciente>(b =>
        {
            b.ToTable("pacientes");
            b.HasKey(x => x.ClienteId);
            b.HasOne<Cliente>().WithMany().HasForeignKey(x => x.ClienteId);
            b.HasOne<Medico>().WithMany().HasForeignKey(x => x.MedicoResponsavelId);
        });

        // ─── CONVERSAÇÃO ──────────────────────────────────────────────────────

        mb.Entity<Conversa>(b =>
        {
            b.ToTable("conversas");
            b.HasKey(x => x.Id);
            b.HasOne<Cliente>().WithMany().HasForeignKey(x => x.ClienteId);
            b.HasIndex(x => new { x.ClienteId, x.CriadaEm });
        });

        mb.Entity<Mensagem>(b =>
        {
            b.ToTable("mensagens");
            b.HasKey(x => x.Id);
            b.HasOne<Conversa>().WithMany().HasForeignKey(x => x.ConversaId);
            b.HasIndex(x => new { x.ConversaId, x.CriadaEm });
        });

        // ─── CLÍNICO ──────────────────────────────────────────────────────────

        mb.Entity<Prescricao>(b =>
        {
            b.ToTable("prescricoes");
            b.HasKey(x => x.Id);
            b.HasOne<Cliente>().WithMany().HasForeignKey(x => x.PacienteId);
            b.Property(x => x.Horarios).HasColumnType("time[]");
        });

        mb.Entity<PrescricaoEvento>(b =>
        {
            b.ToTable("prescricao_eventos");
            b.HasKey(x => x.Id);
        });

        mb.Entity<TomadaMedicacao>(b =>
        {
            b.ToTable("tomadas_medicacao");
            b.HasKey(x => x.Id);
            b.HasOne<Prescricao>().WithMany().HasForeignKey(x => x.PrescricaoId);
        });

        mb.Entity<Sintoma>(b =>
        {
            b.ToTable("sintomas");
            b.HasKey(x => x.Id);
            b.Property(x => x.RegistradoEm).HasDefaultValueSql("NOW()");
        });

        mb.Entity<Evento>(b =>
        {
            b.ToTable("eventos");
            b.HasKey(x => x.Id);
        });

        mb.Entity<Consulta>(b =>
        {
            b.ToTable("consultas");
            b.HasKey(x => x.Id);
        });

        // ─── CRISE E AUDITORIA ────────────────────────────────────────────────

        mb.Entity<ProtocoloCriseAcionado>(b =>
        {
            b.ToTable("protocolos_crise_acionados");
            b.HasKey(x => x.Id);
        });

        mb.Entity<NotificacaoMedico>(b =>
        {
            b.ToTable("notificacoes_medico");
            b.HasKey(x => x.Id);
        });

        mb.Entity<AgenteExecucao>(b =>
        {
            b.ToTable("agente_execucoes");
            b.HasKey(x => x.Id);
            b.Property(x => x.Metadata).HasColumnType("jsonb");
        });

        // ─── PORTAL DO PACIENTE ───────────────────────────────────────────────

        mb.Entity<PacienteCredencial>(b =>
        {
            b.ToTable("pacientes_credenciais");
            b.HasKey(x => x.PacienteId);
            b.HasOne<Cliente>().WithMany().HasForeignKey(x => x.PacienteId);
        });

        mb.Entity<MagicLink>(b =>
        {
            b.ToTable("magic_links");
            b.HasKey(x => x.Id);
            b.HasIndex(x => x.TokenHash).IsUnique();
        });

        mb.Entity<DiarioEntradaEntity>(b =>
        {
            b.ToTable("diario_entradas");
            b.HasKey(x => x.Id);
            b.Property(x => x.Tags).HasColumnType("text[]");
        });

        mb.Entity<AcessoPaciente>(b =>
        {
            b.ToTable("acessos_paciente");
            b.HasKey(x => x.Id);
            b.Property(x => x.Ip).HasColumnType("text");
        });

        // ─── CHECK-INS E PUSH ─────────────────────────────────────────────────

        mb.Entity<Checkin>(b =>
        {
            b.ToTable("checkins");
            b.HasKey(x => x.Id);
            b.Property(x => x.Payload).HasColumnType("jsonb");
            b.Property(x => x.Resposta).HasColumnType("jsonb");
        });

        mb.Entity<PushSubscription>(b =>
        {
            b.ToTable("push_subscriptions");
            b.HasKey(x => x.Id);
            b.HasIndex(x => x.Endpoint).IsUnique();
        });

        // ─── IA ANALÍTICA ─────────────────────────────────────────────────────

        mb.Entity<Insight>(b =>
        {
            b.ToTable("insights");
            b.HasKey(x => x.Id);
            b.Property(x => x.Metadata).HasColumnType("jsonb");
        });

        // ─── CATÁLOGO ─────────────────────────────────────────────────────────

        mb.Entity<Agente>(b =>
        {
            b.ToTable("agentes");
            b.HasKey(x => x.Id);
        });

        mb.Entity<Medicamento>(b =>
        {
            b.ToTable("medicamentos");
            b.HasKey(x => x.Id);
            b.Property(x => x.Dosagens).HasColumnType("text[]");
            b.Property(x => x.FormasFarmaceuticas).HasColumnType("text[]");
        });
    }
}
