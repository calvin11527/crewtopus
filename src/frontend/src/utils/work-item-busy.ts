import type { WorkItem } from '../types';

export function isWorkItemBusy(
  item: Pick<WorkItem, 'status' | 'loopStatus'> | null | undefined,
  hasActiveJob = false
): boolean {
  if (!item) return false;
  return hasActiveJob || item.loopStatus === 'running' || item.loopStatus === 'awaiting_approval';
}

export function workItemBusyMessage(
  item: Pick<WorkItem, 'key' | 'status' | 'loopStatus'>,
  hasActiveJob = false
): string {
  if (item.loopStatus === 'running') {
    return `${item.key} is running an agent pipeline. Wait for it to finish or cancel the loop before editing or re-running.`;
  }
  if (item.loopStatus === 'awaiting_approval') {
    return `${item.key} is waiting for approval of a sensitive outbound request. Approve or reject it on Privacy & Security.`;
  }
  if (hasActiveJob) {
    return `${item.key} has a background job in progress. Wait for completion before editing or re-running.`;
  }
  return '';
}