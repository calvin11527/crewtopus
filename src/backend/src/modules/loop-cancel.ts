/** In-memory cancel signals for active work-item loop runs. */

const cancelledWorkItems = new Set<string>();

/** Request cancellation of an in-flight loop for a work item. */
export function requestLoopCancel(workItemId: string): void {
  cancelledWorkItems.add(workItemId);
}

/** Returns true when a cancel has been requested for the work item. */
export function isLoopCancelled(workItemId?: string): boolean {
  return workItemId ? cancelledWorkItems.has(workItemId) : false;
}

/** Clear cancel flag after loop completes or is cleaned up. */
export function clearLoopCancel(workItemId: string): void {
  cancelledWorkItems.delete(workItemId);
}

export class LoopCancelledError extends Error {
  constructor(workItemId: string) {
    super(`Loop cancelled for work item ${workItemId}`);
    this.name = 'LoopCancelledError';
  }
}