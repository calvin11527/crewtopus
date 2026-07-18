import { describe, it, expect } from 'vitest';
import { isWorkItemBusy, workItemBusyMessage } from './work-item-busy';
import type { WorkItem } from '../types';

const baseItem: WorkItem = {
  id: 'wi-1',
  key: 'AH-1',
  type: 'task',
  title: 'Test',
  status: 'todo',
  priority: 'medium',
  labels: [],
  acceptanceCriteria: [],
  loopIteration: 0,
  maxLoopIterations: 3,
  loopStatus: 'idle',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('work-item-busy', () => {
  it('returns false for null item', () => {
    expect(isWorkItemBusy(null)).toBe(false);
  });

  it('detects running loop', () => {
    expect(isWorkItemBusy({ ...baseItem, loopStatus: 'running' })).toBe(true);
  });

  it('detects background job flag', () => {
    expect(isWorkItemBusy(baseItem, true)).toBe(true);
  });

  it('describes pipeline busy state', () => {
    const message = workItemBusyMessage({ ...baseItem, loopStatus: 'running' });
    expect(message).toContain('pipeline');
  });
});