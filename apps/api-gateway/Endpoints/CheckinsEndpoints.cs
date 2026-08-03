using ApiGateway.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text.Json;

namespace ApiGateway.Endpoints;

/// <summary>
/// Endpoints relacionados a check-ins (perguntas agendadas) e push subscriptions.
/// </summary>
public static class CheckinsEndpoints
{
    public static void Map(WebApplication app)
    {
        // ====================================================================
        // CHECK-INS (paciente)
        // ====================================================================
        var c = app.MapGroup("/api/v1/portal/paciente/checkins")
            .WithTags("paciente-checkins")
            .RequireAuthorization("paciente");

        // Lista check-ins pendentes pro paciente (mostra na home)
        c.MapGet("/", async (AppDbContext db, ClaimsPrincipal user) =>
        {
            var pid = PacienteAuthEndpoints.GetPacienteId(user);
            if (pid is null) return Results.Unauthorized();

            var rows = await db.Database.SqlQueryRaw<CheckinDto>(@"
                SELECT id, tipo, payload::text AS payload_json,
                       agendado_para, enviado_em
                FROM checkins
                WHERE paciente_id = {0}
                  AND respondido_em IS NULL
                  AND expirado_em IS NULL
                  AND agendado_para <= NOW() + INTERVAL '15 minutes'
                ORDER BY agendado_para
                LIMIT 20",
                pid.Value).ToListAsync();
            return Results.Ok(rows);
        });

        // Busca um check-in específico (pra abrir após clicar na notificação)
        c.MapGet("/{id:guid}", async (Guid id, AppDbContext db, ClaimsPrincipal user) =>
        {
            var pid = PacienteAuthEndpoints.GetPacienteId(user);
            if (pid is null) return Results.Unauthorized();

            var row = await db.Database.SqlQueryRaw<CheckinDto>(@"
                SELECT id, tipo, payload::text AS payload_json,
                       agendado_para, enviado_em
                FROM checkins
                WHERE id = {0} AND paciente_id = {1}
                  AND respondido_em IS NULL AND expirado_em IS NULL",
                id, pid.Value).FirstOrDefaultAsync();

            return row is null ? Results.NotFound() : Results.Ok(row);
        });

        // Responder check-in
        c.MapPost("/{id:guid}/responder", async (
            Guid id, [FromBody] ResponderCheckinRequest req,
            AppDbContext db, ClaimsPrincipal user,
            IHttpClientFactory httpFactory, IConfiguration cfg) =>
        {
            var pid = PacienteAuthEndpoints.GetPacienteId(user);
            if (pid is null) return Results.Unauthorized();

            // Persiste resposta no check-in
            var respostaJson = JsonSerializer.Serialize(req.Resposta);
            var afetadas = await db.Database.ExecuteSqlRawAsync(@"
                UPDATE checkins
                SET respondido_em = NOW(), resposta = {0}::jsonb
                WHERE id = {1} AND paciente_id = {2}
                  AND respondido_em IS NULL AND expirado_em IS NULL",
                respostaJson, id, pid.Value);

            if (afetadas == 0) return Results.NotFound();

            // Pega tipo do check-in pra processar resposta na tabela certa
            var tipo = await db.Database.ExecuteScalarAsync<string>(
                "SELECT tipo FROM checkins WHERE id = {0}", id);

            switch (tipo)
            {
                case "medicacao":
                    await ProcessarRespostaMedicacao(db, pid.Value, id, req.Resposta);
                    break;
                case "humor_diario":
                    await ProcessarRespostaHumor(db, pid.Value, req.Resposta);
                    break;
                case "questionario_phq9":
                case "questionario_gad7":
                    var rq = await ProcessarRespostaQuestionario(
                        db, pid.Value, tipo, req.Resposta, httpFactory, cfg);
                    // Crise (item 9 do PHQ-9): devolve o acolhimento fixo p/ o portal.
                    if (rq.Crise)
                        return Results.Ok(new { crise = true, criseTexto = rq.CriseTexto });
                    break;
            }

            return Results.NoContent();
        });

        // ====================================================================
        // PUSH SUBSCRIPTIONS
        // ====================================================================
        var p = app.MapGroup("/api/v1/portal/paciente/push")
            .WithTags("paciente-push")
            .RequireAuthorization("paciente");

        // Registra ou atualiza subscription (chamado quando paciente aceita push)
        p.MapPost("/subscribe", async (
            [FromBody] PushSubscribeRequest req,
            AppDbContext db, ClaimsPrincipal user, HttpContext ctx) =>
        {
            var pid = PacienteAuthEndpoints.GetPacienteId(user);
            if (pid is null) return Results.Unauthorized();

            await db.Database.ExecuteSqlRawAsync(@"
                INSERT INTO push_subscriptions
                  (paciente_id, endpoint, p256dh_key, auth_key, user_agent)
                VALUES ({0}, {1}, {2}, {3}, {4})
                ON CONFLICT (endpoint) DO UPDATE SET
                  paciente_id = EXCLUDED.paciente_id,
                  p256dh_key = EXCLUDED.p256dh_key,
                  auth_key = EXCLUDED.auth_key,
                  revogada_em = NULL,
                  ultimo_uso_em = NOW()",
                pid.Value, req.Endpoint, req.P256dhKey, req.AuthKey,
                ctx.Request.Headers["User-Agent"].ToString());
            return Results.NoContent();
        });

        // Desinscrever (paciente desativou notificações)
        p.MapPost("/unsubscribe", async (
            [FromBody] PushUnsubscribeRequest req,
            AppDbContext db, ClaimsPrincipal user) =>
        {
            var pid = PacienteAuthEndpoints.GetPacienteId(user);
            if (pid is null) return Results.Unauthorized();

            await db.Database.ExecuteSqlRawAsync(@"
                UPDATE push_subscriptions SET revogada_em = NOW()
                WHERE paciente_id = {0} AND endpoint = {1}",
                pid.Value, req.Endpoint);
            return Results.NoContent();
        });
    }

    // =========================================================================
    // Processadores específicos por tipo de check-in
    // =========================================================================

    private static async Task ProcessarRespostaMedicacao(AppDbContext db,
        Guid pacienteId, Guid checkinId, Dictionary<string, object> resposta)
    {
        // Resposta tipo: { "status": "tomada" | "esquecida" | "pulou", "nota": "..." }
        var status = resposta.GetValueOrDefault("status")?.ToString() ?? "tomada";
        var nota = resposta.GetValueOrDefault("nota")?.ToString() ?? "";

        // Pega prescricao_id do payload do check-in
        var prescricaoId = await db.Database.ExecuteScalarAsync<Guid?>(@"
            SELECT (payload->>'prescricao_id')::uuid FROM checkins WHERE id = {0}",
            checkinId);

        if (prescricaoId is null) return;

        // Cria registro em tomadas_medicacao
        await db.Database.ExecuteSqlRawAsync(@"
            INSERT INTO tomadas_medicacao
              (prescricao_id, paciente_id, horario_previsto, horario_real,
               status, nota_paciente)
            SELECT {0}, {1}, agendado_para, NOW(), {2}, NULLIF({3}, '')
            FROM checkins WHERE id = {4}",
            prescricaoId, pacienteId, status, nota, checkinId);
    }

    private static async Task ProcessarRespostaHumor(AppDbContext db,
        Guid pacienteId, Dictionary<string, object> resposta)
    {
        // Resposta tipo: { "humor": 7, "ansiedade": 4, "sono_horas": 6.5, "energia": 6, "nota": "..." }
        int? humor = TryInt(resposta, "humor");
        int? ansiedade = TryInt(resposta, "ansiedade");
        decimal? sono = TryDec(resposta, "sono_horas");
        int? energia = TryInt(resposta, "energia");
        var nota = resposta.GetValueOrDefault("nota")?.ToString() ?? "";

        await db.Database.ExecuteSqlRawAsync(@"
            INSERT INTO sintomas (paciente_id, humor, ansiedade, sono_horas, energia, nota)
            VALUES ({0}, {1}, {2}, {3}, {4}, NULLIF({5}, ''))",
            pacienteId, humor, ansiedade, sono, energia, nota);
    }

    private static async Task<QuestionarioResultado> ProcessarRespostaQuestionario(
        AppDbContext db, Guid pacienteId, string tipo, Dictionary<string, object> resposta,
        IHttpClientFactory httpFactory, IConfiguration cfg)
    {
        // Resposta tipo: { "respostas": { "q1": 2, "q2": 3, ... } } (valores 0-3)
        var codigo = tipo.Replace("questionario_", "");
        if (resposta.GetValueOrDefault("respostas") is not JsonElement el
            || el.ValueKind != JsonValueKind.Object)
            return new QuestionarioResultado(false, null);

        // Score determinístico (soma 0-3 por item). Interpretação pelo catálogo.
        int score = 0;
        foreach (var prop in el.EnumerateObject())
            if (prop.Value.TryGetInt32(out var v)) score += v;

        var interpretacao = EscalasCatalogo.Interpretar(codigo, score);
        var respostasJson = JsonSerializer.Serialize(el);

        await db.Database.ExecuteSqlRawAsync(@"
            INSERT INTO questionarios_respostas
              (paciente_id, questionario_id, respostas, score_total, interpretacao)
            SELECT {0}, q.id, {1}::jsonb, {2}, {3}
            FROM questionarios q WHERE q.codigo = {4}",
            pacienteId, respostasJson, score, interpretacao, codigo);

        // Gate de crise: item de ideação (PHQ-9 item 9) > 0 → protocolo fixo.
        // O score JÁ foi gravado (é dado clínico que o médico precisa ver no MBC).
        var chaveIdeacao = EscalasCatalogo.ChaveItemIdeacao(codigo);
        if (chaveIdeacao is not null
            && el.TryGetProperty(chaveIdeacao, out var itemIdeacao)
            && itemIdeacao.TryGetInt32(out var valor) && valor > 0)
        {
            var texto = await DispararCriseAsync(httpFactory, cfg, pacienteId, valor);
            return new QuestionarioResultado(true, texto);
        }

        return new QuestionarioResultado(false, null);
    }

    /// <summary>
    /// Aciona o protocolo de crise no agents-py (texto fixo de crisis_copy, trilha
    /// append-only, notifica médico, pausa automação). Determinístico — sem LLM.
    /// Mesma dependência gateway→agents-py do diário. Em falha, devolve null: o
    /// portal exibe o acolhimento mínimo de emergência (paciente nunca fica sem
    /// recurso). O score já está gravado independentemente.
    /// </summary>
    private static async Task<string?> DispararCriseAsync(
        IHttpClientFactory httpFactory, IConfiguration cfg, Guid pacienteId, int valorItemIdeacao)
    {
        // PHQ-9 item 9: 1=vários dias, 2=mais da metade, 3=quase todos os dias.
        var nivel = valorItemIdeacao >= 3 ? "critico" : valorItemIdeacao == 2 ? "alto" : "moderado";
        var internalToken = cfg["INTERNAL_API_TOKEN"]
            ?? throw new InvalidOperationException("INTERNAL_API_TOKEN missing");

        try
        {
            var http = httpFactory.CreateClient("agents-py");
            var payload = JsonSerializer.Serialize(new
            {
                paciente_id = pacienteId,
                motivo = "ideacao_suicida_phq9",
                nivel,
            });
            using var msg = new HttpRequestMessage(HttpMethod.Post, "/internal/crise/trigger")
            {
                Content = new StringContent(payload, System.Text.Encoding.UTF8, "application/json"),
            };
            msg.Headers.Authorization = new AuthenticationHeaderValue("Bearer", internalToken);

            using var resp = await http.SendAsync(msg);
            if (!resp.IsSuccessStatusCode) return null;

            var json = await resp.Content.ReadAsStringAsync();
            using var doc = JsonDocument.Parse(json);
            return doc.RootElement.TryGetProperty("crise_texto", out var t) ? t.GetString() : null;
        }
        catch
        {
            // Falha de rede/serviço não engole o sinal — o portal mostra acolhimento mínimo.
            return null;
        }
    }

    private static int? TryInt(Dictionary<string, object> d, string k)
    {
        if (!d.TryGetValue(k, out var v)) return null;
        if (v is JsonElement el && el.TryGetInt32(out var i)) return i;
        if (int.TryParse(v?.ToString(), out var p)) return p;
        return null;
    }
    private static decimal? TryDec(Dictionary<string, object> d, string k)
    {
        if (!d.TryGetValue(k, out var v)) return null;
        if (v is JsonElement el && el.TryGetDecimal(out var x)) return x;
        if (decimal.TryParse(v?.ToString(), out var p)) return p;
        return null;
    }
}

public record CheckinDto(
    Guid Id, string Tipo, string PayloadJson,
    DateTime AgendadoPara, DateTime? EnviadoEm);

public record ResponderCheckinRequest(Dictionary<string, object> Resposta);

public record QuestionarioResultado(bool Crise, string? CriseTexto);

public record PushSubscribeRequest(string Endpoint, string P256dhKey, string AuthKey);
public record PushUnsubscribeRequest(string Endpoint);
