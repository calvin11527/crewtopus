import { describe, it, expect } from 'vitest';
import {
  buildLogEventsQuery,
  flattenLogEventPages,
  flattenLogPages,
  formatLogEventMessage,
  logEventToConsoleEntry,
  LOG_PAGE_SIZE,
} from './log-events';
import type { LogEvent, LogEventListResponse } from '../types';

describe('log-events utils', () => {
  it('builds query string with all filter params', () => {
    const qs = buildLogEventsQuery({
      agentId: 'agent-1',
      agentType: 'grok',
      severity: 'error',
      text: 'timeout',
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-06-02T00:00:00.000Z',
      limit: LOG_PAGE_SIZE,
      offset: 50,
    });
    expect(qs).toContain('agentId=agent-1');
    expect(qs).toContain('agentType=grok');
    expect(qs).toContain('severity=error');
    expect(qs).toContain('text=timeout');
    expect(qs).toContain('from=');
    expect(qs).toContain('offset=50');
  });

  it('falls back to [system] when agentType is absent', () => {
    const event: LogEvent = {
      id: 'log-0',
      severity: 'info',
      message: 'server started',
      createdAt: '2026-06-01T09:00:00.000Z',
    };
    expect(formatLogEventMessage(event)).toBe('[system] server started');
  });

  it('maps log events to console entries with agent and source labels', () => {
    const event: LogEvent = {
      id: 'log-1',
      agentType: 'grok',
      severity: 'warn',
      message: 'Adapter slow',
      source: 'pipeline',
      createdAt: '2026-06-01T10:00:00.000Z',
    };
    const entry = logEventToConsoleEntry(event);
    expect(entry.severity).toBe('warn');
    expect(entry.message).toBe('[grok] (pipeline) Adapter slow');
    expect(entry.timestamp).toBe(event.createdAt);
  });

  it('flattens paginated responses into chronological order', () => {
    const page1: LogEventListResponse = {
      items: [
        { id: 'c', severity: 'info', message: 'third', createdAt: '2026-06-01T12:00:00.000Z' },
        { id: 'b', severity: 'info', message: 'second', createdAt: '2026-06-01T11:00:00.000Z' },
      ],
      total: 3,
      limit: 2,
      offset: 0,
    };
    const page2: LogEventListResponse = {
      items: [
        { id: 'a', severity: 'info', message: 'first', createdAt: '2026-06-01T10:00:00.000Z' },
      ],
      total: 3,
      limit: 2,
      offset: 2,
    };

    const events = flattenLogEventPages([page1, page2]);
    expect(events.map((e) => e.message)).toEqual(['first', 'second', 'third']);

    const entries = flattenLogPages([page1, page2]);
    expect(entries.map((e) => e.message)).toEqual([
      '[system] first',
      '[system] second',
      '[system] third',
    ]);
  });
});