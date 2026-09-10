import { describe, expect, it } from 'vitest';
import type { WorkItem } from '../../types';
import { filterWorkItems, workItemMatchesQuery } from './board-filter';

function item(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: '1',
    key: 'AH-12',
    type: 'task',
    title: 'Search board cards',
    description: 'Filter by key or title',
    status: 'todo',
    priority: 'medium',
    labels: ['lifecycle:pm_done'],
    acceptanceCriteria: [],
    assignedAgentType: 'grok',
    loopIteration: 0,
    maxLoopIterations: 3,
    loopStatus: 'idle',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('board-filter', () => {
  it('matches key, title, agent, and labels', () => {
    const row = item();
    expect(workItemMatchesQuery(row, 'AH-12')).toBe(true);
    expect(workItemMatchesQuery(row, 'board')).toBe(true);
    expect(workItemMatchesQuery(row, 'grok')).toBe(true);
    expect(workItemMatchesQuery(row, 'pm_done')).toBe(true);
    expect(workItemMatchesQuery(row, 'copilot')).toBe(false);
  });

  it('empty query keeps every item', () => {
    expect(filterWorkItems([item(), item({ id: '2', key: 'AH-13' })], '  ')).toHaveLength(2);
  });
});
