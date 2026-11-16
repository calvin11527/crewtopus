/** Cancel signals for active work-item loop runs (in-memory + durable loopStatus). */

import { getWorkItem, updateWorkItem } from './work-items';

const cancelledWorkItems = new Set<string>();

/** Request cancellation of an in-flight loop for a work item (memory + DB). */
export function requestLoopCancel(workItemId: string): void {
  cancelledWorkItems.add(workItemId);
  const item = getWorkItem(workItemId);
  if (item && (item.loopStatus === 'running' || item.loopStatus === 'awaiting_approval')) {
    updateWorkItem(workItemId, {
      loopStatus: 'cancelled',
      status: item.status === 'in_progress' || item.status === 'in_review' ? 'todo' : item.status,
    });
  }
}

/** Returns true when a cancel has been requested for the work item. */
export function isLoopCancelled(workItemId?: string): boolean {
  if (!workItemId) return false;
  if (cancelledWorkItems.has(workItemId)) return true;
  const item = getWorkItem(workItemId);
  return item?.loopStatus === 'cancelled';
}

/** Clear in-memory cancel flag after loop completes or is cleaned up (DB status remains). */
export function clearLoopCancel(workItemId: string): void {
  cancelledWorkItems.delete(workItemId);
}

export class LoopCancelledError extends Error {
  constructor(workItemId: string) {
    super(`Loop cancelled for work item ${workItemId}`);
    this.name = 'LoopCancelledError';
  }
}
