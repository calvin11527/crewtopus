import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type { WSMessage } from './types';

let wss: WebSocketServer | null = null;
const clients = new Set<WebSocket>();

/** Attach WebSocket server to an HTTP server. */
export function initWebSocket(server: Server): WebSocketServer {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    clients.add(ws);

    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));

    sendToClient(ws, {
      type: 'system:notification',
      payload: { message: 'Connected to AgentHub' },
      timestamp: new Date().toISOString(),
    });
  });

  return wss;
}

function sendToClient(ws: WebSocket, message: WSMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

/** Broadcast a message to all connected WebSocket clients. */
export function broadcast(message: WSMessage): void {
  const data = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

/** Get count of connected WebSocket clients. */
export function getConnectedClientCount(): number {
  return clients.size;
}

/** Close the WebSocket server. */
export function closeWebSocket(): void {
  for (const client of clients) {
    client.close();
  }
  clients.clear();
  wss?.close();
  wss = null;
}