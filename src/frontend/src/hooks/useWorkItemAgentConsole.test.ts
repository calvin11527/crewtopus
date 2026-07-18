import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWorkItemAgentConsole } from './useWorkItemAgentConsole';
import type { WorkItem } from '../types';
import type { WSMessage } from '../types';

const subscribers = new Set<(msg: WSMessage) => void>();

vi.mock('../api/client', () => ({
  wsClient: {
    subscribe: (handler: (msg: WSMessage) => void) => {
      subscribers.add(handler);
      return () => subscribers.delete(handler);
    },
  },
}));

function emitWs(msg: WSMessage) {
  subscribers.forEach((handler) => handler(msg));
}

const workItem: WorkItem = {
  id: 'wi-59',
  key: 'AH-59',
  title: 'Real-time agent log stream UI',
  type: 'story',
  status: 'in_progress',
  priority: 'medium',
  labels: [],
  acceptanceCriteria: [],
  loopStatus: 'running',
  loopIteration: 1,
  maxLoopIterations: 3,
  sprintId: 'sprint-1',
  createdAt: '2026-06-28T12:00:00.000Z',
  updatedAt: '2026-06-28T12:00:00.000Z',
};

describe('useWorkItemAgentConsole', () => {
  beforeEach(() => {
    subscribers.clear();
  });

  it('appends CLI output from WebSocket in real time', () => {
    const { result } = renderHook(() =>
      useWorkItemAgentConsole({ workItem, activity: undefined })
    );

    act(() => {
      emitWs({
        type: 'work_item:cli_output',
        timestamp: '2026-06-28T12:01:00.000Z',
        payload: {
          workItemId: 'wi-59',
          stream: 'stdout',
          chunk: 'streaming agent thought\n',
          agentType: 'grok',
          phase: 'implement',
        },
      });
    });

    const cliEntry = result.current.entries.find((e) => e.message.includes('streaming agent thought'));
    expect(cliEntry).toBeTruthy();
    expect(cliEntry?.severity).toBe('info');
    expect(result.current.status.isLive).toBe(true);
  });

  it('coalesces streaming CLI chunks into one line', () => {
    const { result } = renderHook(() =>
      useWorkItemAgentConsole({ workItem, activity: undefined })
    );

    act(() => {
      emitWs({
        type: 'work_item:cli_output',
        timestamp: '2026-06-28T12:01:00.000Z',
        payload: { workItemId: 'wi-59', stream: 'stdout', chunk: 'part' },
      });
      emitWs({
        type: 'work_item:cli_output',
        timestamp: '2026-06-28T12:01:00.100Z',
        payload: { workItemId: 'wi-59', stream: 'stdout', chunk: 'ial' },
      });
    });

    const cliEntries = result.current.entries.filter((e) => e.stream === 'stdout');
    expect(cliEntries).toHaveLength(1);
    expect(cliEntries[0].message).toBe('partial');
    expect(cliEntries[0].partial).toBe(true);
  });

  it('ignores CLI output for other work items', () => {
    const { result } = renderHook(() =>
      useWorkItemAgentConsole({ workItem, activity: undefined })
    );
    const before = result.current.entries.length;

    act(() => {
      emitWs({
        type: 'work_item:cli_output',
        timestamp: '2026-06-28T12:01:00.000Z',
        payload: {
          workItemId: 'wi-other',
          stream: 'stdout',
          chunk: 'should not appear\n',
        },
      });
    });

    expect(result.current.entries.length).toBe(before);
  });
});