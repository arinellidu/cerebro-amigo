using ApiGateway.Data;
using ApiGateway.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text.Json;

namespace ApiGateway.Endpoints;

/// <summary>
/// Endpoints do portal do paciente.
///
/// Princípios:
///  - Paciente só vê SEUS dados.
///  - Paciente NÃO vê: notas privadas do médico, classificações de IA sobre ele,
///    diagnóstico CID atribuído.
///  - Paciente DECIDE explicitamente o que compartilha (diário).
/// </summary>
public static class PortalPacienteEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/portal/paciente")
            .WithTags("portal-paciente")
            .RequireAuthorization("paciente");

        // ====================================================================
        // VISÃO GERAL (home do portal)
        // ====================================================================
        g.MapGet("/home", async (AppDbContext db, ClaimsPrincipal user) =>
        {
            var pid = PacienteAuthEndpoints.GetPacienteId(user);
            if (pid is null) return Results.Unauthorized();

            var perfil = await db.Database.SqlQueryRaw<PerfilHome>(@"
                SELECT c.nome, m.nome AS nome_medico
                FROM clientes c
                JOIN pacientes p ON p.cliente_id = c.id
                JOIN medicos m ON m.id = p.medico_responsavel_id
                WHERE c.id = {0}", pid.Value).FirstOrDefaultAsync();

            // Próximas tomadas hoje
            var tomadasHoje = await db.Database.SqlQueryRaw<TomadaHoje>(@"
                SELECT t.id, t.horario_previsto,
                       t.status, pr.medicamento,
                       pr.dose_descricao AS dose,
                       pr.id AS prescricao_id
                FROM tomadas_medicacao t
                JOIN prescricoes pr ON pr.id = t.prescricao_id
                WHERE t.paciente_id = {0}
                  AND t.horario_previsto::date = CURRENT_DATE
                ORDER BY t.horario_previsto", pid.Value).ToListAsync();

            // Próxima consulta
            var proxConsulta = await db.Database.SqlQueryRaw<ProximaConsulta>(@"
                SELECT inicia_em, modalidade, status
                FROM consultas
                WHERE paciente_id = {0} AND inicia_em > NOW() AND status IN ('agendada','confirmada')
                ORDER BY inicia_em LIMIT 1", pid.Value).FirstOrDefaultAsync();

            // Último humor registrado
            var ultimoHumor = await db.Database.ExecuteScalarAsync<int?>(@"
                SELECT humor FROM sintomas
                WHERE paciente_id = {0} AND humor IS NOT NULL
                ORDER BY registrado_em DESC LIMIT 1", pid.Value);

            var checkinsPendentes = await db.Database.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*)::int FROM checkins
                WHERE paciente_id = {0}
                  AND respondido_em IS NULL
                  AND expirado_em IS NULL
                  AND agendado_para <= NOW() + INTERVAL '15 minutes'", pid.Value);

            return Results.Ok(new
            {
                perfil = perfil ?? new PerfilHome("", ""),
                tomadasHoje,
                proxConsulta,
                ultimoHumor,
                checkinsPendentes,
                jaRegistrouHumorHoje = await db.Database.ExecuteScalarAsync<int>(@"
                    SELECT COUNT(*)::int FROM sintomas
                    WHERE paciente_id = {0} AND humor IS NOT NULL
                      AND registrado_em::date = CURRENT_DATE", pid.Value) > 0
            });
        });

        // ====================================================================
        // DIÁRIO
        // ====================================================================
        var d = app.MapGroup("/api/v1/portal/paciente/diario")
            .WithTags("portal-paciente-diario")
            .RequireAuthorization("paciente");

        d.MapGet("/", async (AppDbContext db, ClaimsPrincipal user, CryptoService crypto,
            [FromQuery] int page = 1, [FromQuery] int pageSize = 20) =>
        {
            var pid = PacienteAuthEndpoints.GetPacienteId(user);
            if (pid is null) return Results.Unauthorized();

            var entradas = await db.Database.SqlQueryRaw<DiarioEntrada>(@"
                SELECT id, titulo, conteudo,
                       humor, tags,
                       compartilhada_com_medico,
                       criada_em, atualizada_em,
                       tipo, transcricao
                FROM diario_entradas
                WHERE paciente_id = {0}
                ORDER BY criada_em DESC
                OFFSET {1} LIMIT {2}",
                pid.Value, (page - 1) * pageSize, pageSize).ToListAsync();

            // ADR-018: titulo/conteudo/transcricao são cifrados em repouso. Decifra na
            // leitura (no-op em linhas legadas plaintext, sem prefixo v1:).
            var saida = entradas.Select(e => e with
            {
                Titulo = crypto.Decrypt(e.Titulo),
                Conteudo = crypto.Decrypt(e.Conteudo) ?? "",
                Transcricao = crypto.Decrypt(e.Transcricao)
            }).ToList();
            return Results.Ok(saida);
        });

        d.MapGet("/{id:guid}", async (Guid id, AppDbContext db, ClaimsPrincipal user, CryptoService crypto) =>
        {
            var pid = PacienteAuthEndpoints.GetPacienteId(user);
            if (pid is null) return Results.Unauthorized();

            var e = await db.Database.SqlQueryRaw<DiarioEntrada>(@"
                SELECT id, titulo, conteudo,
                       humor, tags,
                       compartilhada_com_medico,
                       criada_em, atualizada_em,
                       tipo, transcricao
                FROM diario_entradas
                WHERE id = {0} AND paciente_id = {1}",
                id, pid.Value).FirstOrDefaultAsync();

            if (e is null) return Results.NotFound();
            // ADR-018: decifra na leitura (no-op em linhas legadas).
            return Results.Ok(e with
            {
                Titulo = crypto.Decrypt(e.Titulo),
                Conteudo = crypto.Decrypt(e.Conteudo) ?? "",
                Transcricao = crypto.Decrypt(e.Transcricao)
            });
        });

        d.MapPost("/", async (
            [FromBody] CriarDiarioRequest req,
            AppDbContext db, IHttpClientFactory httpFactory,
            IConfiguration cfg, ClaimsPrincipal user, CryptoService crypto) =>
        {
            var pid = PacienteAuthEndpoints.GetPacienteId(user);
            if (pid is null) return Results.Unauthorized();

            // Triagem de crise ANTES de salvar (regra #2 clinical-safety).
            // Áudio já foi triado na transcrição; aqui cobrimos texto digitado e
            // transcrições editadas pelo paciente. agents-py decide: se crise,
            // aciona protocolo (texto fixo, trilha, notifica médico, pausa) e a
            // entrada NÃO é salva como nota comum — o front exibe o acolhimento.
            var crise = await TriarCriseTexto(req.Conteudo, pid.Value, httpFactory, cfg);
            if (crise is null)
            {
                // Triagem indisponível (agents-py fora/erro de transporte).
                // Fail-closed (regra #2): não salvamos conteúdo não-triado e não
                // inventamos texto de crise aqui (o gateway não chama LLM nem tem
                // crisis_copy). Paciente tenta de novo.
                return Results.Problem(
                    title: "Não foi possível processar sua entrada agora",
                    detail: "Tente novamente em instantes.",
                    statusCode: StatusCodes.Status503ServiceUnavailable);
            }
            if (crise.Crise)
            {
                return Results.Ok(new
                {
                    crise = true,
                    crise_texto = crise.CriseTexto,
                    salvo = false,
                });
            }

            var id = Guid.NewGuid();
            await db.Database.ExecuteSqlRawAsync(@"
                INSERT INTO diario_entradas
                  (id, paciente_id, titulo, conteudo, humor, tags,
                   compartilhada_com_medico, tipo, transcricao)
                VALUES ({0}, {1}, NULLIF({2}, ''), {3}, {4}, {5}, {6}, {7}, {8})",
                // ADR-018: conteúdo clínico do paciente cifrado em repouso (a triagem de
                // crise acima já usou req.Conteudo em claro, antes de cifrar). Encrypt("")
                // devolve "" → NULLIF zera o título vazio normalmente.
                id, pid.Value, crypto.Encrypt(req.Titulo ?? ""), crypto.Encrypt(req.Conteudo),
                req.Humor, req.Tags ?? Array.Empty<string>(), req.CompartilharComMedico,
                req.Tipo ?? "texto", crypto.Encrypt(req.Transcricao));

            return Results.Created($"/api/v1/portal/paciente/diario/{id}",
                new { id, crise = false, salvo = true });
        });

        d.MapPatch("/{id:guid}", async (
            Guid id, [FromBody] AtualizarDiarioRequest req,
            AppDbContext db, ClaimsPrincipal user, CryptoService crypto) =>
        {
            var pid = PacienteAuthEndpoints.GetPacienteId(user);
            if (pid is null) return Results.Unauthorized();

            // ADR-018: cifra titulo/conteudo editados. Encrypt(null)=null → COALESCE
            // preserva o valor anterior quando o campo não veio no PATCH.
            var rows = await db.Database.ExecuteSqlRawAsync(@"
                UPDATE diario_entradas
                SET titulo = COALESCE({0}, titulo),
                    conteudo = COALESCE({1}, conteudo),
                    humor = COALESCE({2}, humor),
                    tags = COALESCE({3}, tags),
                    compartilhada_com_medico = COALESCE({4}, compartilhada_com_medico),
                    atualizada_em = NOW()
                WHERE id = {5} AND paciente_id = {6}",
                crypto.Encrypt(req.Titulo), crypto.Encrypt(req.Conteudo), req.Humor, req.Tags, req.CompartilharComMedico,
                id, pid.Value);

            return rows > 0 ? Results.NoContent() : Results.NotFound();
        });

        d.MapDelete("/{id:guid}", async (Guid id, AppDbContext db, ClaimsPrincipal user) =>
        {
            var pid = PacienteAuthEndpoints.GetPacienteId(user);
            if (pid is null) return Results.Unauthorized();

            await db.Database.ExecuteSqlRawAsync(
                "DELETE FROM diario_entradas WHERE id = {0} AND paciente_id = {1}",
                id, pid.Value);
            return Results.NoContent();
        });

        // ====================================================================
        // DIÁRIO DE VOZ — transcrição on-demand
        // ====================================================================
        // Recebe áudio (multipart/form-data, campo "audio"), converte para base64,
        // chama agents-py /internal/diario/transcrever, devolve análise ao cliente.
        // O áudio NÃO é persistido — no diário ele nem toca storage: vai em bytes
        // ao agents-py, que transcreve direto no Azure Speech (LGPD, ADR-082).
        // Paciente revisa a transcrição e confirma via POST /diario normal.
        d.MapPost("/audio/transcrever", async (
            HttpRequest httpRequest,
            IHttpClientFactory httpFactory,
            IConfiguration cfg,
            ClaimsPrincipal user) =>
        {
            var pid = PacienteAuthEndpoints.GetPacienteId(user);
            if (pid is null) return Results.Unauthorized();

            if (!httpRequest.HasFormContentType)
                return Results.BadRequest(new { erro = "Esperado multipart/form-data com campo 'audio'" });

            var form = await httpRequest.ReadFormAsync();
            var audioFile = form.Files.GetFile("audio");
            if (audioFile is null || audioFile.Length == 0)
                return Results.BadRequest(new { erro = "Campo 'audio' obrigatório e não pode ser vazio" });

            const long MaxBytes = 10 * 1024 * 1024; // 10 MB
            if (audioFile.Length > MaxBytes)
                return Results.BadRequest(new { erro = "Áudio muito grande (máximo 10 MB)" });

            // Lê bytes e codifica em base64 para enviar via JSON ao agents-py
            using var ms = new MemoryStream();
            await audioFile.CopyToAsync(ms);
            var audioBase64 = Convert.ToBase64String(ms.ToArray());
            var contentType = audioFile.ContentType is { Length: > 0 } ct ? ct : "audio/webm";

            var internalToken = cfg["INTERNAL_API_TOKEN"]
                ?? throw new InvalidOperationException("INTERNAL_API_TOKEN missing");

            var http = httpFactory.CreateClient("agents-py");
            var payload = JsonSerializer.Serialize(new
            {
                audio_base64 = audioBase64,
                content_type = contentType,
                paciente_id = pid.Value,
            });

            using var msg = new HttpRequestMessage(HttpMethod.Post, "/internal/diario/transcrever")
            {
                Content = new StringContent(payload, System.Text.Encoding.UTF8, "application/json"),
            };
            msg.Headers.Authorization = new AuthenticationHeaderValue("Bearer", internalToken);

            using var resp = await http.SendAsync(msg);
            if (!resp.IsSuccessStatusCode)
            {
                var body = await resp.Content.ReadAsStringAsync();
                return Results.Problem(
                    title: "Falha na transcrição de áudio",
                    detail: body,
                    statusCode: (int)resp.StatusCode);
            }

            var json = await resp.Content.ReadAsStringAsync();
            return Results.Content(json, "application/json");
        });

        // ====================================================================
        // HUMOR (registro rápido)
        // ====================================================================
        g.MapPost("/humor", async (
            [FromBody] RegistrarHumorRequest req,
            AppDbContext db, IHttpClientFactory httpFactory,
            IConfiguration cfg, ClaimsPrincipal user) =>
        {
            var pid = PacienteAuthEndpoints.GetPacienteId(user);
            if (pid is null) return Results.Unauthorized();

            // A nota é texto livre do paciente — triagem de crise ANTES de salvar
            // (regra #2 clinical-safety), igual ao diário. Sem nota não há texto a
            // triar; o registro numérico de humor segue direto.
            if (!string.IsNullOrWhiteSpace(req.Nota))
            {
                var crise = await TriarCriseTexto(req.Nota, pid.Value, httpFactory, cfg);
                if (crise is null)
                {
                    // Triagem indisponível: fail-closed (regra #2). Não salvamos a
                    // nota não-triada e não inventamos texto de crise aqui.
                    return Results.Problem(
                        title: "Não foi possível registrar agora",
                        detail: "Tente novamente em instantes.",
                        statusCode: StatusCodes.Status503ServiceUnavailable);
                }
                if (crise.Crise)
                {
                    // agents-py já acionou o protocolo (texto fixo, trilha, notifica
                    // médico, pausa). A nota NÃO é salva; o front exibe o acolhimento.
                    return Results.Ok(new
                    {
                        crise = true,
                        crise_texto = crise.CriseTexto,
                        salvo = false,
                    });
                }
            }

            await db.Database.ExecuteSqlRawAsync(@"
                INSERT INTO sintomas (paciente_id, humor, ansiedade, sono_horas, energia, nota)
                VALUES ({0}, {1}, {2}, {3}, {4}, NULLIF({5}, ''))",
                pid.Value, req.Humor, req.Ansiedade, req.SonoHoras, req.Energia, req.Nota ?? "");
            return Results.NoContent();
        });

        g.MapGet("/humor/historico", async (
            AppDbContext db, ClaimsPrincipal user, [FromQuery] int dias = 30) =>
        {
            var pid = PacienteAuthEndpoints.GetPacienteId(user);
            if (pid is null) return Results.Unauthorized();

            var pontos = await db.Database.SqlQueryRaw<PontoHumor>(@"
                SELECT DATE(registrado_em) AS data,
                       AVG(humor)::float AS humor,
                       AVG(ansiedade)::float AS ansiedade
                FROM sintomas
                WHERE paciente_id = {0}
                  AND registrado_em >= NOW() - ({1} || ' days')::interval
                GROUP BY DATE(registrado_em)
                ORDER BY data", pid.Value, dias).ToListAsync();
            return Results.Ok(pontos);
        });

        // ====================================================================
        // MEDICAÇÕES (visão do paciente)
        // ====================================================================
        g.MapGet("/medicacoes", async (AppDbContext db, ClaimsPrincipal user) =>
        {
            var pid = PacienteAuthEndpoints.GetPacienteId(user);
            if (pid is null) return Results.Unauthorized();

            // União das prescrições da plataforma (MEMED) com as medicações EM USO
            // (reconciliação, ADR-062). O paciente lê as próprias linhas de
            // medicacoes_em_uso via RLS app.current_paciente (migration 0057).
            // `origem` permite o portal distinguir: só prescrições têm tomada/horários
            // (check-in), então o botão "Confirmar" aparece só p/ origem='prescricao'.
            var meds = await db.Database.SqlQueryRaw<MedicacaoPaciente>(@"
                SELECT id, medicamento, dose_descricao, horarios, inicio_em, observacoes,
                       NULL::text AS fonte, 'prescricao' AS origem
                FROM prescricoes
                WHERE paciente_id = {0} AND ativa = TRUE
                UNION ALL
                -- horarios vazio via ARRAY[]::time[] (NUNCA a forma com chaves literais):
                -- o SQL inteiro (comentarios inclusos) passa por String.Format no
                -- SqlQueryRaw, e qualquer chave literal vira placeholder malformado e
                -- quebra em GenerateFromSql (FormatException, 500 antes de tocar o banco).
                -- medicacoes_em_uso nao tem horarios -> array vazio.
                SELECT id, medicamento, COALESCE(posologia, '') AS dose_descricao,
                       ARRAY[]::time[] AS horarios, criado_em::date AS inicio_em, observacoes,
                       fonte, 'em_uso' AS origem
                FROM medicacoes_em_uso
                WHERE paciente_id = {0} AND ativa = TRUE
                ORDER BY medicamento", pid.Value).ToListAsync();
            return Results.Ok(meds);
        });

        // Confirmar tomada via portal (alternativa ao WhatsApp).
        // O id recebido é o da PRESCRIÇÃO (é o que GET /medicacoes devolve), não o
        // da tomada. Confirma a tomada pendente de hoje gerada pelo job de check-ins;
        // se não houver (job não rodou ou dose extra), cria um registro pontual.
        // Em ambos os caminhos o filtro por paciente_id garante isolamento de tenant.
        g.MapPost("/medicacoes/confirmar/{prescricaoId:guid}", async (
            Guid prescricaoId, [FromBody] ConfirmarTomadaRequest req,
            AppDbContext db, ClaimsPrincipal user) =>
        {
            var pid = PacienteAuthEndpoints.GetPacienteId(user);
            if (pid is null) return Results.Unauthorized();

            // 1) Confirma a tomada pendente de hoje desta prescrição (a do gerador).
            var rows = await db.Database.ExecuteSqlRawAsync(@"
                UPDATE tomadas_medicacao
                SET status = {0}, horario_real = NOW(), nota_paciente = NULLIF({1}, '')
                WHERE id = (
                    SELECT id FROM tomadas_medicacao
                    WHERE prescricao_id = {2} AND paciente_id = {3}
                      AND status = 'pendente'
                      AND horario_previsto::date = NOW()::date
                    ORDER BY horario_previsto
                    LIMIT 1
                )",
                req.Status, req.Nota ?? "", prescricaoId, pid.Value);

            // 2) Sem pendente hoje: registra a tomada pontual, validando posse + ativa.
            if (rows == 0)
            {
                rows = await db.Database.ExecuteSqlRawAsync(@"
                    INSERT INTO tomadas_medicacao
                      (prescricao_id, paciente_id, horario_previsto, horario_real,
                       status, nota_paciente)
                    SELECT id, paciente_id, NOW(), NOW(), {0}, NULLIF({1}, '')
                    FROM prescricoes
                    WHERE id = {2} AND paciente_id = {3} AND ativa = TRUE",
                    req.Status, req.Nota ?? "", prescricaoId, pid.Value);
            }

            return rows > 0 ? Results.NoContent() : Results.NotFound();
        });

        // ====================================================================
        // CONVERSA (histórico read-only — paciente vê só a própria thread)
        // ====================================================================
        g.MapGet("/conversa", async (AppDbContext db, ClaimsPrincipal user, CryptoService crypto) =>
        {
            var pid = PacienteAuthEndpoints.GetPacienteId(user);
            if (pid is null) return Results.Unauthorized();

            var msgs = await db.Database.SqlQueryRaw<MensagemConversaPaciente>(@"
                SELECT m.id, m.papel, m.conteudo, m.criada_em
                FROM mensagens m
                JOIN conversas cv ON cv.id = m.conversa_id
                WHERE cv.cliente_id = {0}
                ORDER BY m.criada_em
                LIMIT 100",
                pid.Value).ToListAsync();

            var decrypted = msgs.Select(m => m with {
                Conteudo = crypto.Decrypt(m.Conteudo) ?? m.Conteudo
            }).ToList();

            return Results.Ok(decrypted);
        });

        // Marca onboarding do portal como visto (flag em config_lembretes JSON).
        g.MapPost("/onboarding/concluido", async (AppDbContext db, ClaimsPrincipal user) =>
        {
            var pid = PacienteAuthEndpoints.GetPacienteId(user);
            if (pid is null) return Results.Unauthorized();

            await db.Database.ExecuteRawAsync(@"
                UPDATE pacientes SET config_lembretes =
                  (COALESCE(NULLIF(config_lembretes, ''), '{}')::jsonb
                   || '{""onboarding_visto"": true}'::jsonb)::text
                WHERE cliente_id = {0}", pid.Value);

            return Results.NoContent();
        });

        // ====================================================================
        // PERFIL
        // ====================================================================
        g.MapGet("/perfil", async (AppDbContext db, ClaimsPrincipal user) =>
        {
            var pid = PacienteAuthEndpoints.GetPacienteId(user);
            if (pid is null) return Results.Unauthorized();

            var p = await db.Database.SqlQueryRaw<PerfilCompleto>(@"
                SELECT c.id, c.nome, c.email, c.wa_id,
                       p.cpf, p.data_nascimento,
                       p.telefone, p.cep, p.logradouro, p.numero,
                       p.complemento, p.bairro, p.cidade, p.uf,
                       p.consentimento_lgpd_em,
                       p.config_lembretes,
                       m.nome AS nome_medico, m.crm AS crm_medico
                FROM clientes c
                JOIN pacientes p ON p.cliente_id = c.id
                JOIN medicos m ON m.id = p.medico_responsavel_id
                WHERE c.id = {0}", pid.Value).FirstOrDefaultAsync();
            return p is null ? Results.NotFound() : Results.Ok(p);
        });

        g.MapPatch("/perfil", async (
            [FromBody] AtualizarPerfilRequest req,
            AppDbContext db, ClaimsPrincipal user) =>
        {
            var pid = PacienteAuthEndpoints.GetPacienteId(user);
            if (pid is null) return Results.Unauthorized();

            // ExecuteRawAsync (helper), NÃO ExecuteSqlRawAsync: o EF estoura com
            // parâmetro DBNull.Value (campo nulo: e-mail/CPF/endereço vazios) — o
            // helper normaliza null→DBNull no ADO cru. Era a causa do "erro ao salvar"
            // (qualquer campo vazio → 500). Ver DbExtensions.ExecuteRawAsync.
            await db.Database.ExecuteRawAsync(@"
                UPDATE clientes SET nome = COALESCE({0}, nome), email = COALESCE({1}, email)
                WHERE id = {2}", req.Nome, req.Email, pid.Value);

            await db.Database.ExecuteRawAsync(@"
                UPDATE pacientes SET
                    cpf         = {0},
                    telefone    = {1},
                    cep         = {2},
                    logradouro  = {3},
                    numero      = {4},
                    complemento = {5},
                    bairro      = {6},
                    cidade      = {7},
                    uf          = {8}
                WHERE cliente_id = {9}",
                req.Cpf, req.Telefone, req.Cep, req.Logradouro, req.Numero,
                req.Complemento, req.Bairro, req.Cidade, req.Uf,
                pid.Value);

            return Results.NoContent();
        });
    }

    // ========================================================================
    // Triagem de crise — chama agents-py /internal/diario/triar-texto.
    // Retorna null se a triagem estiver indisponível (transporte/parse) — o
    // chamador trata como fail-closed. NÃO gera texto de crise aqui: o texto
    // fixo de acolhimento vem do agents-py (crisis_copy), nunca do gateway.
    // ========================================================================
    private static async Task<CriseTriagem?> TriarCriseTexto(
        string conteudo, Guid pacienteId,
        IHttpClientFactory httpFactory, IConfiguration cfg)
    {
        try
        {
            var internalToken = cfg["INTERNAL_API_TOKEN"]
                ?? throw new InvalidOperationException("INTERNAL_API_TOKEN missing");

            var http = httpFactory.CreateClient("agents-py");
            var payload = JsonSerializer.Serialize(new
            {
                texto = conteudo,
                paciente_id = pacienteId,
            });

            using var msg = new HttpRequestMessage(HttpMethod.Post, "/internal/diario/triar-texto")
            {
                Content = new StringContent(payload, System.Text.Encoding.UTF8, "application/json"),
            };
            msg.Headers.Authorization = new AuthenticationHeaderValue("Bearer", internalToken);

            using var resp = await http.SendAsync(msg);
            if (!resp.IsSuccessStatusCode) return null;

            var json = await resp.Content.ReadAsStringAsync();
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            var crise = root.TryGetProperty("crise", out var c) && c.GetBoolean();
            string? texto = root.TryGetProperty("crise_texto", out var t)
                && t.ValueKind == JsonValueKind.String
                ? t.GetString()
                : null;
            return new CriseTriagem(crise, texto);
        }
        catch
        {
            return null;
        }
    }
}

// =============================================================================
// DTOs
// =============================================================================

public record CriseTriagem(bool Crise, string? CriseTexto);

public record PerfilHome(string Nome, string NomeMedico);
public record TomadaHoje(Guid Id, DateTime HorarioPrevisto, string Status,
    string Medicamento, string Dose, Guid PrescricaoId);
public record ProximaConsulta(DateTime IniciaEm, string Modalidade, string Status);

public record DiarioEntrada(Guid Id, string? Titulo, string Conteudo, int? Humor,
    string[] Tags, bool CompartilhadaComMedico, DateTime CriadaEm, DateTime AtualizadaEm,
    string Tipo, string? Transcricao);

public record CriarDiarioRequest(string? Titulo, string Conteudo, int? Humor,
    string[]? Tags, bool CompartilharComMedico = false,
    string? Tipo = "texto", string? Transcricao = null);

public record AtualizarDiarioRequest(string? Titulo, string? Conteudo, int? Humor,
    string[]? Tags, bool? CompartilharComMedico);

public record RegistrarHumorRequest(int Humor, int? Ansiedade,
    decimal? SonoHoras, int? Energia, string? Nota);

public record MedicacaoPaciente(Guid Id, string Medicamento, string DoseDescricao,
    TimeOnly[] Horarios, DateTime InicioEm, string? Observacoes, string? Fonte, string Origem);

public record ConfirmarTomadaRequest(string Status, string? Nota);

public record MensagemConversaPaciente(
    Guid Id, string Papel, string Conteudo, DateTime CriadaEm);

public record PerfilCompleto(Guid Id, string? Nome, string? Email, string WaId,
    string? Cpf, DateTime? DataNascimento,
    string? Telefone, string? Cep, string? Logradouro, string? Numero,
    string? Complemento, string? Bairro, string? Cidade, string? Uf,
    DateTime? ConsentimentoLgpdEm,
    string ConfigLembretes, string NomeMedico, string CrmMedico);

public record AtualizarPerfilRequest(
    string? Nome, string? Email,
    string? Cpf, string? Telefone,
    string? Cep, string? Logradouro, string? Numero,
    string? Complemento, string? Bairro, string? Cidade, string? Uf);
