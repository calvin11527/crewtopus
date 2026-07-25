import type { WSMessage } from '../types';

const API_BASE = '/api';

/** Optional API token (matches CREWTOPUS_API_TOKEN / AGENTHUB_API_TOKEN on the server). */
function resolveClientApiToken(): string | undefined {
  try {
    const fromLs = localStorage.getItem('crewtopusApiToken') || localStorage.getItem('agenthubApiToken');
    if (fromLs?.trim()) return fromLs.trim();
  } catch {
    /* ignore */
  }
  const fromEnv = import.meta.env.VITE_CREWTOPUS_API_TOKEN || import.meta.env.VITE_AGENTHUB_API_TOKEN;
  return typeof fromEnv === 'string' && fromEnv.trim() ? fromEnv.trim() : undefined;
}

/* ─── Generic Fetch Wrapper ─── */
async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = resolveClientApiToken();
  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token
        ? { Authorization: `Bearer ${token}`, 'X-Api-Token': token }
        : {}),
      ...options.headers,
    },
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
  let base: string;
  if (configured) {
    base = configured;
  } else if (import.meta.env.DEV) {
    const port = import.meta.env.VITE_BACKEND_PORT ?? '3000';
    base = `ws://localhost:${port}/ws`;
  } else {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    base = `${wsProtocol}//${window.location.host}/ws`;
  }

  const token = resolveClientApiToken();
  if (!token) return base;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}token=${encodeURIComponent(token)}`;
}

export const wsClient = new WebSocketClient(resolveWebSocketUrl());
