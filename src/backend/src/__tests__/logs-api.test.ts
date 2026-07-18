import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import logsRouter from '../routes/logs';
import { listAgents } from '../modules/agent-registry';
import { persistLogEvent } from '../modules/log-events';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/logs', logsRouter);
  return app;
}

async function request(
  baseUrl: string,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : null;
  return { status: res.status, body: parsed };
}

describe('Logs API (AH-65)', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll((done) => {
    const app = createTestApp();
    server = app.listen(0, () => {
      const addr = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}/api/logs`;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  const grokAgent = () => listAgents().find((a) => a.type === 'grok')!;

  it('GET / returns filtered log events with total count', async () => {
    const agent = grokAgent();
    persistLogEvent({
      agentId: agent.id,
      agentType: 'grok',
      severity: 'info',
      message: 'API list test event',
      createdAt: '2026-06-10T10:00:00.000Z',
    });

    const { status, body } = await request(baseUrl, 'GET', '/?text=API+list+test&severity=info');
    expect(status).toBe(200);
    const data = body as { items: { message: string }[]; total: number; limit: number; offset: number };
    expect(data.total).toBeGreaterThanOrEqual(1);
    expect(data.items.some((e) => e.message === 'API list test event')).toBe(true);
    expect(data.limit).toBe(100);
    expect(data.offset).toBe(0);
  });

  it('GET / accepts query aliases agent, q, startDate, and endDate', async () => {
    const agent = grokAgent();
    const from = '2026-06-11T10:00:00.000Z';
    const to = '2026-06-12T10:00:00.000Z';
    persistLogEvent({
      agentId: agent.id,
      agentType: 'grok',
      severity: 'warn',
      message: 'alias query match',
      createdAt: from,
    });

    const qs = new URLSearchParams({
      agent: agent.id,
      q: 'alias',
      startDate: from,
      endDate: to,
    });
    const { status, body } = await request(baseUrl, 'GET', `/?${qs.toString()}`);
    expect(status).toBe(200);
    const data = body as { items: { message: string }[]; total: number };
    expect(data.total).toBe(1);
    expect(data.items[0].message).toBe('alias query match');
  });

  it('GET / rejects non-numeric limit and offset', async () => {
    const limitRes = await request(baseUrl, 'GET', '/?limit=abc');
    expect(limitRes.status).toBe(400);
    expect((limitRes.body as { message: string }).message).toContain('limit');

    const offsetRes = await request(baseUrl, 'GET', '/?offset=xyz');
    expect(offsetRes.status).toBe(400);
    expect((offsetRes.body as { message: string }).message).toContain('offset');
  });

  it('POST / persists a single log event', async () => {
    const agent = grokAgent();
    const { status, body } = await request(baseUrl, 'POST', '/', {
      agentId: agent.id,
      agentType: 'grok',
      severity: 'error',
      message: 'API create single',
      source: 'test',
    });

    expect(status).toBe(201);
    const event = body as { id: string; message: string; severity: string };
    expect(event.id).toBeTruthy();
    expect(event.message).toBe('API create single');
    expect(event.severity).toBe('error');
  });

  it('POST / persists a batch of log events', async () => {
    const { status, body } = await request(baseUrl, 'POST', '/', {
      events: [
        { severity: 'debug', message: 'batch one' },
        { severity: 'info', message: 'batch two' },
      ],
    });

    expect(status).toBe(201);
    const data = body as { items: { message: string }[]; total: number };
    expect(data.total).toBe(2);
    expect(data.items.map((e) => e.message)).toEqual(['batch one', 'batch two']);
  });

  it('POST / rejects invalid single event input', async () => {
    const { status, body } = await request(baseUrl, 'POST', '/', {
      severity: 'info',
      message: '',
    });
    expect(status).toBe(400);
    expect((body as { message: string }).message).toContain('message');
  });

  it('POST / rejects batch when events is not an array', async () => {
    const { status, body } = await request(baseUrl, 'POST', '/', {
      events: 'not-an-array',
    });
    expect(status).toBe(400);
    expect((body as { message: string }).message).toContain('array');
  });

  it('GET /:id returns a single event or 404', async () => {
    const created = persistLogEvent({ severity: 'info', message: 'lookup via api' });

    const found = await request(baseUrl, 'GET', `/${created.id}`);
    expect(found.status).toBe(200);
    expect((found.body as { message: string }).message).toBe('lookup via api');

    const missing = await request(baseUrl, 'GET', '/missing-log-id');
    expect(missing.status).toBe(404);
    expect((missing.body as { message: string }).message).toContain('not found');
  });
});