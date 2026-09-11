import { createWorkItem, getWorkItem, listWorkItemActivity } from '../modules/work-items';
import {
  createApprovalRequest,
  approveRequest,
  rejectRequest,
} from '../modules/approval-gate';
import { enqueueWorkItemAgent, getLoopJob, failLoopJob, claimNextPendingJob } from '../modules/job-queue';
import { pauseJobForApproval, resumeAfterApproval, rejectWorkItemApproval } from '../modules/approval-resume';
import type { ContextScope } from '../types';

function makeScope(): ContextScope {
  return {
    files: ['// notes.md\nsafe'],
    diffs: [],
    symbols: [],
    maxTokens: 8000,
    sensitivityLevel: 2,
  };
}

describe('approval pause/resume', () => {
  it('pauses a running job and resumes it after approve', () => {
    const item = createWorkItem({ type: 'task', title: 'Resume after approve', assignedAgentType: 'mock' });
    const job = enqueueWorkItemAgent(item.id);
    const claimed = claimNextPendingJob();
    expect(claimed?.id).toBe(job.id);

    const pending = createApprovalRequest(makeScope(), undefined, {
      workItemId: item.id,
      summary: `${item.key}/implementation`,
    });

    pauseJobForApproval(claimed!, pending);
    expect(getLoopJob(job.id)?.status).toBe('awaiting_approval');

    const paused = getWorkItem(item.id)!;
    expect(paused.status).toBe('in_review');
    expect(paused.loopStatus).toBe('awaiting_approval');
    expect(listWorkItemActivity(item.id).some((a) => a.metadata?.event === 'approval_required')).toBe(true);

    const approved = approveRequest(pending.id)!;
    const resumed = resumeAfterApproval(approved);
    expect(resumed?.jobType).toBe('work_item_agent');
    expect(resumed?.payload.approvalId).toBe(pending.id);
    expect(resumed?.status).toBe('pending');

    const after = getWorkItem(item.id)!;
    expect(after.status).toBe('in_progress');
    expect(listWorkItemActivity(item.id).some((a) => a.metadata?.event === 'approval_resume')).toBe(true);
  });

  it('resumes a job that failed with the approval request id (legacy failure path)', () => {
    const item = createWorkItem({ type: 'task', title: 'Legacy failed approval', assignedAgentType: 'mock' });
    const job = enqueueWorkItemAgent(item.id);
    const pending = createApprovalRequest(makeScope(), undefined, {
      workItemId: item.id,
      summary: `${item.key}/business_analyst`,
    });
    failLoopJob(job.id, `Approval required for sensitivity level 2. Request ID: ${pending.id}`);

    const approved = approveRequest(pending.id)!;
    const resumed = resumeAfterApproval(approved);
    expect(resumed?.payload.approvalId).toBe(pending.id);
    expect(resumed?.jobType).toBe('work_item_agent');
  });

  it('marks the work item failed when approval is rejected', () => {
    const item = createWorkItem({ type: 'task', title: 'Reject approval', assignedAgentType: 'mock' });
    const pending = createApprovalRequest(makeScope(), undefined, { workItemId: item.id });
    const rejected = rejectRequest(pending.id)!;
    rejectWorkItemApproval(rejected);

    const after = getWorkItem(item.id)!;
    expect(after.status).toBe('todo');
    expect(after.loopStatus).toBe('failed');
    expect(listWorkItemActivity(item.id).some((a) => a.metadata?.event === 'approval_rejected')).toBe(true);
  });
});
