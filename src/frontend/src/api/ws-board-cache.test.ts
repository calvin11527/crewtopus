import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { WorkBoard, WorkItem, WSMessage } from '../types';
import { queryKeys } from './hooks';
import { applyWorkItemSocketMessage, upsertBoardItem } from './ws-board-cache';

function item(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'wi-1',
    key: 'AH-1',
    type: 'task',
    title: 'Task',
    status: 'todo',
    priority: 'medium',
    labels: [],
    acceptanceCriteria: [],
    loopIteration: 0,
    maxLoopIterations: 3,
    loopStatus: 'idle',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function board(items: WorkItem[]): WorkBoard {
  const columns: WorkBoard['columns'] = {
    backlog: [],
    todo: [],
    in_progress: [],
    in_review: [],
    done: [],
  };
  for (const row of items) columns[row.status].push(row);
  return { columns, totals: { items: items.length, points: 0 } };
}

describe('ws board cache', () => {
  it('upserts an item into the matching column', () => {
    const next = upsertBoardItem(board([item()]), item({ status: 'in_progress', loopStatus: 'running' }));
    expect(next.columns.todo).toHaveLength(0);
    expect(next.columns.in_progress[0]?.loopStatus).toBe('running');
  });

  it('patches board cache from work_item:update', () => {
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.board(undefined), board([item()]));
    const msg: WSMessage = {
      type: 'work_item:update',
      payload: { item: item({ status: 'done', title: 'Done' }) },
      timestamp: '2026-01-01T00:00:00.000Z',
    };
    expect(applyWorkItemSocketMessage(qc, msg)).toBe(true);
    const cached = qc.getQueryData<WorkBoard>(queryKeys.board(undefined));
    expect(cached?.columns.done[0]?.title).toBe('Done');
    expect(cached?.columns.todo).toHaveLength(0);
  });

  it('prepends activity without wiping the list', () => {
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.workItemActivity('wi-1'), [
      {
        id: 'a0',
        workItemId: 'wi-1',
        activityType: 'comment',
        summary: 'old',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    applyWorkItemSocketMessage(qc, {
      type: 'work_item:activity',
      payload: {
        workItemId: 'wi-1',
        activity: {
          id: 'a1',
          workItemId: 'wi-1',
          activityType: 'agent_started',
          summary: 'started',
          createdAt: '2026-01-01T00:00:01.000Z',
        },
      },
      timestamp: '2026-01-01T00:00:01.000Z',
    });
    const rows = qc.getQueryData(queryKeys.workItemActivity('wi-1')) as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toEqual(['a1', 'a0']);
  });
});
