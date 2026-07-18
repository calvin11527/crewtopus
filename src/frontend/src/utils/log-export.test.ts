import { describe, it, expect, vi } from 'vitest';
import {
  formatLogLine,
  formatLogEventsAsText,
  formatLogEventsAsJson,
  formatConsoleEntriesAsText,
  logEventToLine,
  consoleEntryToLine,
  serializeLogExportFilters,
  copyConsoleEntriesToClipboard,
} from './log-export';
import type { LogEvent } from '../types';

const sampleEvent: LogEvent = {
  id: 'evt-1',
  severity: 'warn',
  message: 'pipeline stalled',
  createdAt: '2026-06-28T14:30:00.000Z',
  agentType: 'grok',
  workItemId: 'wi-1',
};

describe('log-export', () => {
  it('formats a single line with timestamp, severity, and agent', () => {
    const line = logEventToLine(sampleEvent);
    expect(formatLogLine(line)).toBe('[2026-06-28T14:30:00.000Z] WARN [grok] pipeline stalled');
  });

  it('joins multiple events for .log export', () => {
    const second: LogEvent = {
      ...sampleEvent,
      id: 'evt-2',
      severity: 'error',
      message: 'agent failed',
      agentType: undefined,
      createdAt: '2026-06-28T14:31:00.000Z',
    };
    const text = formatLogEventsAsText([sampleEvent, second]);
    expect(text).toContain('[2026-06-28T14:30:00.000Z] WARN [grok] pipeline stalled');
    expect(text).toContain('[2026-06-28T14:31:00.000Z] ERROR [system] agent failed');
    expect(text.split('\n')).toHaveLength(2);
  });

  it('includes filters in JSON export payload', () => {
    const json = formatLogEventsAsJson([sampleEvent], { severity: 'warn', text: 'pipeline' });
    const parsed = JSON.parse(json) as {
      count: number;
      filters?: Record<string, string>;
      items: LogEvent[];
    };
    expect(parsed.count).toBe(1);
    expect(parsed.filters).toEqual({ severity: 'warn', text: 'pipeline' });
    expect(parsed.items[0].id).toBe('evt-1');
  });

  it('formats console entries with console severity labels', () => {
    const text = formatConsoleEntriesAsText([
      {
        id: 'c-1',
        timestamp: '2026-06-28T14:30:00.000Z',
        severity: 'error',
        message: '[stderr] denied',
      },
    ]);
    expect(text).toBe('[2026-06-28T14:30:00.000Z] ERR [stderr] denied');
    expect(consoleEntryToLine({
      id: 'c-1',
      timestamp: '2026-06-28T14:30:00.000Z',
      severity: 'info',
      message: 'ok',
    }).severity).toBe('INFO');
  });

  it('serializes only active export filters', () => {
    expect(
      serializeLogExportFilters({ severity: 'warn', text: '', agentId: undefined })
    ).toEqual({ severity: 'warn' });
    expect(serializeLogExportFilters({})).toBeUndefined();
  });

  it('copies console entries to clipboard with timestamp and severity', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    const ok = await copyConsoleEntriesToClipboard([
      {
        id: 'c-1',
        timestamp: '2026-06-28T14:30:00.000Z',
        severity: 'warn',
        message: 'slow response',
      },
    ]);

    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith('[2026-06-28T14:30:00.000Z] WARN slow response');
  });
});