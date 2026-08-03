// Tipos e helpers do chat da Rede Social Cérebro Amigo.

import * as signalR from "@microsoft/signalr"

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface ConversaPreview {
  id: string
  tipo: "dm" | "grupo"
  nome: string | null
  fotoUrl: string | null
  ultimaMensagem: string | null
  ultimaMensagemEm: string | null
  ultimoAutorId: string | null
  naoLidas: number
  ultimaLeituraEm: string | null
}

export interface Mensagem {
  id: string
  corpo: string
  tipoConteudo: string
  criadoEm: string
  autorId: string
  autorHandle: string
  autorNome: string
  autorFoto: string | null
  autorVerificado: boolean
  minha: boolean
}

export interface Membro {
  medicoId: string
  handle: string
  nome: string
  especialidade: string | null
  fotoUrl: string | null
  verificado: boolean
  role: string
  entrouEm: string
}

export interface NovaMensagemPayload {
  id: string
  conversaId: string
  autorId: string
  autorNome: string
  corpo: string
  criadoEm: string
}

// ─── SignalR connection factory ──────────────────────────────────────────────

const HUB_URL = process.env.NEXT_PUBLIC_HUB_URL
  ? `${process.env.NEXT_PUBLIC_HUB_URL}/hubs/chat`
  : "http://localhost:5050/hubs/chat"

let connection: signalR.HubConnection | null = null

export function getChatConnection(token: string): signalR.HubConnection {
  if (connection && connection.state !== signalR.HubConnectionState.Disconnected) {
    return connection
  }

  connection = new signalR.HubConnectionBuilder()
    .withUrl(HUB_URL, {
      accessTokenFactory: () => token,
    })
    .withAutomaticReconnect()
    .build()

  return connection
}

export function disconnectChat() {
  if (connection) {
    connection.stop()
    connection = null
  }
}
