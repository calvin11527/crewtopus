import type { WorkItem } from '../types';
import {
  enqueueStoryLifecycleJob,
  enqueueWorkItemPipeline,
  getActiveJobForWorkItem,
  type LoopJob,
} from './job-queue';
import {
  getStoryLifecyclePhase,
  listStoryChildren,
  nextRunnableDevItem,
  recoverStuckStory,
  runStoryBaPhase,
  runStoryPmPhase,
  type StoryLifecyclePhase,
} from './story-lifecycle';
import { getSprintTeamMemberByRole } from './sprint-team';
import { getAgent } from './agent-registry';
import type { Agent, AgentRole } from '../types';
import {
  ensureGrokCopilotWorkflow,
  runWorkItemPipeline,
  type PipelineResult,
} from './work-item-pipeline';
import { getWorkItem, prepareWorkItemAgentRun, updateWorkItem } from './work-items';
import { logWorkItemActivity } from './work-item-activity';
import { WorkItemBusyError, workItemBusyMessage } from './work-item-guard';

export type FullLifecycleStep = 'ba' | 'pm' | 'pipeline';

export interface FullLifecycleOptions {
  maxIterations?: number;
  autoLoop?: boolean;
  /** Who kicked off the chain (shown in activity). */
  orchestrator?: string;
}

export interface FullLifecycleChainPayload extends FullLifecycleOptions {
  sprintId: string;
  chainFullLifecycle: true;
  /** Story that owns BA/PM phases (may differ from pipeline work item). */
  storyId: string;
}

export interface FullLifecycleStartResult {
  job: LoopJob;
  step: FullLifecycleStep;
  workItemId: string;
  storyId?: string;
  alreadyQueued?: boolean;
  message: string;
  phase: StoryLifecyclePhase | 'n/a';
}

export interface FullLifecycleSyncResult {
  storyId: string;
  phase: StoryLifecyclePhase | 'n/a';
  ba?: Awaited<ReturnType<typeof runStoryBaPhase>>;
  pm?: Awaited<ReturnType<typeof runStoryPmPhase>>;
  pipeline?: PipelineResult;
  pipelineWorkItemId?: string;
  skippedSteps: FullLifecycleStep[];
  message: string;
}

function assertNotBusy(workItemId: string): WorkItem {
  const item = getWorkItem(workItemId);
  if (!item) throw new Error('Work item not found');
  const active = getActiveJobForWorkItem(workItemId);
  if (active || item.loopStatus === 'running') {
    throw new WorkItemBusyError(workItemId, workItemBusyMessage(item, Boolean(active)));
  }
  return item;
}

/** Require a staffed, enabled sprint team member (no global type fallback). */
function requireStaffedRole(sprintId: string, role: AgentRole): Agent {
  const member = getSprintTeamMemberByRole(sprintId, role);
  const label = role.replace(/_/g, ' ');
  if (!member) {
    throw new Error(`No ${label} staffed on this sprint — hire/staff one before full lifecycle`);
  }
  const agent = getAgent(member.agentId);
  if (!agent?.enabled) {
    throw new Error(`Staffed ${label} is missing or disabled`);
  }
  return agent;
}

function chainPayload(
  storyId: string,
  sprintId: string,
  options: FullLifecycleOptions
): FullLifecycleChainPayload {
  return {
    sprintId,
    storyId,
    chainFullLifecycle: true,
    maxIterations: options.maxIterations,
    autoLoop: options.autoLoop !== false,
    orchestrator: options.orchestrator ?? 'manual_full_lifecycle',
  };
}

/** Prefer an open child task, else the story itself when developer-runnable. */
export function resolveFullLifecyclePipelineTarget(story: WorkItem): WorkItem | null {
  if (story.type !== 'story') return story;

  const children = listStoryChildren(story.id).filter((c) => c.status !== 'done');
  const openTodo = children.find(
    (c) =>
      (c.status === 'todo' || c.status === 'backlog') &&
      c.loopStatus !== 'running' &&
      c.loopStatus !== 'failed' &&
      c.loopStatus !== 'escalated'
  );
  if (openTodo) return openTodo;

  const anyOpen = children.find((c) => c.status !== 'done');
  if (anyOpen) return anyOpen;

  if (story.sprintId) {
    const next = nextRunnableDevItem(story.sprintId);
    if (next && (next.id === story.id || next.parentId === story.id)) return next;
  }

  const phase = getStoryLifecyclePhase(story);
  if (phase === 'dev_ready' || phase === 'complete') return story;
  return null;
}

function enqueuePipelineForTarget(
  target: WorkItem,
  options: FullLifecycleOptions,
  storyId?: string
): FullLifecycleStartResult {
  const existing = getActiveJobForWorkItem(target.id);
  if (existing) {
    return {
      job: existing,
      step: 'pipeline',
      workItemId: target.id,
      storyId,
      alreadyQueued: true,
      message: `${target.key} already has a queued/running job`,
      phase: storyId ? getStoryLifecyclePhase(getWorkItem(storyId)!) : 'n/a',
    };
  }

  const workflowId = ensureGrokCopilotWorkflow();
  const job = enqueueWorkItemPipeline(target.id, workflowId, {
    maxIterations: options.maxIterations ?? 3,
    autoLoop: options.autoLoop !== false,
  });
  prepareWorkItemAgentRun(target.id, job.id);
  updateWorkItem(target.id, { loopStatus: 'running' });

  logWorkItemActivity({
    workItemId: storyId ?? target.id,
    activityType: 'comment',
    summary: `Full lifecycle queued developer pipeline on ${target.key}`,
    agentType: target.assignedAgentType,
    agentId: target.assignedAgentId,
    metadata: {
      event: 'full_lifecycle_pipeline_queued',
      jobId: job.id,
      pipelineWorkItemId: target.id,
      storyId: storyId ?? target.id,
      orchestrator: options.orchestrator ?? 'manual_full_lifecycle',
    },
  });

  return {
    job,
    step: 'pipeline',
    workItemId: target.id,
    storyId,
    message: `Developer pipeline queued for ${target.key}`,
    phase: storyId ? getStoryLifecyclePhase(getWorkItem(storyId)!) : 'n/a',
  };
}

function enqueueLifecycleStep(
  story: WorkItem,
  step: 'ba' | 'pm',
  options: FullLifecycleOptions
): FullLifecycleStartResult {
  if (!story.sprintId) {
    throw new Error(`${story.key} must belong to a sprint to run BA/PM lifecycle phases`);
  }

  const role = step === 'ba' ? 'business_analyst' : 'project_manager';
  const agent = requireStaffedRole(story.sprintId, role);

  const existing = getActiveJobForWorkItem(story.id);
  if (existing) {
    return {
      job: existing,
      step,
      workItemId: story.id,
      storyId: story.id,
      alreadyQueued: true,
      message: `${story.key} already has a queued/running job`,
      phase: getStoryLifecyclePhase(story),
    };
  }

  const jobType = step === 'ba' ? 'story_ba' : 'story_pm';
  const payload = chainPayload(story.id, story.sprintId, options);
  const job = enqueueStoryLifecycleJob(story.id, jobType, payload);
  prepareWorkItemAgentRun(story.id, job.id);

  logWorkItemActivity({
    workItemId: story.id,
    activityType: 'comment',
    summary:
      step === 'ba'
        ? `Full lifecycle queued business analyst requirements pass`
        : `Full lifecycle queued project manager task decomposition`,
    agentType: agent.type,
    agentId: agent.id,
    metadata: {
      event: 'full_lifecycle_start',
      jobId: job.id,
      step,
      orchestrator: payload.orchestrator,
      sprintId: story.sprintId,
    },
  });

  return {
    job,
    step,
    workItemId: story.id,
    storyId: story.id,
    message:
      step === 'ba'
        ? `Business analyst phase queued for ${story.key}`
        : `Project manager phase queued for ${story.key}`,
    phase: getStoryLifecyclePhase(story),
  };
}

/**
 * Start BA → PM → developer pipeline from the current story phase.
 * Tasks/bugs skip straight to the developer pipeline.
 */
export function startFullLifecycle(
  workItemId: string,
  options: FullLifecycleOptions = {}
): FullLifecycleStartResult {
  const item = assertNotBusy(workItemId);

  if (item.type === 'epic') {
    throw new Error('Full lifecycle is not supported on epics — run epic orchestration instead');
  }

  if (item.type === 'task' || item.type === 'bug') {
    return enqueuePipelineForTarget(item, options);
  }

  // story
  recoverIfNeeded(item);
  const story = getWorkItem(item.id)!;
  const phase = getStoryLifecyclePhase(story);

  if (phase === 'ba_pending') {
    return enqueueLifecycleStep(story, 'ba', options);
  }
  if (phase === 'pm_pending') {
    return enqueueLifecycleStep(story, 'pm', options);
  }
  if (phase === 'complete') {
    throw new Error(`${story.key} is already done — nothing to run`);
  }

  const target = resolveFullLifecyclePipelineTarget(story);
  if (!target) {
    throw new Error(
      `${story.key} has no developer-runnable work yet (phase: ${phase}). ` +
        'Staff BA/PM and ensure lifecycle labels or open child tasks exist.'
    );
  }
  return enqueuePipelineForTarget(target, options, story.id);
}

function recoverIfNeeded(story: WorkItem): void {
  recoverStuckStory(story);
}

/**
 * After a BA/PM job finishes, enqueue the next full-lifecycle step when requested.
 * Returns the next job if one was queued.
 */
export function continueFullLifecycleChain(completedJob: LoopJob): LoopJob | null {
  const payload = completedJob.payload as Partial<FullLifecycleChainPayload>;
  if (!payload.chainFullLifecycle) return null;
  if (completedJob.jobType !== 'story_ba' && completedJob.jobType !== 'story_pm') return null;

  const storyId = payload.storyId || completedJob.workItemId;
  if (!storyId) return null;

  const story = getWorkItem(storyId);
  if (!story || story.type !== 'story') return null;

  const options: FullLifecycleOptions = {
    maxIterations: payload.maxIterations,
    autoLoop: payload.autoLoop,
    orchestrator: payload.orchestrator,
  };

  try {
    if (completedJob.jobType === 'story_ba') {
      const phase = getStoryLifecyclePhase(story);
      if (phase === 'pm_pending') {
        const next = enqueueLifecycleStep(story, 'pm', options);
        return next.alreadyQueued ? null : next.job;
      }
      // BA done and already past PM somehow — try pipeline
      const target = resolveFullLifecyclePipelineTarget(story);
      if (target) {
        const next = enqueuePipelineForTarget(target, options, story.id);
        return next.alreadyQueued ? null : next.job;
      }
      return null;
    }

    // story_pm completed
    const target = resolveFullLifecyclePipelineTarget(getWorkItem(storyId)!);
    if (!target) {
      logWorkItemActivity({
        workItemId: storyId,
        activityType: 'comment',
        summary: `Full lifecycle: PM finished but no developer-runnable item found for ${story.key}`,
        metadata: { event: 'full_lifecycle_no_pipeline_target', storyId },
      });
      return null;
    }
    const next = enqueuePipelineForTarget(target, options, storyId);
    return next.alreadyQueued ? null : next.job;
  } catch (err) {
    logWorkItemActivity({
      workItemId: storyId,
      activityType: 'agent_failed',
      summary: `Full lifecycle chain failed: ${(err as Error).message}`,
      metadata: {
        event: 'full_lifecycle_chain_failed',
        error: (err as Error).message,
        afterJobType: completedJob.jobType,
      },
    });
    return null;
  }
}

/** Run BA → PM → pipeline synchronously (tests / non-async clients). */
export async function runFullLifecycleSync(
  workItemId: string,
  options: FullLifecycleOptions = {}
): Promise<FullLifecycleSyncResult> {
  const item = assertNotBusy(workItemId);
  if (item.type === 'epic') {
    throw new Error('Full lifecycle is not supported on epics');
  }

  const skipped: FullLifecycleStep[] = [];

  if (item.type === 'task' || item.type === 'bug') {
    const pipeline = await runWorkItemPipeline(item.id, {
      maxIterations: options.maxIterations ?? 3,
      autoLoop: options.autoLoop !== false,
    });
    return {
      storyId: item.id,
      phase: 'n/a',
      pipeline,
      pipelineWorkItemId: item.id,
      skippedSteps: ['ba', 'pm'],
      message: `Developer pipeline completed for ${item.key} (BA/PM skipped for ${item.type})`,
    };
  }

  recoverIfNeeded(item);
  let story = getWorkItem(item.id)!;
  const sprintId = story.sprintId;
  if (!sprintId) {
    throw new Error(`${story.key} must belong to a sprint to run BA/PM lifecycle phases`);
  }

  let ba: FullLifecycleSyncResult['ba'];
  let pm: FullLifecycleSyncResult['pm'];

  let phase = getStoryLifecyclePhase(story);
  if (phase === 'ba_pending') {
    requireStaffedRole(sprintId, 'business_analyst');
    ba = await runStoryBaPhase(story.id, sprintId);
    story = ba.item;
    phase = getStoryLifecyclePhase(story);
  } else {
    skipped.push('ba');
  }

  if (phase === 'pm_pending') {
    requireStaffedRole(sprintId, 'project_manager');
    pm = await runStoryPmPhase(story.id, sprintId);
    story = pm.item;
    phase = getStoryLifecyclePhase(story);
  } else if (!ba) {
    skipped.push('pm');
  }

  const target = resolveFullLifecyclePipelineTarget(story);
  if (!target) {
    return {
      storyId: story.id,
      phase,
      ba,
      pm,
      skippedSteps: [...skipped, 'pipeline'],
      message: `${story.key} lifecycle phases finished but no developer pipeline target was found`,
    };
  }

  const pipeline = await runWorkItemPipeline(target.id, {
    maxIterations: options.maxIterations ?? 3,
    autoLoop: options.autoLoop !== false,
  });

  return {
    storyId: story.id,
    phase: getStoryLifecyclePhase(getWorkItem(story.id)!),
    ba,
    pm,
    pipeline,
    pipelineWorkItemId: target.id,
    skippedSteps: skipped,
    message: `Full lifecycle completed through developer pipeline on ${target.key}`,
  };
}
