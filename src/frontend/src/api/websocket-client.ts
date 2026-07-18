import type { WSMessage } from '../types';

type WSHandler = (msg: WSMessage) => void;

export type WSConnectionStatus = 'connected' | 'connecting' | 'failed';

/** Default reconnect tuning — override per client via {@link WebSocketClientOptions}. */
export const WS_RECONNECT_DEFAULTS = {
  maxAttempts: 12,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  /** Fractional variance applied to each backoff delay (±ratio). */
  jitterRatio: 0.2,
} as const;

export interface WebSocketClientOptions {
  maxReconnectAttempts?: number;
  baseReconnectMs?: number;
  maxReconnectMs?: number;
  jitterRatio?: number;
}

/** Shared WebSocket client with exponential-backoff reconnection and single active stream. */
export class WebSocketClient {
  private ws: WebSocket | null = null;
  private socketGeneration = 0;
  private activeGeneration = 0;
  private handlers = new Set<WSHandler>();
  private statusHandlers = new Set<(status: WSConnectionStatus) => void>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts: number;
  private readonly baseReconnectMs: number;
  private readonly maxReconnectMs: number;
  private readonly jitterRatio: number;
  private intentionalClose = false;
  private status: WSConnectionStatus = 'connecting';
  private readonly url: string;

  constructor(url: string, options: WebSocketClientOptions = {}) {
    this.url = url;
    this.maxReconnectAttempts =
      options.maxReconnectAttempts ?? WS_RECONNECT_DEFAULTS.maxAttempts;
    this.baseReconnectMs =
      options.baseReconnectMs ?? WS_RECONNECT_DEFAULTS.baseDelayMs;
    this.maxReconnectMs =
      options.maxReconnectMs ?? WS_RECONNECT_DEFAULTS.maxDelayMs;
    this.jitterRatio = options.jitterRatio ?? WS_RECONNECT_DEFAULTS.jitterRatio;
  }

  private computeReconnectDelay(): number {
    const baseDelay = Math.min(
      this.baseReconnectMs * 2 ** this.reconnectAttempts,
      this.maxReconnectMs
    );
    if (this.jitterRatio <= 0) return baseDelay;

    const variance = baseDelay * this.jitterRatio;
    const jittered = baseDelay + variance * (Math.random() * 2 - 1);
    return Math.max(0, Math.round(jittered));
  }

  getConnectionStatus(): WSConnectionStatus {
    return this.status;
  }

  onStatusChange(handler: (status: WSConnectionStatus) => void) {
    this.statusHandlers.add(handler);
    handler(this.status);
    return () => {
      this.statusHandlers.delete(handler);
    };
  }

  private emitStatus(status: WSConnectionStatus) {
    this.status = status;
    this.statusHandlers.forEach((h) => h(status));
  }

  private detachSocket(socket: WebSocket) {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    if (socket.readyState !== WebSocket.CLOSED) {
      socket.close();
    }
  }

  connect(force = false) {
    this.intentionalClose = false;

    if (!force) {
      if (this.ws?.readyState === WebSocket.OPEN) return;
      if (this.ws?.readyState === WebSocket.CONNECTING) return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.detachSocket(this.ws);
      this.ws = null;
    }

    this.emitStatus('connecting');

    const generation = ++this.socketGeneration;
    this.activeGeneration = generation;

    try {
      const socket = new WebSocket(this.url);
      this.ws = socket;

      socket.onopen = () => {
        if (this.activeGeneration !== generation) return;
        this.reconnectAttempts = 0;
        this.emitStatus('connected');
      };

      socket.onmessage = (event) => {
        if (this.activeGeneration !== generation) return;
        try {
          const msg: WSMessage = JSON.parse(event.data);
          this.handlers.forEach((h) => h(msg));
        } catch {
          console.warn('[WS] Failed to parse message (binary/text omitted)');
        }
      };

      socket.onclose = () => {
        if (this.activeGeneration !== generation) return;
        if (this.ws === socket) this.ws = null;
        if (this.intentionalClose) return;
        this.scheduleReconnect();
      };

      socket.onerror = () => {
        /* onclose handles reconnect */
      };
    } catch {
      if (this.activeGeneration !== generation) return;
      this.ws = null;
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.intentionalClose) return;

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn(
        `[WS] Max reconnect attempts (${this.maxReconnectAttempts}) reached; connection failed`
      );
      this.emitStatus('failed');
      return;
    }

    this.emitStatus('connecting');

    const delay = this.computeReconnectDelay();
    this.reconnectAttempts += 1;

    console.info(
      `[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  subscribe(handler: WSHandler) {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  send(data: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  disconnect() {
    this.intentionalClose = true;
    this.activeGeneration = 0;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.detachSocket(this.ws);
      this.ws = null;
    }
  }

  /** Reset backoff and try again (e.g. after max attempts). */
  retry() {
    this.reconnectAttempts = 0;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.detachSocket(this.ws);
      this.ws = null;
    }

    this.connect(true);
  }
}