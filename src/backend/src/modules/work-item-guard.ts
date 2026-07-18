import type { WorkItem } from '../types';
import { getActiveJobForWorkItem } from './job-queue';
import { getWorkItem } from './work-items';

export class WorkItemBusyError extends Error {
  readonly workItemId: string;
  readonly reason: string;

  constructor(workItemId: string, reason: string) {
    super(reason);
    this.name = 'WorkItemBusyError';
    this.workItemId = workItemId;
    this.reason = reason;
  }
}

export function isWorkItemBusy(item: Pick<WorkItem, 'status' | 'loopStatus'>, hasActiveJob = false): boolean {
  return hasActiveJob || item.loopStatus === 'running';
}

export function workItemBusyMessage(item: Pick<WorkItem, 'key' | 'status' | 'loopStatus'>, hasActiveJob = false): string {
  if (item.loopStatus === 'running') {
    return `${item.key} is running an agent pipeline. Wait for it to finish or cancel the loop before editing or re-running.`;
  }
  if (hasActiveJob) {
    return `${item.key} has a background job in progress. Wait for completion before editing or re-running.`;
  }
  return '';
}

function assertWorkItemNotBusy(workItemId: string): WorkItem {
  const item = getWorkItem(workItemId);
  if (!item) throw new Error('Work item not found');

  const activeJob = getActiveJobForWorkItem(workItemId);
  const busy = isWorkItemBusy(item, Boolean(activeJob));
  if (busy) {
    throw new WorkItemBusyError(workItemId, workItemBusyMessage(item, Boolean(activeJob)));
  }
  return item;
}

/** Ensure a work item can start a new agent run or pipeline. */
export function assertWorkItemRunnable(workItemId: string): WorkItem {
  return assertWorkItemNotBusy(workItemId);
}

/** Ensure a work item can be edited or deleted (same guard as runnable). */
export function assertWorkItemEditable(workItemId: string): WorkItem {
  return assertWorkItemNotBusy(workItemId);
}