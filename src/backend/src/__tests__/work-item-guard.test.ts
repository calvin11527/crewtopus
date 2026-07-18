import { createWorkItem, updateWorkItem } from '../modules/work-items';
import {
  isWorkItemBusy,
  workItemBusyMessage,
  assertWorkItemRunnable,
  assertWorkItemEditable,
  WorkItemBusyError,
} from '../modules/work-item-guard';

describe('work-item-guard', () => {
  it('detects running loop as busy', () => {
    const item = createWorkItem({ type: 'task', title: 'Busy test', status: 'todo' });
    expect(isWorkItemBusy({ ...item, loopStatus: 'running', status: 'in_progress' })).toBe(true);
    expect(workItemBusyMessage({ ...item, key: item.key, loopStatus: 'running', status: 'in_progress' })).toContain(
      'pipeline'
    );
  });

  it('allows run when board status is in_progress but no active pipeline', () => {
    const item = createWorkItem({ type: 'task', title: 'Guard test', status: 'in_progress' });
    expect(isWorkItemBusy(item)).toBe(false);
    expect(() => assertWorkItemRunnable(item.id)).not.toThrow();
    expect(() => assertWorkItemEditable(item.id)).not.toThrow();
  });

  it('blocks edit when loop is running', () => {
    const item = createWorkItem({ type: 'task', title: 'Edit guard', status: 'in_progress' });
    updateWorkItem(item.id, { loopStatus: 'running' });
    expect(() => assertWorkItemEditable(item.id)).toThrow(WorkItemBusyError);
  });
});