import type { ApprovalRequest } from '../types';
import { now } from '../utils/helpers';
import { broadcast } from '../websocket';
import {
  getActiveJobForWorkItem,
  getLatestResumableJobForWorkItem,
  pauseLoopJob,
  requeueLoopJob,
  type LoopJob,
  type LoopJobType,
} from './job-queue';
import { getWorkItem, prepareWorkItemAgentRun, updateWorkItem } from './work-items';
import { logWorkItemActivity } from './work-item-activity';

function jobMatchesApproval(job: LoopJob, approvalId: string): boolean {
  if (job.status === 'awaiting_approval') {
    const stored = job.result?.approvalRequestId;
    return typeof stored !== 'string' || stored === approvalId;
  }
  if (job.status === 'failed') {
    return (job.error ?? '').includes(approvalId);
  }
  return false;
}

/** Mark the work item as paused for a pending approval (not failed). */
export function markWorkItemAwaitingApproval(workItemId: string, approval: ApprovalRequest): void {
  const item = getWorkItem(workItemId);
  if (!item) return;

  updateWorkItem(workItemId, { status: 'in_review', loopStatus: 'awaiting_approval' });
  logWorkItemActivity({
    workItemId,
    activityType: 'comment',
    summary: `Awaiting approval for ${item.key} (sensitivity ${approval.sensitivityLevel})`,
    metadata: {
      event: 'approval_required',
      approvalId: approval.id,
      sensitivityLevel: approval.sensitivityLevel,
    },
  });
}

/** Pause a running loop job and hold the work item until a human approves. */
export function pauseJobForApproval(job: LoopJob, approval: ApprovalRequest): void {
  pauseLoopJob(job.id, approval, job.loopRunId);
  if (job.workItemId) {
    const item = getWorkItem(job.workItemId);
    if (item?.loopStatus !== 'awaiting_approval') {
      markWorkItemAwaitingApproval(job.workItemId, approval);
    }
  }

  broadcast({
    type: 'loop:job',
    payload: {
      jobId: job.id,
      workItemId: job.workItemId,
      status: 'awaiting_approval',
      jobType: job.jobType,
      approvalRequestId: approval.id,
    },
    timestamp: now(),
  });
}

function reenqueueJob(job: LoopJob, approvalId: string): LoopJob {
  return requeueLoopJob(job, { approvalId });
}

/** After approve/modify, re-queue the original job with the approval id. */
export function resumeAfterApproval(approval: ApprovalRequest): LoopJob | null {
  if (!approval.workItemId) return null;
  if (getActiveJobForWorkItem(approval.workItemId)) return null;

  const latest = getLatestResumableJobForWorkItem(approval.workItemId);
  if (!latest || !jobMatchesApproval(latest, approval.id)) return null;

  const job = reenqueueJob(latest, approval.id);
  const item = getWorkItem(approval.workItemId);
  if (item) {
    prepareWorkItemAgentRun(item.id, job.id);
    if (latest.jobType === 'work_item_pipeline' || latest.jobType === 'workflow_execution') {
      updateWorkItem(item.id, { loopStatus: 'running' });
    } else {
      updateWorkItem(item.id, { loopStatus: 'idle' });
    }
    logWorkItemActivity({
      workItemId: item.id,
      activityType: 'comment',
      summary: `Approval granted — resuming ${latest.jobType.replace(/_/g, ' ')} on ${item.key}`,
      metadata: {
        event: 'approval_resume',
        approvalId: approval.id,
        jobId: job.id,
        jobType: latest.jobType as LoopJobType,
      },
    });
  }

  broadcast({
    type: 'loop:job',
    payload: {
      jobId: job.id,
      workItemId: job.workItemId,
      status: 'pending',
      jobType: job.jobType,
      approvalRequestId: approval.id,
    },
    timestamp: now(),
  });

  return job;
}

/** After reject, leave the work item failed so it can be retried later. */
export function rejectWorkItemApproval(approval: ApprovalRequest): void {
  if (!approval.workItemId) return;
  const item = getWorkItem(approval.workItemId);
  if (!item) return;

  updateWorkItem(item.id, { status: 'todo', loopStatus: 'failed' });
  logWorkItemActivity({
    workItemId: item.id,
    activityType: 'comment',
    summary: `Approval rejected for ${item.key} — agent run cancelled`,
    metadata: { event: 'approval_rejected', approvalId: approval.id },
  });
}
