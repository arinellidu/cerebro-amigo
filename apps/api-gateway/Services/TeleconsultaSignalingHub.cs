using System.Collections.Concurrent;
using System.Threading.Channels;

namespace ApiGateway.Services;

/// <summary>
/// Relay de sinalização WebRTC em memória, por consulta (sala = consulta_id).
/// Pareia exatamente DOIS peers: <c>medico</c> e <c>paciente</c>. Não trafega
/// mídia — só repassa as mensagens de sinalização (offer/answer/ICE) de um peer
/// para o outro, opacamente. A mídia em si é P2P (DTLS-SRTP) e nunca passa aqui.
///
/// Singleton, estado só em RAM: se o gateway reinicia, a chamada cai e os peers
/// reconectam (o front trata reconexão). Nada de sinalização é persistido —
/// SDP/ICE contêm IPs (PII) e não devem ir a banco nem log.
///
/// Modelo de presença: quando um peer entra, o OUTRO é avisado
/// (<c>{"tipo":"presenca","online":true}</c>). O médico é o "offerer" — ele cria
/// a oferta ao saber que o paciente está online (inclusive em reconexão). O
/// paciente é o "answerer" e só responde à oferta. Isso evita bufferizar
/// sinalização antes de os dois estarem presentes.
/// </summary>
public sealed class TeleconsultaSignalingHub
{
    public const string PapelMedico = "medico";
    public const string PapelPaciente = "paciente";

    private static string Outro(string papel) => papel == PapelMedico ? PapelPaciente : PapelMedico;

    private sealed class Room
    {
        public readonly object Gate = new();
        public readonly Dictionary<string, Channel<string>> Peers = new();
    }

    private readonly ConcurrentDictionary<Guid, Room> _rooms = new();

    /// <summary>
    /// Inscreve um peer na sala e devolve o leitor do seu canal de entrada
    /// (mensagens vindas do outro peer + eventos de presença). Descartar a
    /// <see cref="Subscription"/> (no fim do SSE) remove o peer e avisa o outro.
    /// Uma nova inscrição do mesmo papel encerra a anterior (reconexão).
    /// </summary>
    public Subscription Subscribe(Guid consultaId, string papel)
    {
        var room = _rooms.GetOrAdd(consultaId, _ => new Room());
        var canal = Channel.CreateUnbounded<string>(
            new UnboundedChannelOptions { SingleReader = true, SingleWriter = false });

        lock (room.Gate)
        {
            // Reconexão: encerra um canal anterior do mesmo papel, se houver.
            if (room.Peers.TryGetValue(papel, out var antigo))
                antigo.Writer.TryComplete();

            room.Peers[papel] = canal;

            var outro = Outro(papel);
            var outroOnline = room.Peers.ContainsKey(outro);
            // Avisa este peer se o outro já está online…
            canal.Writer.TryWrite(Presenca(outroOnline));
            // …e avisa o outro que este peer entrou.
            if (outroOnline && room.Peers.TryGetValue(outro, out var canalOutro))
                canalOutro.Writer.TryWrite(Presenca(true));
        }

        return new Subscription(this, consultaId, papel, canal.Reader);
    }

    /// <summary>
    /// Repassa uma mensagem de sinalização do peer <paramref name="dePapel"/>
    /// para o OUTRO peer. Retorna false se o destinatário não está conectado.
    /// </summary>
    public bool Publish(Guid consultaId, string dePapel, string mensagem)
    {
        if (!_rooms.TryGetValue(consultaId, out var room)) return false;
        var destino = Outro(dePapel);
        lock (room.Gate)
        {
            return room.Peers.TryGetValue(destino, out var canal)
                && canal.Writer.TryWrite(mensagem);
        }
    }

    private void Unsubscribe(Guid consultaId, string papel, ChannelReader<string> reader)
    {
        if (!_rooms.TryGetValue(consultaId, out var room)) return;
        lock (room.Gate)
        {
            // Só remove se ainda for o canal corrente (não derruba uma reconexão).
            if (room.Peers.TryGetValue(papel, out var canal) && canal.Reader == reader)
            {
                canal.Writer.TryComplete();
                room.Peers.Remove(papel);

                var outro = Outro(papel);
                if (room.Peers.TryGetValue(outro, out var canalOutro))
                    canalOutro.Writer.TryWrite(Presenca(false)); // avisa o outro que este saiu
            }

            if (room.Peers.Count == 0)
                _rooms.TryRemove(consultaId, out _);
        }
    }

    // Evento de presença: "online" = estado do PEER (o outro lado), do ponto de
    // vista de quem recebe. Sem dados sensíveis.
    private static string Presenca(bool online) =>
        online ? "{\"tipo\":\"presenca\",\"online\":true}" : "{\"tipo\":\"presenca\",\"online\":false}";

    public sealed class Subscription(
        TeleconsultaSignalingHub hub, Guid consultaId, string papel, ChannelReader<string> reader)
        : IDisposable
    {
        public ChannelReader<string> Reader => reader;
        public void Dispose() => hub.Unsubscribe(consultaId, papel, reader);
    }
}
