import { WebSocketServer, WebSocket } from 'ws';
import type { Server, IncomingMessage } from 'http';
import type { WSMessage } from './types';
import { resolveApiToken } from './middleware/api-auth';

let wss: WebSocketServer | null = null;
const clients = new Set<WebSocket>();

function extractToken(req: IncomingMessage): string | undefined {
  try {
    const host = req.headers.host || 'localhost';
    const url = new URL(req.url || '/ws', `http://${host}`);
    const q = url.searchParams.get('token') || url.searchParams.get('access_token');
    if (q) return q;
  } catch {
    /* ignore */
  }
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  const x = req.headers['x-api-token'];
  if (typeof x === 'string') return x;
  return undefined;
}

/** Attach WebSocket server to an HTTP server. */
export function initWebSocket(server: Server): WebSocketServer {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const expected = resolveApiToken();
    if (expected) {
      const provided = extractToken(req);
      if (provided !== expected) {
        sendToClient(ws, {
          type: 'system:notification',
          payload: { message: 'Unauthorized WebSocket — pass ?token= or Authorization bearer' },
          timestamp: new Date().toISOString(),
        });
        ws.close(1008, 'Unauthorized');
        return;
      }
    }

    clients.add(ws);

    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));

    sendToClient(ws, {
      type: 'system:notification',
      payload: { message: 'Connected to Crewtopus' },
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
