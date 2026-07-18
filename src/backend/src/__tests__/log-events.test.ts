import {
  getLogEvent,
  persistLogEvent,
  persistLogEvents,
  queryLogEvents,
  validateLogEventInput,
} from '../modules/log-events';
import { getDatabase } from '../database';
import { listAgents } from '../modules/agent-registry';

describe('Log Events (AH-60)', () => {
  const grokAgent = () => listAgents().find((a) => a.type === 'grok')!;

  it('persists a single log event to the database', () => {
    const agent = grokAgent();
    const event = persistLogEvent({
      agentId: agent.id,
      agentType: 'grok',
      severity: 'info',
      message: 'Pipeline started',
      source: 'work-item-pipeline',
    });

    expect(event.id).toBeTruthy();
    expect(event.createdAt).toBeTruthy();

    const row = getDatabase()
      .prepare('SELECT * FROM log_event WHERE id = ?')
      .get(event.id) as { message: string; agent_id: string; severity: string };
    expect(row.message).toBe('Pipeline started');
    expect(row.agent_id).toBe(agent.id);
    expect(row.severity).toBe('info');
  });

  it('rejects invalid log input', () => {
    expect(validateLogEventInput({ severity: 'info', message: '' })).toContain('message');
    expect(validateLogEventInput({ severity: 'fatal' as 'info', message: 'x' })).toContain('severity');
  });

  it('persists multiple events in one transaction', () => {
    const events = persistLogEvents([
      { severity: 'debug', message: 'first event' },
      { severity: 'warn', message: 'second event' },
    ]);
    expect(events).toHaveLength(2);
    expect(queryLogEvents({ text: 'first event' }).total).toBe(1);
    expect(queryLogEvents({ text: 'second event' }).total).toBe(1);
  });

  it('queries by agent, severity, text, and date range with total count', () => {
    const agent = grokAgent();
    const t1 = '2026-06-01T10:00:00.000Z';
    const t2 = '2026-06-02T10:00:00.000Z';
    const t3 = '2026-06-03T10:00:00.000Z';

    persistLogEvent({
      agentId: agent.id,
      agentType: 'grok',
      severity: 'info',
      message: 'Grok completed review',
      createdAt: t1,
    });
    persistLogEvent({
      agentId: agent.id,
      agentType: 'grok',
      severity: 'error',
      message: 'Grok adapter timeout',
      createdAt: t2,
    });
    persistLogEvent({
      agentType: 'copilot',
      severity: 'warn',
      message: 'Copilot review requested changes',
      createdAt: t3,
    });

    const byAgent = queryLogEvents({ agentId: agent.id });
    expect(byAgent.total).toBe(2);
    expect(byAgent.items.every((e) => e.agentId === agent.id)).toBe(true);

    const bySeverity = queryLogEvents({ severity: 'error' });
    expect(bySeverity.total).toBe(1);
    expect(bySeverity.items[0].message).toContain('timeout');

    const byText = queryLogEvents({ text: 'review' });
    expect(byText.total).toBe(2);

    const byRange = queryLogEvents({ from: t2, to: t3 });
    expect(byRange.total).toBe(2);
    expect(byRange.items.map((e) => e.severity).sort()).toEqual(['error', 'warn']);
  });

  it('paginates results and returns limit and offset', () => {
    for (let i = 0; i < 5; i++) {
      persistLogEvent({ severity: 'info', message: `paginated event ${i}` });
    }

    const page = queryLogEvents({ text: 'paginated', limit: 2, offset: 1 });
    expect(page.total).toBe(5);
    expect(page.limit).toBe(2);
    expect(page.offset).toBe(1);
    expect(page.items).toHaveLength(2);
  });

  it('retrieves a single event by id', () => {
    const created = persistLogEvent({ severity: 'info', message: 'lookup me' });
    expect(getLogEvent(created.id)?.message).toBe('lookup me');
    expect(getLogEvent('missing-id')).toBeNull();
  });
});