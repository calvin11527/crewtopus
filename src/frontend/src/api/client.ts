import type { WSMessage } from '../types';

const API_BASE = '/api';

/* ─── Generic Fetch Wrapper ─── */
async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

/* ─── REST helpers ─── */
export const api = {
  get: <T>(endpoint: string) => request<T>(endpoint),
  post: <T>(endpoint: string, body: unknown) =>
    request<T>(endpoint, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(endpoint: string, body: unknown) =>
    request<T>(endpoint, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(endpoint: string, body: unknown) =>
    request<T>(endpoint, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(endpoint: string) =>
    request<T>(endpoint, { method: 'DELETE' }),
};

/* ─── WebSocket Connection ─── */
export type { WSConnectionStatus } from './websocket-client';
export { WebSocketClient, WS_RECONNECT_DEFAULTS } from './websocket-client';
import { WebSocketClient } from './websocket-client';

/** In dev, connect straight to the backend so Vite restarts do not break the app socket. */
function resolveWebSocketUrl(): string {
  const configured = import.meta.env.VITE_WS_URL;
  if (configured) return configured;

  if (import.meta.env.DEV) {
    const port = import.meta.env.VITE_BACKEND_PORT ?? '3000';
    return `ws://localhost:${port}/ws`;
  }

  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${window.location.host}/ws`;
}

export const wsClient = new WebSocketClient(resolveWebSocketUrl());
