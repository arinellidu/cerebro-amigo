using ApiGateway.Auth;
using ApiGateway.Data;
using ApiGateway.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using System.Net.Http.Headers;
using System.Net.Http.Json;

namespace ApiGateway.Endpoints;

/// <summary>
/// Endpoints específicos do dashboard psiquiátrico.
/// Tudo escoado pelo médico logado — vê apenas seus pacientes.
/// </summary>
public static class PacientesPsiqEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/pacientes")
            .WithTags("pacientes-psiquiatria")
            .RequireAuthorization()
            .RequireAssinaturaAtiva(); // ADR-055 Fase D: gate de assinatura (dashboard)

        // Lista pacientes do médico logado
        g.MapGet("/", async (AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            // `numero` é o número de cadastro DAQUELE médico — estável (não muda
            // quando a lista reordena por atividade) e específico (cada médico
            // tem sua própria sequência 1..N). Útil para conversa clínica
            // anônima ("paciente 03") e para identificação visual rápida.
            var sql = @"
                WITH numerados AS (
                    SELECT cliente_id,
                           ROW_NUMBER() OVER (
                               PARTITION BY medico_responsavel_id
                               ORDER BY criado_em ASC, cliente_id
                           ) AS numero
                    FROM pacientes
                    WHERE medico_responsavel_id = {0}
                )
                SELECT n.numero, c.id, c.wa_id, c.nome, c.email,
                       p.cpf, p.data_nascimento, p.consentimento_lgpd_em,
                       -- medicações ativas = prescrições (MEMED) + medicações em uso (reconciliação, ADR-062);
                       -- contexto médico (app.current_medico) → RLS de medicacoes_em_uso libera as do tenant.
                       ((SELECT COUNT(*) FROM prescricoes pr WHERE pr.paciente_id = c.id AND pr.ativa)
                        + (SELECT COUNT(*) FROM medicacoes_em_uso mu WHERE mu.paciente_id = c.id AND mu.ativa)) AS prescricoes_ativas,
                       (SELECT MAX(m.criada_em) FROM mensagens m
                        JOIN conversas conv ON conv.id = m.conversa_id
                        WHERE conv.cliente_id = c.id) AS ultima_msg
                FROM clientes c
                JOIN pacientes p ON p.cliente_id = c.id
                JOIN numerados n ON n.cliente_id = c.id
                WHERE p.medico_responsavel_id = {0}
                ORDER BY ultima_msg DESC NULLS LAST";

            var rows = await db.Database.SqlQueryRaw<PacienteListItem>(sql, medicoId).ToListAsync();
            return Results.Ok(rows);
        });

        // Um paciente do médico logado (cabeçalho do prontuário). Mesma projeção
        // da lista, escopada a um cliente_id. Filtro explícito de tenant
        // (medico_responsavel_id) + RLS por baixo (ADR-042); 404 se não for do
        // médico — não vaza existência de paciente alheio.
        g.MapGet("/{id:guid}", async (Guid id, AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            var sql = @"
                WITH numerados AS (
                    SELECT cliente_id,
                           ROW_NUMBER() OVER (
                               PARTITION BY medico_responsavel_id
                               ORDER BY criado_em ASC, cliente_id
                           ) AS numero
                    FROM pacientes
                    WHERE medico_responsavel_id = {0}
                )
                SELECT n.numero, c.id, c.wa_id, c.nome, c.email,
                       p.cpf, p.data_nascimento, p.consentimento_lgpd_em,
                       -- medicações ativas = prescrições (MEMED) + medicações em uso (reconciliação, ADR-062);
                       -- contexto médico (app.current_medico) → RLS de medicacoes_em_uso libera as do tenant.
                       ((SELECT COUNT(*) FROM prescricoes pr WHERE pr.paciente_id = c.id AND pr.ativa)
                        + (SELECT COUNT(*) FROM medicacoes_em_uso mu WHERE mu.paciente_id = c.id AND mu.ativa)) AS prescricoes_ativas,
                       (SELECT MAX(m.criada_em) FROM mensagens m
                        JOIN conversas conv ON conv.id = m.conversa_id
                        WHERE conv.cliente_id = c.id) AS ultima_msg
                FROM clientes c
                JOIN pacientes p ON p.cliente_id = c.id
                JOIN numerados n ON n.cliente_id = c.id
                WHERE p.medico_responsavel_id = {0} AND c.id = {1}";

            var paciente = await db.Database
                .SqlQueryRaw<PacienteListItem>(sql, medicoId, id)
                .FirstOrDefaultAsync();
            if (paciente is null) return Results.NotFound();

            // Trilha de acesso (LGPD art.37): só registra na leitura concedida.
            await db.Database.RegistrarAcessoProntuarioAsync(medicoId.Value, id, "prontuario");
            return Results.Ok(paciente);
        });

        // Timeline unificada do paciente
        g.MapGet("/{id:guid}/timeline", async (
            Guid id, AppDbContext db, ClaimsPrincipal user,
            [FromQuery] int dias = 30) =>
        {
            if (!await PacienteEhDoMedico(db, id, user, "timeline")) return Results.Forbid();

            var inicio = DateTime.UtcNow.AddDays(-dias);

            // Une eventos diversos numa só timeline
            var timeline = new List<TimelineItem>();

            var mensagens = await db.Mensagens
                .Where(m => db.Conversas.Any(c => c.Id == m.ConversaId && c.ClienteId == id)
                            && m.CriadaEm >= inicio)
                .OrderByDescending(m => m.CriadaEm).Take(200)
                .Select(m => new TimelineItem(
                    "mensagem", m.CriadaEm,
                    m.Papel == "user" ? "Mensagem do paciente" : "Resposta",
                    m.Conteudo, null, m.Papel == "user" ? "patient" : "system"))
                .ToListAsync();
            timeline.AddRange(mensagens);

            // Sintomas, eventos, tomadas, crises (queries SQL separadas)
            var sintomas = await db.Database.SqlQueryRaw<TimelineItem>(@"
                SELECT 'sintoma' AS tipo, registrado_em AS quando,
                       'Sintomas registrados' AS titulo,
                       CONCAT('Humor: ', COALESCE(humor::text, '-'),
                              ' | Ansiedade: ', COALESCE(ansiedade::text, '-'),
                              ' | Sono: ', COALESCE(sono_horas::text, '-'), 'h') AS descricao,
                       NULL::int AS intensidade,
                       'system' AS origem
                FROM sintomas WHERE paciente_id = {0} AND registrado_em >= {1}
                ORDER BY registrado_em DESC", id, inicio).ToListAsync();
            timeline.AddRange(sintomas);

            var eventos = await db.Database.SqlQueryRaw<TimelineItem>(@"
                SELECT 'evento' AS tipo, criado_em AS quando,
                       titulo, COALESCE(descricao, '') AS descricao,
                       intensidade, 'system' AS origem
                FROM eventos WHERE paciente_id = {0} AND criado_em >= {1}
                ORDER BY criado_em DESC", id, inicio).ToListAsync();
            timeline.AddRange(eventos);

            var crises = await db.Database.SqlQueryRaw<TimelineItem>(@"
                SELECT 'crise' AS tipo, criado_em AS quando,
                       'PROTOCOLO DE CRISE ACIONADO' AS titulo,
                       CONCAT('Gatilho: ', gatilho, ' | Confiança: ',
                              ROUND((confianca * 100)::numeric, 0), '%') AS descricao,
                       NULL::int AS intensidade, 'critical' AS origem
                FROM protocolos_crise_acionados WHERE paciente_id = {0} AND criado_em >= {1}
                ORDER BY criado_em DESC", id, inicio).ToListAsync();
            timeline.AddRange(crises);

            return Results.Ok(timeline.OrderByDescending(t => t.Quando).Take(150));
        });

        // Gráfico de humor (últimos 30/60/90 dias)
        g.MapGet("/{id:guid}/humor", async (
            Guid id, AppDbContext db, ClaimsPrincipal user,
            [FromQuery] int dias = 30) =>
        {
            if (!await PacienteEhDoMedico(db, id, user, "humor")) return Results.Forbid();

            var inicio = DateTime.UtcNow.AddDays(-dias);
            var dados = await db.Database.SqlQueryRaw<PontoHumor>(@"
                SELECT DATE(registrado_em) AS data,
                       AVG(humor)::float AS humor,
                       AVG(ansiedade)::float AS ansiedade
                FROM sintomas
                WHERE paciente_id = {0} AND registrado_em >= {1}
                GROUP BY DATE(registrado_em)
                ORDER BY data", id, inicio).ToListAsync();
            return Results.Ok(dados);
        });

        // Adesão a medicação (últimos 30 dias)
        g.MapGet("/{id:guid}/adesao", async (
            Guid id, AppDbContext db, ClaimsPrincipal user) =>
        {
            if (!await PacienteEhDoMedico(db, id, user, "adesao")) return Results.Forbid();

            var dados = await db.Database.SqlQueryRaw<AdesaoMedicacao>(@"
                SELECT pr.medicamento,
                       COUNT(*) FILTER (WHERE t.status = 'tomada') AS tomadas,
                       COUNT(*) FILTER (WHERE t.status IN ('esquecida','pulou')) AS faltas,
                       COUNT(*) AS total,
                       ROUND(
                         COUNT(*) FILTER (WHERE t.status = 'tomada')::numeric /
                         NULLIF(COUNT(*) FILTER (WHERE t.status != 'pendente'), 0) * 100,
                         1
                       ) AS percentual_adesao
                FROM tomadas_medicacao t
                JOIN prescricoes pr ON pr.id = t.prescricao_id
                WHERE t.paciente_id = {0}
                  AND t.horario_previsto >= NOW() - INTERVAL '30 days'
                GROUP BY pr.medicamento", id).ToListAsync();
            return Results.Ok(dados);
        });

        // Resumo pré-consulta — GET retorna o último insight cacheado (se houver)
        g.MapGet("/{id:guid}/resumo-pre-consulta", async (
            Guid id, AppDbContext db, ClaimsPrincipal user) =>
        {
            if (!await PacienteEhDoMedico(db, id, user, "resumo_pre_consulta")) return Results.Forbid();

            var sql = @"
                SELECT id, titulo, conteudo, severidade, criado_em, valido_ate,
                       COALESCE(metadata->>'qualidade_dados', 'completa') AS qualidade_dados,
                       (metadata->>'periodo_dias')::int AS periodo_dias
                FROM insights
                WHERE paciente_id = {0}
                  AND agente = 'resumo_pre_consulta'
                  AND descartado_em IS NULL
                ORDER BY criado_em DESC
                LIMIT 1";

            var resultados = await db.Database
                .SqlQueryRaw<ResumoPreConsultaDto>(sql, id)
                .ToListAsync();
            var ultimo = resultados.Count > 0 ? resultados[0] : null;

            return Results.Ok(new { ultimo });
        }).RequireFeature(FeatureKeys.BriefingIa); // ADR-059: briefing IA (todos os planos pagos; bloqueia plano nulo/legado)

        // Resumo pré-consulta — POST dispara geração on-demand via agents-py
        g.MapPost("/{id:guid}/resumo-pre-consulta", async (
            Guid id,
            AppDbContext db,
            ClaimsPrincipal user,
            IHttpClientFactory httpFactory,
            IConfiguration cfg) =>
        {
            if (!await PacienteEhDoMedico(db, id, user)) return Results.Forbid();

            var internalToken = cfg["INTERNAL_API_TOKEN"]
                ?? throw new InvalidOperationException("INTERNAL_API_TOKEN missing");

            var http = httpFactory.CreateClient("agents-py");
            using var msg = new HttpRequestMessage(
                HttpMethod.Post,
                "/internal/agents/resumo_pre_consulta/run-on-demand")
            {
                Content = JsonContent.Create(new { paciente_id = id }),
            };
            msg.Headers.Authorization = new AuthenticationHeaderValue("Bearer", internalToken);

            using var resp = await http.SendAsync(msg);
            if (!resp.IsSuccessStatusCode)
            {
                var body = await resp.Content.ReadAsStringAsync();
                return Results.Problem(
                    title: "Falha ao chamar agents-py",
                    detail: body,
                    statusCode: (int)resp.StatusCode);
            }

            // O agent persistiu o insight (ou pulou se elegibilidade falhou).
            // Buscamos o mais recente pra devolver pro frontend.
            var sql = @"
                SELECT id, titulo, conteudo, severidade, criado_em, valido_ate,
                       COALESCE(metadata->>'qualidade_dados', 'completa') AS qualidade_dados,
                       (metadata->>'periodo_dias')::int AS periodo_dias
                FROM insights
                WHERE paciente_id = {0}
                  AND agente = 'resumo_pre_consulta'
                  AND descartado_em IS NULL
                ORDER BY criado_em DESC
                LIMIT 1";

            var resultados = await db.Database
                .SqlQueryRaw<ResumoPreConsultaDto>(sql, id)
                .ToListAsync();
            var resumo = resultados.Count > 0 ? resultados[0] : null;

            if (resumo is null)
            {
                // Agent pulou (ex.: paciente não tem consulta agendada e o
                // resumidor exige isso em find_pending). Retornamos 200 com
                // null pro frontend mostrar mensagem explicativa.
                return Results.Ok(new
                {
                    resumo = (object?)null,
                    aviso = "Resumo não foi gerado. Possível causa: o agente requer dados que ainda não estão disponíveis pra este paciente.",
                });
            }

            return Results.Ok(new { resumo });
        }).RequireFeature(FeatureKeys.BriefingIa); // ADR-059: briefing IA (todos os planos pagos; bloqueia plano nulo/legado)

        // ================================================================
        // CRIAR PACIENTE (médico cadastra novo paciente)
        // ================================================================
        // O cadastro SEMPRE convida o paciente por e-mail (correção 2026-06-25 —
        // antes, definir uma senha provisória pulava o e-mail e o paciente ficava
        // sem nenhum aviso de acesso):
        //
        //  1. Cria `clientes` + `pacientes`
        //  2. (Opcional) se `senhaInicial` veio preenchido, grava uma senha
        //     provisória em `pacientes_credenciais` (`senha_temporaria=TRUE`,
        //     força troca no 1º acesso) — ADICIONAL, não substitui o e-mail.
        //  3. Gera magic_link de 24h e envia o convite por e-mail (Resend).
        //  4. Retorna `emailEnviado`/`magicLinkUrl` (fallback se o e-mail falhou)
        //     e, quando houver, a `senhaProvisoria` pro médico também entregar.
        //
        // Telefone (WhatsApp) é obrigatório, pra fallback de emergência fora do app.
        g.MapPost("/", async (
            [FromBody] CriarPacienteRequest req,
            AppDbContext db, ClaimsPrincipal user,
            IHttpClientFactory httpFactory, IConfiguration cfg,
            IPasswordHasher hasher, ResendClient resend, ILogger<Program> logger) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            // ADR-065: cap de pacientes no trial de aquisição (lock-in por base, sem virar
            // produto grátis). Fora do trial não limita.
            var capErro = await TrialCapPacientesAsync(db, user, medicoId.Value, cfg);
            if (capErro is not null) return capErro;

            // Senha provisória é OPCIONAL e ADICIONAL (não substitui o e-mail): se o
            // médico informar uma, ela é gravada E o paciente ainda recebe o magic link
            // por e-mail. Todo cadastro envia o convite por e-mail (correção 2026-06-25:
            // antes, definir senha pulava o e-mail e o paciente ficava sem aviso).
            var definirSenha = !string.IsNullOrWhiteSpace(req.SenhaInicial);
            if (definirSenha && req.SenhaInicial!.Length < 6)
                return Results.BadRequest(new { error = "senha provisória precisa ter pelo menos 6 caracteres" });

            // Validação + criação de clientes/pacientes — núcleo compartilhado com
            // o /importar (lote). Escopado ao médico do JWT.
            var resultado = await CriarPacienteCoreAsync(
                db, medicoId.Value, req.Nome, req.Email, req.WaId,
                req.Cpf, req.DataNascimento, logger);

            if (resultado.Tipo == CriarTipo.Validacao)
                return Results.BadRequest(new { error = resultado.Motivo });
            if (resultado.Tipo == CriarTipo.Conflito)
                return Results.Conflict(new { error = resultado.Motivo });

            // Criado ou JaExistente → segue para o fluxo de convite (senha/magic link).
            var clienteId = resultado.PacienteId!.Value;
            var emailNorm = req.Email.Trim().ToLowerInvariant();

            // ----------------------------------------------------------------
            // (Opcional) senha provisória definida pelo médico — ADICIONAL ao e-mail.
            // Grava credencial temporária (força troca no 1º acesso). NÃO retorna aqui:
            // o cadastro segue para o convite por e-mail (magic link), que vai sempre.
            // ----------------------------------------------------------------
            if (definirSenha)
            {
                var senhaHash = hasher.Hash(req.SenhaInicial!);

                await db.Database.ExecuteSqlRawAsync(@"
                    INSERT INTO pacientes_credenciais
                        (paciente_id, email, senha_hash, senha_definida_em, senha_temporaria)
                    VALUES ({0}, {1}, {2}, NOW(), TRUE)
                    ON CONFLICT (paciente_id) DO UPDATE SET
                        email = EXCLUDED.email,
                        senha_hash = EXCLUDED.senha_hash,
                        senha_definida_em = NOW(),
                        senha_temporaria = TRUE",
                    clienteId, emailNorm, senhaHash);
            }

            // ----------------------------------------------------------------
            // Convite por e-mail (magic link) — SEMPRE, em todo cadastro.
            // O INSERT do magic_links fica DENTRO do try: se o banco falhar aqui, o
            // paciente já foi criado — não derruba o request com 500, e não oferece
            // URL de fallback com um token que não chegou a ser persistido.
            // ----------------------------------------------------------------
            var emailEnviado = false;
            string? emailErro = null;
            string? magicLinkUrl = null;
            try
            {
                var tokenBytes = System.Security.Cryptography.RandomNumberGenerator.GetBytes(32);
                var token = Convert.ToBase64String(tokenBytes)
                    .Replace("+", "-").Replace("/", "_").Replace("=", "");
                var hashToken = SHA256(token);

                await db.Database.ExecuteSqlRawAsync(@"
                    INSERT INTO magic_links (paciente_id, token_hash, proposito, expira_em)
                    VALUES ({0}, {1}, 'primeiro_acesso', NOW() + INTERVAL '24 hours')",
                    clienteId, hashToken);

                var portalBase = cfg["PORTAL_PACIENTE_URL"] ?? "http://localhost:3000";
                var url = $"{portalBase}/p/entrar?token={token}";

                var medicoNome = await db.Database.ExecuteScalarAsync<string>(
                    "SELECT nome FROM medicos WHERE id = {0}", medicoId)
                    ?? "Seu/sua médico(a)";

                var primeiroNome = req.Nome.Split(' ')[0];

                var textBody = $"Olá {primeiroNome},\n\n" +
                    $"{medicoNome} te convidou para o Cérebro Amigo — uma ferramenta de " +
                    "cuidado contínuo entre as consultas.\n\n" +
                    $"Para criar sua senha e começar:\n{url}\n\n" +
                    "O link é válido por 24 horas e é só seu — não compartilhe.\n\n" +
                    "Em momentos difíceis: CVV 188 (24h) · SAMU 192 · pronto-socorro mais próximo.\n\n" +
                    "Cérebro Amigo";

                var htmlBody = $@"<!DOCTYPE html>
<html><head><meta charset=""utf-8""></head>
<body style=""font-family:system-ui,sans-serif;background:#f5f3ff;padding:24px;color:#27272a"">
  <div style=""max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:32px"">
    <div style=""text-align:center;margin-bottom:24px"">
      <span style=""font-size:32px;color:#5b3a8e"">✦</span>
      <h1 style=""font-size:18px;color:#5b3a8e;margin:8px 0 0"">Cérebro Amigo</h1>
    </div>
    <p>Olá <strong>{primeiroNome}</strong>,</p>
    <p><strong>{medicoNome}</strong> te convidou para o Cérebro Amigo —
       uma ferramenta de cuidado contínuo entre as consultas.</p>
    <p>Para criar sua senha e começar:</p>
    <p style=""text-align:center;margin:32px 0"">
      <a href=""{url}""
         style=""display:inline-block;background:#5b3a8e;color:#fff;padding:14px 28px;
                border-radius:10px;text-decoration:none;font-weight:600"">
        Criar minha senha
      </a>
    </p>
    <p style=""font-size:13px;color:#71717a"">
      O link é válido por 24 horas e é só seu — não compartilhe.<br/>
      Se você não esperava este convite, pode ignorar este email.
    </p>
    <hr style=""border:none;border-top:1px solid #e4e4e7;margin:24px 0""/>
    <p style=""font-size:12px;color:#71717a"">
      Em momentos difíceis: CVV 188 (24h) · SAMU 192 · pronto-socorro mais próximo.
    </p>
  </div>
</body></html>";

                var result = await resend.SendAsync(
                    to: emailNorm,
                    subject: $"Bem-vindo(a) ao Cérebro Amigo — convite de {medicoNome}",
                    htmlBody: htmlBody,
                    textBody: textBody);

                emailEnviado = result.Success;
                emailErro = result.Error;
                magicLinkUrl = emailEnviado ? null : url; // fallback só com token persistido
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "falha ao gerar/enviar magic link via email");
                emailErro = ex.Message;
                // magicLinkUrl fica null de propósito: se o INSERT do token falhou, não há
                // link válido a oferecer (médico usa "Reenviar link" na lista depois).
            }

            return Results.Created($"/api/v1/pacientes/{clienteId}", new
            {
                pacienteId = clienteId,
                modo = definirSenha ? "magic_link_e_senha" : "magic_link",
                emailEnviado,
                emailErro,
                magicLinkUrl,
                senhaProvisoria = definirSenha ? req.SenhaInicial : (string?)null,
            });
        });

        // ================================================================
        // IMPORTAR PACIENTES EM LOTE (planilha .xlsx parseada no front)
        // ================================================================
        // Cria pacientes em estado "convite pendente" — SEM senha, SEM e-mail.
        // Convites são ação separada depois. Processa LINHA A LINHA; um erro numa
        // linha NÃO aborta o lote. Tudo escopado ao médico do JWT.
        g.MapPost("/importar", async (
            [FromBody] ImportarPacientesRequest req,
            AppDbContext db, ClaimsPrincipal user, ILogger<Program> logger) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            // ADR-065: importação em lote fura o cap do trial → bloqueada enquanto read-only.
            // Volta a funcionar quando o médico assina um plano.
            if (await EmTrialReadOnlyAsync(db, user))
                return Results.Json(new
                {
                    error = "trial_limite_pacientes",
                    checkoutUrl = "/dashboard/financeiro",
                }, statusCode: StatusCodes.Status403Forbidden);

            var itens = req.Pacientes ?? new List<ImportarLinha>();
            var resultados = new List<ImportarResultadoLinha>(itens.Count);
            int criados = 0, pulados = 0, erros = 0;

            for (var i = 0; i < itens.Count; i++)
            {
                var linha = i + 1;
                var item = itens[i];
                try
                {
                    var r = await CriarPacienteCoreAsync(
                        db, medicoId.Value, item.Nome, item.Email, item.WaId,
                        item.Cpf, item.DataNascimento, logger);

                    switch (r.Tipo)
                    {
                        case CriarTipo.Criado:
                            criados++;
                            resultados.Add(new ImportarResultadoLinha(linha, "criado", null));
                            break;
                        case CriarTipo.JaExistente:
                            pulados++;
                            resultados.Add(new ImportarResultadoLinha(linha, "pulado_duplicado", r.Motivo));
                            break;
                        default: // Conflito | Validacao
                            erros++;
                            resultados.Add(new ImportarResultadoLinha(linha, "erro", r.Motivo));
                            break;
                    }
                }
                catch (Exception ex)
                {
                    logger.LogError(ex, "Falha inesperada ao importar linha {Linha}", linha);
                    erros++;
                    resultados.Add(new ImportarResultadoLinha(
                        linha, "erro", "Erro inesperado ao processar a linha."));
                }
            }

            return Results.Ok(new
            {
                resultados,
                resumo = new { criados, pulados, erros, total = itens.Count },
            });
        });
    }

    // Tipos do resultado do núcleo de criação (compartilhado POST / e /importar).
    private enum CriarTipo { Criado, JaExistente, Conflito, Validacao }
    private sealed record CriarResultado(CriarTipo Tipo, Guid? PacienteId, string? Motivo);

    /// <summary>
    /// Núcleo de criação de paciente: valida e insere `clientes` + `pacientes`,
    /// escopado ao médico do JWT. NÃO cria senha/magic link nem envia e-mail —
    /// o cadastro único faz isso depois usando o PacienteId retornado.
    /// </summary>
    private static async Task<CriarResultado> CriarPacienteCoreAsync(
        AppDbContext db, Guid medicoId,
        string? nome, string? email, string? waId, string? cpf,
        DateOnly? dataNascimento, ILogger logger)
    {
        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(nome))
            return new CriarResultado(CriarTipo.Validacao, null, "nome e e-mail são obrigatórios");

        // WhatsApp obrigatório (fallback de emergência — decisão clínica).
        var wa = string.IsNullOrWhiteSpace(waId)
            ? ""
            : new string(waId.Where(char.IsDigit).ToArray());
        if (wa.Length < 10 || wa.Length > 15)
            return new CriarResultado(CriarTipo.Validacao, null,
                "telefone (WhatsApp) é obrigatório e precisa ter entre 10 e 15 dígitos");

        var emailNorm = email.Trim().ToLowerInvariant();

        // Impede colisão de identidade: e-mail de médico não pode virar paciente.
        if (await db.Database.ExistsAsync("SELECT 1 FROM usuarios WHERE email = {0}", emailNorm))
            return new CriarResultado(CriarTipo.Conflito, null,
                "Esse e-mail já está cadastrado como médico. Não é possível cadastrá-lo como paciente.");

        var clienteId = await db.Database.ExecuteScalarAsync<Guid?>(
            "SELECT id FROM clientes WHERE email = {0}", emailNorm);

        if (clienteId is not null)
        {
            var medicoExistente = await db.Database.ExecuteScalarAsync<Guid?>(
                "SELECT medico_responsavel_id FROM pacientes WHERE cliente_id = {0}", clienteId);
            if (medicoExistente is not null && medicoExistente != medicoId)
                return new CriarResultado(CriarTipo.Conflito, null, "Paciente já cadastrado com outro médico");
            if (medicoExistente == medicoId)
                return new CriarResultado(CriarTipo.JaExistente, clienteId, "Paciente já cadastrado com você");
            // cliente existe mas sem vínculo de paciente (órfão) → cria o vínculo abaixo.
        }
        else
        {
            // `clientes.wa_id` é UNIQUE — valida antes pra devolver conflito claro
            // em vez de deixar a constraint cair no handler global como 500.
            if (wa.Length > 0)
            {
                var donoDoTel = await db.Database.ExecuteScalarAsync<string?>(
                    "SELECT email FROM clientes WHERE wa_id = {0}", wa);
                if (donoDoTel is not null && donoDoTel != emailNorm)
                    return new CriarResultado(CriarTipo.Conflito, null,
                        "Esse WhatsApp já está cadastrado para outro paciente. Confirme o número (com DDD).");
            }

            var newId = Guid.NewGuid();
            try
            {
                await db.Database.ExecuteSqlRawAsync(@"
                    INSERT INTO clientes (id, wa_id, nome, email)
                    VALUES ({0}, NULLIF({1}, ''), {2}, {3})",
                    newId, wa, nome, emailNorm);
            }
            catch (Npgsql.PostgresException pe) when (pe.SqlState == "23505")
            {
                // Safety net pra race (validação prévia + INSERT não são atômicos).
                logger.LogWarning("Conflito UNIQUE ao criar cliente: {Constraint}", pe.ConstraintName);
                var msg = pe.ConstraintName switch
                {
                    "clientes_wa_id_key" => "WhatsApp já cadastrado para outro paciente.",
                    "clientes_email_key" => "E-mail já cadastrado.",
                    _ => "Conflito ao cadastrar paciente (dado duplicado)."
                };
                return new CriarResultado(CriarTipo.Conflito, null, msg);
            }
            clienteId = newId;
        }

        // Cria/garante o vínculo de paciente, escopado ao médico (idempotente).
        await db.Database.ExecuteSqlRawAsync(@"
            INSERT INTO pacientes (cliente_id, medico_responsavel_id, cpf, data_nascimento)
            VALUES ({0}, {1}, NULLIF({2}, ''), {3})
            ON CONFLICT (cliente_id) DO UPDATE SET
              medico_responsavel_id = EXCLUDED.medico_responsavel_id",
            clienteId, medicoId, cpf ?? "", dataNascimento);

        return new CriarResultado(CriarTipo.Criado, clienteId, null);
    }

    private static string SHA256(string s)
    {
        using var sha = System.Security.Cryptography.SHA256.Create();
        return Convert.ToBase64String(sha.ComputeHash(System.Text.Encoding.UTF8.GetBytes(s)));
    }

    private static async Task<Guid?> GetMedicoIdAsync(AppDbContext db, ClaimsPrincipal user)
    {
        var sub = user.FindFirst("sub")?.Value;
        if (!Guid.TryParse(sub, out var userId)) return null;

        return await db.Database.ExecuteScalarAsync<Guid?>(
            "SELECT id FROM medicos WHERE usuario_id = {0}", userId);
    }

    /// <summary>
    /// ADR-065: limita cadastro de pacientes durante o trial read-only. Fora do trial
    /// (plano pago / vencido / sem assinatura) não limita. Fail-open em erro de infra —
    /// nunca bloquear cadastro por falha técnica.
    /// </summary>
    private static async Task<IResult?> TrialCapPacientesAsync(
        AppDbContext db, ClaimsPrincipal user, Guid medicoId, IConfiguration cfg)
    {
        if (!await EmTrialReadOnlyAsync(db, user)) return null;

        var limite = int.TryParse(cfg["TRIAL_MAX_PACIENTES"], out var l) && l > 0 ? l : 5;
        long atual;
        try
        {
            atual = await db.Database.ExecuteScalarAsync<long>(
                "SELECT COUNT(*) FROM pacientes WHERE medico_responsavel_id = {0}", medicoId);
        }
        catch { return null; } // fail-open: nunca bloquear cadastro por erro de infra
        if (atual < limite) return null;

        return Results.Json(new
        {
            error = "trial_limite_pacientes",
            limite,
            checkoutUrl = "/dashboard/financeiro",
        }, statusCode: StatusCodes.Status403Forbidden);
    }

    private static async Task<bool> EmTrialReadOnlyAsync(AppDbContext db, ClaimsPrincipal user)
    {
        var sub = user.FindFirst("sub")?.Value;
        if (!Guid.TryParse(sub, out var usuarioId)) return false; // fail-open
        try
        {
            var sit = await TrialReadOnlyQuery.SituacaoPorUsuarioAsync(db, usuarioId);
            return sit?.TrialReadOnly == true;
        }
        catch { return false; } // fail-open
    }

    private static async Task<bool> PacienteEhDoMedico(
        AppDbContext db, Guid pacienteId, ClaimsPrincipal user, string? recurso = null)
    {
        var medicoId = await GetMedicoIdAsync(db, user);
        if (medicoId is null) return false;

        var ok = await db.Database.ExistsAsync(
            "SELECT 1 FROM pacientes WHERE cliente_id = {0} AND medico_responsavel_id = {1}",
            pacienteId, medicoId.Value);

        // Trilha de acesso (LGPD art.37): registra a leitura concedida quando o
        // chamador identifica o `recurso`. Best-effort — não quebra a leitura.
        if (ok && recurso is not null)
            await db.Database.RegistrarAcessoProntuarioAsync(medicoId.Value, pacienteId, recurso);

        return ok;
    }
}

// DTOs (records)
// `WaId` é nullable porque, após a migração para identificação por email +
// magic link, pacientes podem ser cadastrados sem telefone. Manter `string`
// não-nullable aqui faz o EF Core / Npgsql lançar quando o valor vem NULL
// do banco, devolvendo 500 silencioso na listagem.
public record PacienteListItem(
    long Numero,
    Guid Id, string? WaId, string? Nome, string? Email,
    string? Cpf, DateOnly? DataNascimento, DateTime? ConsentimentoLgpdEm,
    int PrescricoesAtivas, DateTime? UltimaMsg);

public record TimelineItem(
    string Tipo, DateTime Quando, string Titulo, string Descricao,
    int? Intensidade, string Origem);

public record PontoHumor(DateTime Data, double? Humor, double? Ansiedade);

public record AdesaoMedicacao(
    string Medicamento, int Tomadas, int Faltas, int Total, decimal? PercentualAdesao);

public record CriarPacienteRequest(
    string Email,
    string Nome,
    string? WaId,        // obrigatório agora (WhatsApp pra fallback de emergência)
    string? Cpf,
    // `DateOnly?` em vez de `DateTime?` porque a coluna do banco é `date`.
    // Com `DateTime` o Npgsql infere `timestamp with time zone` por default
    // e explode com `Cannot write DateTime with Kind=Unspecified` quando
    // o frontend manda `"2000-01-15"` (sem timezone).
    DateOnly? DataNascimento,
    string? SenhaInicial); // preenchido = fluxo "senha provisória" (sem email)

// Importação em lote — body do POST /api/v1/pacientes/importar
public record ImportarLinha(
    string? Nome, string? Email, string? WaId, string? Cpf, DateOnly? DataNascimento);

public record ImportarPacientesRequest(List<ImportarLinha> Pacientes);

public record ImportarResultadoLinha(int Linha, string Status, string? Motivo);

public sealed record ResumoPreConsultaDto(
    Guid Id,
    string Titulo,
    string Conteudo,
    string Severidade,
    DateTime CriadoEm,
    DateTime? ValidoAte,
    string QualidadeDados,
    int? PeriodoDias);
