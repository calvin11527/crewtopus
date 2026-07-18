import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocketClient, type WSConnectionStatus } from './websocket-client';
import type { WSMessage } from '../types';

interface MockSocket {
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: (() => void) | null;
  close: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  readyState: number;
  url: string;
  simulateOpen: () => void;
  simulateMessage: (data: string) => void;
  simulateClose: () => void;
}

const OPEN = 1;
const CONNECTING = 0;
const CLOSED = 3;

let sockets: MockSocket[] = [];

function latestSocket(): MockSocket {
  const socket = sockets.at(-1);
  if (!socket) throw new Error('No mock WebSocket created');
  return socket;
}

function installWebSocketMock() {
  sockets = [];
  class MockWebSocket implements MockSocket {
    static readonly OPEN = OPEN;
    static readonly CONNECTING = CONNECTING;
    static readonly CLOSED = CLOSED;

    url: string;
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    readyState = CONNECTING;
    close = vi.fn(() => {
      this.readyState = CLOSED;
      this.onclose?.();
    });
    send = vi.fn();

    constructor(url: string) {
      this.url = url;
      sockets.push(this);
    }

    simulateOpen() {
      this.readyState = OPEN;
      this.onopen?.();
    }

    simulateMessage(data: string) {
      this.onmessage?.({ data });
    }

    simulateClose() {
      this.readyState = CLOSED;
      this.onclose?.();
    }
  }

  vi.stubGlobal('WebSocket', MockWebSocket);
}

describe('WebSocketClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installWebSocketMock();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    sockets = [];
  });

  it('emits connecting then connected on successful open', () => {
    const client = new WebSocketClient('ws://localhost:3000/ws');
    const statuses: WSConnectionStatus[] = [];
    client.onStatusChange((status) => statuses.push(status));

    client.connect();
    latestSocket().simulateOpen();
    expect(statuses).toContain('connecting');
    expect(statuses.at(-1)).toBe('connected');
  });

  it('reconnects with exponential backoff after disconnect', () => {
    const client = new WebSocketClient('ws://localhost:3000/ws', {
      baseReconnectMs: 1000,
      maxReconnectMs: 30_000,
      jitterRatio: 0,
    });
    const statuses: WSConnectionStatus[] = [];
    client.onStatusChange((status) => statuses.push(status));

    client.connect();
    latestSocket().simulateOpen();
    latestSocket().simulateClose();

    expect(statuses.at(-1)).toBe('connecting');
    expect(sockets).toHaveLength(1);

    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    latestSocket().simulateOpen();
    expect(statuses.at(-1)).toBe('connected');

    latestSocket().simulateClose();
    vi.advanceTimersByTime(2000);
    expect(sockets).toHaveLength(3);
  });

  it('emits failed after max reconnect attempts', () => {
    const client = new WebSocketClient('ws://localhost:3000/ws', {
      maxReconnectAttempts: 2,
      baseReconnectMs: 10,
      jitterRatio: 0,
    });
    const statuses: WSConnectionStatus[] = [];
    client.onStatusChange((status) => statuses.push(status));

    client.connect();
    latestSocket().simulateClose();

    vi.advanceTimersByTime(10);
    latestSocket().simulateClose();

    vi.advanceTimersByTime(20);
    latestSocket().simulateClose();

    expect(statuses.at(-1)).toBe('failed');
    expect(sockets).toHaveLength(3);
  });

  it('ignores messages from stale sockets after reconnect', () => {
    const client = new WebSocketClient('ws://localhost:3000/ws', {
      baseReconnectMs: 10,
      jitterRatio: 0,
    });
    const received: WSMessage[] = [];
    client.subscribe((msg) => received.push(msg));

    client.connect();
    const first = latestSocket();
    first.simulateOpen();
    first.simulateClose();

    vi.advanceTimersByTime(10);
    const second = latestSocket();
    second.simulateOpen();

    const staleMsg: WSMessage = {
      type: 'agent:status',
      timestamp: '2026-07-07T00:00:00.000Z',
      payload: { agentId: 'stale', status: 'idle' },
    };
    const liveMsg: WSMessage = {
      type: 'agent:status',
      timestamp: '2026-07-07T00:00:01.000Z',
      payload: { agentId: 'live', status: 'running' },
    };

    first.simulateMessage(JSON.stringify(staleMsg));
    second.simulateMessage(JSON.stringify(liveMsg));

    expect(received).toHaveLength(1);
    expect(received[0].payload.agentId).toBe('live');
  });

  it('logs backoff delay on each reconnect attempt', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const client = new WebSocketClient('ws://localhost:3000/ws', {
      maxReconnectAttempts: 2,
      baseReconnectMs: 1000,
      jitterRatio: 0,
    });

    client.connect();
    latestSocket().simulateClose();

    expect(infoSpy).toHaveBeenCalledWith(
      '[WS] Reconnecting in 1000ms (attempt 1/2)'
    );

    vi.advanceTimersByTime(1000);
    latestSocket().simulateClose();

    expect(infoSpy).toHaveBeenCalledWith(
      '[WS] Reconnecting in 2000ms (attempt 2/2)'
    );

    vi.advanceTimersByTime(2000);
    latestSocket().simulateClose();

    expect(warnSpy).toHaveBeenCalledWith(
      '[WS] Max reconnect attempts (2) reached; connection failed'
    );

    infoSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('retry closes an existing socket before opening a new connection', () => {
    const client = new WebSocketClient('ws://localhost:3000/ws', { baseReconnectMs: 10 });
    client.connect();
    const first = latestSocket();
    first.simulateOpen();

    client.retry();

    expect(first.close).toHaveBeenCalled();
    expect(sockets).toHaveLength(2);
    latestSocket().simulateOpen();
    expect(client.getConnectionStatus()).toBe('connected');
  });

  it('retry resets backoff and opens a new connection', () => {
    const client = new WebSocketClient('ws://localhost:3000/ws', {
      maxReconnectAttempts: 1,
      baseReconnectMs: 10,
      jitterRatio: 0,
    });
    const statuses: WSConnectionStatus[] = [];
    client.onStatusChange((status) => statuses.push(status));

    client.connect();
    latestSocket().simulateClose();
    vi.advanceTimersByTime(10);
    latestSocket().simulateClose();
    expect(statuses.at(-1)).toBe('failed');

    client.retry();
    expect(statuses.at(-1)).toBe('connecting');
    latestSocket().simulateOpen();
    expect(statuses.at(-1)).toBe('connected');
  });

  it('applies jitter to backoff delay', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(1);

    const client = new WebSocketClient('ws://localhost:3000/ws', {
      baseReconnectMs: 1000,
      jitterRatio: 0.2,
    });
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    client.connect();
    latestSocket().simulateClose();

    expect(infoSpy).toHaveBeenCalledWith(
      '[WS] Reconnecting in 1200ms (attempt 1/12)'
    );

    randomSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it('does not open a second socket while already connected', () => {
    const client = new WebSocketClient('ws://localhost:3000/ws');
    const received: WSMessage[] = [];
    client.subscribe((msg) => received.push(msg));

    client.connect();
    const socket = latestSocket();
    socket.simulateOpen();

    client.connect();
    expect(sockets).toHaveLength(1);

    const msg: WSMessage = {
      type: 'agent:status',
      timestamp: '2026-07-07T00:00:00.000Z',
      payload: { agentId: 'a1', status: 'idle' },
    };
    socket.simulateMessage(JSON.stringify(msg));
    expect(received).toHaveLength(1);
  });

  it('disconnect prevents further reconnect attempts', () => {
    const client = new WebSocketClient('ws://localhost:3000/ws', { baseReconnectMs: 10 });
    client.connect();
    latestSocket().simulateOpen();

    client.disconnect();
    latestSocket().simulateClose();

    vi.advanceTimersByTime(100);
    expect(sockets).toHaveLength(1);
  });
});