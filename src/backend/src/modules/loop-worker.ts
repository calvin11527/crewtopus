import { broadcast } from '../websocket';
import { now } from '../utils/helpers';
import {
  claimNextPendingJob,
  completeLoopJob,
  failLoopJob,
  updateQueueDepthGauge,
  type LoopJob,
} from './job-queue';
import { getWorkItem, runWorkItemAgent, updateWorkItem } from './work-items';
import { logWorkItemActivity } from './work-item-activity';
import {
  runWorkItemPipeline,
  ensureGrokCopilotWorkflow,
  type PipelineResult,
} from './work-item-pipeline';
import { enqueueLoopRetry, shouldAutoChainFixLoop, type LoopRetryPayload } from './loop-retry';
import {
  checkParentStoryRollup,
  runStoryBaPhase,
  runStoryPmPhase,
} from './story-lifecycle';
import { continueFullLifecycleChain } from './full-lifecycle';

const POLL_MS = Number(process.env.AGENTHUB_JOB_POLL_MS) || 500;

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

async function processJob(job: LoopJob): Promise<void> {
  broadcast({
    type: 'loop:job',
    payload: { jobId: job.id, workItemId: job.workItemId, status: 'running' },
    timestamp: now(),
  });

  try {
    if (job.jobType === 'work_item_agent') {
      const result = await runWorkItemAgent(job.workItemId!);
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

      if (job.jobType === 'story_ba') {
        const result = await runStoryBaPhase(job.workItemId!, sprintId);
        completeLoopJob(job.id, {
          item: { id: result.item.id, key: result.item.key, status: result.item.status },
          agentType: result.agentType,
          auditId: result.auditId,
        });
      } else {
        const result = await runStoryPmPhase(job.workItemId!, sprintId);
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

    if (shouldAutoChainFixLoop(payload, result.loopStatus, result.reviewVerdict)) {
      enqueueLoopRetry(job.workItemId!, workflowId, {
        retryMode: 'escalation_continue',
        orchestrator: 'review_retry_chain',
        summary: 'Review requested changes — developer fix loop auto-queued after harness pass',
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
  if (processing) return;
  processing = true;
  try {
    while (true) {
      const job = claimNextPendingJob();
      if (!job) break;
      await processJob(job);
    }
  } finally {
    processing = false;
    updateQueueDepthGauge();
  }
}

export function startLoopWorker(): void {
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    drainQueue().catch((err) => console.error('[LoopWorker]', err.message));
  }, POLL_MS);
  drainQueue().catch((err) => console.error('[LoopWorker]', err.message));
}

export function stopLoopWorker(): void {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}