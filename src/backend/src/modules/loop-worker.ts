import { broadcast } from '../websocket';
import { now } from '../utils/helpers';
import { envNumber } from '../utils/env';
import {
  claimNextPendingJob,
  completeLoopJob,
  failLoopJob,
  updateQueueDepthGauge,
  type LoopJob,
} from './job-queue';
import { getWorkItem, runWorkItemAgent, updateWorkItem } from './work-items';
import { logWorkItemActivity } from './work-item-activity';
import { ApprovalRequiredError } from './approval-gate';
import { pauseJobForApproval } from './approval-resume';
import {
  runWorkItemPipeline,
  ensureGrokCopilotWorkflow,
  type PipelineResult,
} from './work-item-pipeline';
import {
  enqueueLoopRetry,
  evalsIndicateBlock,
  shouldAutoChainFixLoop,
  type LoopRetryPayload,
} from './loop-retry';
import {
  checkParentStoryRollup,
  runStoryBaPhase,
  runStoryPmPhase,
} from './story-lifecycle';
import { continueFullLifecycleChain } from './full-lifecycle';

const POLL_MS = envNumber(500, 'CREWTOPUS_JOB_POLL_MS', 'AGENTHUB_JOB_POLL_MS');

/** Concurrent jobs in this process (1–4). One running job per work item is enforced at claim. */
export function resolveJobConcurrency(): number {
  const raw = envNumber(3, 'CREWTOPUS_JOB_CONCURRENCY', 'AGENTHUB_JOB_CONCURRENCY');
  if (!Number.isFinite(raw)) return 3;
  return Math.min(4, Math.max(1, Math.floor(raw)));
}

/** Store compact job results so loop_job rows do not retain full agent transcripts. */
function summarizePipelineJobResult(result: PipelineResult): Record<string, unknown> {
  return {
    loopStatus: result.loopStatus,
    iterations: result.iterations,
    reviewVerdict: result.reviewVerdict,
    loopRunId: result.loopRunId,
    item: {
      id: result.item.id,
      key: result.item.key,
      status: result.item.status,
      loopStatus: result.item.loopStatus,
    },
    steps: result.steps.map((step) => ({
      phase: step.phase,
      stepName: step.stepName,
      agentType: step.agentType,
      auditId: step.auditId,
      filesCreated: step.filesCreated,
      loopIteration: step.loopIteration,
      contentLength: step.content.length,
    })),
    evalResults: result.evalResults?.map((evalResult) => ({
      evalId: evalResult.evalId,
      type: evalResult.type,
      passed: evalResult.passed,
      details: evalResult.details,
    })),
  };
}
let workerTimer: ReturnType<typeof setInterval> | null = null;
let processing = false;
let stopping = false;
let inFlight: Promise<void> | null = null;

async function processJob(job: LoopJob): Promise<void> {
  broadcast({
    type: 'loop:job',
    payload: { jobId: job.id, workItemId: job.workItemId, status: 'running' },
    timestamp: now(),
  });

  try {
    if (job.jobType === 'workflow_execution') {
      const payload = job.payload as {
        executionId: string;
        filePaths?: string[];
        basePath?: string;
        maxTokens?: number;
        workItemId?: string;
        maxLoopIterations?: number;
        autoLoop?: boolean;
      };
      if (!payload.executionId) throw new Error('workflow_execution job missing executionId');
      const { runQueuedWorkflowExecution } = await import('./workflow-engine');
      await runQueuedWorkflowExecution(payload);
      completeLoopJob(job.id, { executionId: payload.executionId, status: 'completed' });
      broadcast({
        type: 'loop:job',
        payload: {
          jobId: job.id,
          workItemId: job.workItemId,
          status: 'completed',
          jobType: job.jobType,
        },
        timestamp: now(),
      });
      return;
    }

    if (job.jobType === 'supervisor_task') {
      const payload = job.payload as {
        taskId: string;
        filePaths?: string[];
        basePath?: string;
        maxTokens?: number;
        approvalId?: string;
      };
      if (!payload.taskId) throw new Error('supervisor_task job missing taskId');
      const { runQueuedSupervisorTask } = await import('./supervisor');
      await runQueuedSupervisorTask(payload);
      completeLoopJob(job.id, { taskId: payload.taskId, status: 'completed' });
      broadcast({
        type: 'loop:job',
        payload: { jobId: job.id, status: 'completed', jobType: job.jobType },
        timestamp: now(),
      });
      return;
    }

    if (job.jobType === 'work_item_agent') {
      const result = await runWorkItemAgent(job.workItemId!, {
        approvalId: (job.payload as { approvalId?: string }).approvalId,
      });
      completeLoopJob(job.id, result as unknown as Record<string, unknown>);

      broadcast({
        type: 'loop:job',
        payload: {
          jobId: job.id,
          workItemId: job.workItemId,
          status: 'completed',
          jobType: job.jobType,
        },
        timestamp: now(),
      });
      return;
    }

    if (job.jobType === 'story_ba' || job.jobType === 'story_pm') {
      const sprintId = (job.payload as { sprintId?: string }).sprintId;
      if (!sprintId) throw new Error('Lifecycle job missing sprintId');

      const approvalId = (job.payload as { approvalId?: string }).approvalId;
      if (job.jobType === 'story_ba') {
        const result = await runStoryBaPhase(job.workItemId!, sprintId, { approvalId });
        completeLoopJob(job.id, {
          item: { id: result.item.id, key: result.item.key, status: result.item.status },
          agentType: result.agentType,
          auditId: result.auditId,
        });
      } else {
        const result = await runStoryPmPhase(job.workItemId!, sprintId, { approvalId });
        completeLoopJob(job.id, {
          item: { id: result.item.id, key: result.item.key, status: result.item.status },
          agentType: result.agentType,
          auditId: result.auditId,
          childCount: result.children.length,
        });
      }

      const nextJob = continueFullLifecycleChain(job);
      if (nextJob) {
        broadcast({
          type: 'loop:job',
          payload: {
            jobId: nextJob.id,
            workItemId: nextJob.workItemId,
            status: 'pending',
            jobType: nextJob.jobType,
            chainedFrom: job.id,
          },
          timestamp: now(),
        });
      }

      broadcast({
        type: 'loop:job',
        payload: {
          jobId: job.id,
          workItemId: job.workItemId,
          status: 'completed',
          jobType: job.jobType,
          chainedJobId: nextJob?.id,
        },
        timestamp: now(),
      });
      return;
    }

    const workflowId = job.workflowId ?? ensureGrokCopilotWorkflow();
    const payload = job.payload as LoopRetryPayload;
    const result = await runWorkItemPipeline(job.workItemId!, {
      ...payload,
      jobId: job.id,
    });

    const evalsBlocked = evalsIndicateBlock(result.evalResults);
    if (shouldAutoChainFixLoop(payload, result.loopStatus, result.reviewVerdict, { evalsPassed: !evalsBlocked })) {
      const reason =
        result.reviewVerdict === 'approved' && evalsBlocked
          ? 'Reviewer APPROVED but harness evals still block — developer fix loop auto-queued'
          : 'Review requested changes — developer fix loop auto-queued after harness pass';
      enqueueLoopRetry(job.workItemId!, workflowId, {
        retryMode: 'escalation_continue',
        orchestrator: 'review_retry_chain',
        summary: reason,
      });
    }

    completeLoopJob(job.id, summarizePipelineJobResult(result), result.loopRunId);

    const completedItem = getWorkItem(job.workItemId!);
    if (completedItem?.parentId) {
      checkParentStoryRollup(completedItem.parentId);
    }

    broadcast({
      type: 'loop:job',
      payload: {
        jobId: job.id,
        workItemId: job.workItemId,
        status: 'completed',
        loopRunId: result.loopRunId,
        loopStatus: result.loopStatus,
        jobType: job.jobType,
      },
      timestamp: now(),
    });
  } catch (err) {
    if (err instanceof ApprovalRequiredError) {
      pauseJobForApproval(job, err.approvalRequest);
      return;
    }

    const message = (err as Error).message;
    failLoopJob(job.id, message);

    if (job.workItemId) {
      const item = getWorkItem(job.workItemId);
      if (item?.status === 'in_progress') {
        updateWorkItem(job.workItemId, {
          status: 'todo',
          loopStatus: job.jobType === 'work_item_pipeline' && item.loopStatus === 'running' ? 'failed' : 'idle',
        });
        logWorkItemActivity({
          workItemId: job.workItemId,
          activityType: 'agent_failed',
          summary: `Agent failed on ${item.key}: ${message}`,
          agentType: item.assignedAgentType,
          agentId: item.assignedAgentId,
          metadata: { error: message, jobId: job.id },
        });
      }
    }

    broadcast({
      type: 'loop:job',
      payload: { jobId: job.id, workItemId: job.workItemId, status: 'failed', error: message },
      timestamp: now(),
    });
  }
}

async function drainQueue(): Promise<void> {
  if (processing || stopping) return;
  processing = true;
  const running = new Set<Promise<void>>();
  try {
    const take = (): boolean => {
      if (stopping || running.size >= resolveJobConcurrency()) return false;
      const job = claimNextPendingJob();
      if (!job) return false;
      let run!: Promise<void>;
      run = processJob(job).finally(() => {
        running.delete(run);
      });
      running.add(run);
      return true;
    };

    while (!stopping) {
      while (take()) {
        /* fill the worker slots */
      }
      if (running.size === 0) break;
      await Promise.race(running);
    }
    await Promise.allSettled([...running]);
  } finally {
    processing = false;
    updateQueueDepthGauge();
  }
}

function kickDrain(): void {
  if (processing || stopping) return;
  const run = drainQueue().catch((err) => console.error('[LoopWorker]', err.message));
  inFlight = run.finally(() => {
    if (inFlight === run) inFlight = null;
  });
}

export function isLoopWorkerRunning(): boolean {
  return workerTimer != null && !stopping;
}

/** Drain pending jobs on this process (used when the poller is not running, e.g. tests). */
export async function drainLoopQueue(): Promise<void> {
  await drainQueue();
}

export function startLoopWorker(): void {
  if (workerTimer) return;
  stopping = false;
  workerTimer = setInterval(() => {
    kickDrain();
  }, POLL_MS);
  kickDrain();
}

/** Stop polling and wait for the in-flight job to finish before closing SQLite. */
export async function stopLoopWorker(): Promise<void> {
  stopping = true;
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
  if (inFlight) {
    await inFlight.catch(() => undefined);
    inFlight = null;
  }
}