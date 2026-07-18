import { describe, it, expect } from 'vitest';
import {
  createConsoleEntry,
  formatCliOutputEntries,
  formatWorkItemConsoleEntry,
  INITIAL_CLI_STREAM_STATE,
  integrateCliOutput,
} from './work-item-console';
import type { WSMessage } from '../types';

describe('work-item-console entries', () => {
  it('maps stdout CLI chunks to info severity', () => {
    const msg: WSMessage = {
      type: 'work_item:cli_output',
      timestamp: '2026-06-28T12:00:00.000Z',
      payload: {
        workItemId: 'wi-1',
        stream: 'stdout',
        chunk: 'thinking about the fix\n',
      },
    };
    const entries = formatCliOutputEntries(msg);
    expect(entries).toHaveLength(1);
    expect(entries[0].severity).toBe('info');
    expect(entries[0].stream).toBe('stdout');
    expect(entries[0].message).toBe('thinking about the fix');
  });

  it('maps stderr CLI chunks to error severity', () => {
    const msg: WSMessage = {
      type: 'work_item:cli_output',
      timestamp: '2026-06-28T12:00:01.000Z',
      payload: {
        workItemId: 'wi-1',
        stream: 'stderr',
        chunk: 'tool failed',
      },
    };
    const entries = formatCliOutputEntries(msg);
    expect(entries[0].severity).toBe('error');
    expect(entries[0].message).toContain('[stderr]');
  });

  it('formats pipeline step started as info', () => {
    const msg: WSMessage = {
      type: 'work_item:pipeline_step',
      timestamp: '2026-06-28T12:00:02.000Z',
      payload: {
        workItemId: 'wi-1',
        phase: 'implement',
        agentType: 'grok',
        status: 'started',
        loopIteration: 1,
      },
    };
    const entry = formatWorkItemConsoleEntry(msg);
    expect(entry?.severity).toBe('info');
    expect(entry?.message).toContain('implement');
    expect(entry?.message).toContain('grok');
  });

  it('formats agent failure activity as error', () => {
    const msg: WSMessage = {
      type: 'work_item:activity',
      timestamp: '2026-06-28T12:00:03.000Z',
      payload: {
        workItemId: 'wi-1',
        activity: {
          id: 'act-1',
          workItemId: 'wi-1',
          activityType: 'agent_failed',
          summary: 'Adapter exited with code 1',
          agentType: 'grok',
          createdAt: '2026-06-28T12:00:03.000Z',
        },
      },
    };
    const entry = formatWorkItemConsoleEntry(msg);
    expect(entry?.severity).toBe('error');
    expect(entry?.message).toContain('Adapter exited');
  });

  it('assigns unique ids to entries', () => {
    const a = createConsoleEntry('2026-06-28T12:00:00.000Z', 'info', 'one');
    const b = createConsoleEntry('2026-06-28T12:00:00.000Z', 'info', 'two');
    expect(a.id).not.toBe(b.id);
  });

  it('strips ANSI CSI escape codes from CLI stdout', () => {
    const msg: WSMessage = {
      type: 'work_item:cli_output',
      timestamp: '2026-06-28T12:00:04.000Z',
      payload: {
        workItemId: 'wi-1',
        stream: 'stdout',
        chunk: '\x1b[90m💭 thinking\x1b[0m\n',
      },
    };
    const entries = formatCliOutputEntries(msg);
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe('💭 thinking');
    expect(entries[0].message).not.toContain('\x1b');
  });

  it('strips ANSI OSC sequences from CLI stdout', () => {
    const msg: WSMessage = {
      type: 'work_item:cli_output',
      timestamp: '2026-06-28T12:00:04.500Z',
      payload: {
        workItemId: 'wi-1',
        stream: 'stdout',
        chunk: '\x1b]8;;https://example.com\x07link text\x1b]8;;\x07\n',
      },
    };
    const entries = formatCliOutputEntries(msg);
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe('link text');
    expect(entries[0].message).not.toContain('\x1b');
  });

  it('maps loop escalation to warn severity', () => {
    const msg: WSMessage = {
      type: 'work_item:loop_update',
      timestamp: '2026-06-28T12:00:05.000Z',
      payload: {
        workItemId: 'wi-1',
        loopIteration: 3,
        maxLoopIterations: 3,
        loopStatus: 'escalated',
      },
    };
    const entry = formatWorkItemConsoleEntry(msg);
    expect(entry?.severity).toBe('warn');
    expect(entry?.message).toContain('escalated');
  });

  it('maps loop failure to error severity', () => {
    const msg: WSMessage = {
      type: 'work_item:loop_update',
      timestamp: '2026-06-28T12:00:06.000Z',
      payload: {
        workItemId: 'wi-1',
        loopIteration: 2,
        maxLoopIterations: 3,
        loopStatus: 'failed',
      },
    };
    const entry = formatWorkItemConsoleEntry(msg);
    expect(entry?.severity).toBe('error');
    expect(entry?.message).toContain('failed');
  });

  it('coalesces partial CLI chunks into one updating line', () => {
    let state = INITIAL_CLI_STREAM_STATE;
    let entries: ReturnType<typeof integrateCliOutput>['entries'] = [];

    const first: WSMessage = {
      type: 'work_item:cli_output',
      timestamp: '2026-06-28T12:00:07.000Z',
      payload: { workItemId: 'wi-1', stream: 'stdout', chunk: 'token' },
    };
    ({ entries, state } = integrateCliOutput(entries, first, state));
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe('token');
    expect(entries[0].partial).toBe(true);

    const second: WSMessage = {
      type: 'work_item:cli_output',
      timestamp: '2026-06-28T12:00:07.100Z',
      payload: { workItemId: 'wi-1', stream: 'stdout', chunk: ' stream' },
    };
    ({ entries, state } = integrateCliOutput(entries, second, state));
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe('token stream');
    expect(entries[0].partial).toBe(true);

    const third: WSMessage = {
      type: 'work_item:cli_output',
      timestamp: '2026-06-28T12:00:07.200Z',
      payload: { workItemId: 'wi-1', stream: 'stdout', chunk: '\nnext\n' },
    };
    ({ entries, state } = integrateCliOutput(entries, third, state));
    expect(entries).toHaveLength(2);
    expect(entries[0].message).toBe('token stream');
    expect(entries[0].partial).toBe(false);
    expect(entries[1].message).toBe('next');
  });
});