import { broadcast } from '../websocket';
import { now } from '../utils/helpers';
import { getDatabase } from '../database';
import { isOnShift } from './shift-utils';
import { getEmployment } from './agent-employment';
import { updateAgentStatus } from './agent-registry';
import { hasActiveLoopJobForWorkItem } from './job-queue';
import { buildContextScope } from './context-scope';
import { executeOutboundPipeline } from './outbound-pipeline';
import {
  getSprintAutomation,
  getSprintAutomationStatus,
  isSprintRoleOnShift,
  resolveSprintAgent,
  sprintHasActiveWork,
  updateSprintAutomationState,
} from './sprint-team';
import { getSprint, listWorkItems, updateWorkItem } from './work-items';
import { logWorkItemActivity } from './work-item-activity';
import { resolveStoryQueueItems } from './story-queue';
import {
  enqueueStoryLifecycleJob,
  enqueueWorkItemPipeline,
  getActiveJobForWorkItem,
} from './job-queue';
import { ensureGrokCopilotWorkflow } from './work-item-pipeline';
import { enqueueLoopRetry } from './loop-retry';
import { isAgentTypeOverBudget } from './agent-credits';
import {
  checkParentStoryRollup,
  nextRunnableDevItem,
  nextStoryNeedingBa,
  nextStoryNeedingPm,
  recoverStuckStoriesInSprint,
  sprintLifecyclePauseReason,
} from './story-lifecycle';

const TICK_MS = Number(process.env.AGENTHUB_SHIFT_TICK_MS) || 60_000;
const STANDUP_INTERVAL_MS = Number(process.env.AGENTHUB_STANDUP_INTERVAL_MS) || 60 * 60 * 1000;
let tickTimer: ReturnType<typeof setInterval> | null = null;

const activeSprintQueues = new Set<string>();
const lastStandupAt = new Map<string, number>();

function listAutonomousSprints(): string[] {
  const rows = getDatabase()
    .prepare(
      `SELECT sa.sprint_id FROM sprint_automation sa
       JOIN sprint s ON s.id = sa.sprint_id
       WHERE sa.mode = 'autonomous' AND s.status = 'active'`
    )
    .all() as Array<{ sprint_id: string }>;
  return rows.map((r) => r.sprint_id);
}

function countUnresolvedBlockedItems(sprintId: string, at: Date): number {
  const items = listWorkItems({ sprintId });
  return items.filter((item) => {
    if (item.loopStatus === 'escalated') {
      return !isSprintRoleOnShift(sprintId, 'reviewer', at);
    }
    if (item.loopStatus === 'failed') {
      return !isSprintRoleOnShift(sprintId, 'developer', at);
    }
    return false;
  }).length;
}

function startLifecycleJob(
  sprintId: string,
  storyId: string,
  jobType: 'story_ba' | 'story_pm',
  role: 'business_analyst' | 'project_manager',
  orchestrator: 'business_analyst' | 'project_manager'
): boolean {
  const existingJob = getActiveJobForWorkItem(storyId);
  if (existingJob) return false;

  const agent = resolveSprintAgent(sprintId, role);
  if (agent && isAgentTypeOverBudget(agent.type)) {
    updateSprintAutomationState(sprintId, { pausedReason: 'budget_exceeded' });
    return false;
  }

  if (agent) {
    updateWorkItem(storyId, {
      status: 'in_progress',
      assignedAgentId: agent.id,
      assignedAgentType: agent.type,
    });
  }

  const job = enqueueStoryLifecycleJob(storyId, jobType, { sprintId });

  logWorkItemActivity({
    workItemId: storyId,
    activityType: 'comment',
    summary:
      jobType === 'story_ba'
        ? `Shift scheduler queued story for business analyst requirements pass`
        : `Shift scheduler queued story for project manager task decomposition`,
    agentType: agent?.type,
    agentId: agent?.id,
    metadata: { event: 'shift_lifecycle_start', sprintId, jobId: job.id, orchestrator },
  });

  updateSprintAutomationState(sprintId, { pausedReason: null, activeQueueId: job.id });

  broadcast({
    type: 'shift:update',
    payload: { sprintId, action: 'lifecycle_start', workItemId: storyId, jobId: job.id, phase: jobType },
    timestamp: now(),
  });

  return true;
}

/** BA → PM lifecycle phases before developer pipeline. */
function runLifecycleTick(sprintId: string, at: Date): boolean {
  recoverStuckStoriesInSprint(sprintId);

  const baOn = isSprintRoleOnShift(sprintId, 'business_analyst', at);
  const pmOn = isSprintRoleOnShift(sprintId, 'project_manager', at);

  const baStory = nextStoryNeedingBa(sprintId);
  if (baStory && baOn) {
    return startLifecycleJob(sprintId, baStory.id, 'story_ba', 'business_analyst', 'business_analyst');
  }

  const pmStory = nextStoryNeedingPm(sprintId);
  if (pmStory && pmOn) {
    return startLifecycleJob(sprintId, pmStory.id, 'story_pm', 'project_manager', 'project_manager');
  }

  return false;
}

async function runScrumMasterTick(sprintId: string, at: Date): Promise<void> {
  const scrumOn = isSprintRoleOnShift(sprintId, 'scrum_master', at);
  const devOn = isSprintRoleOnShift(sprintId, 'developer', at);
  const baOn = isSprintRoleOnShift(sprintId, 'business_analyst', at);
  const pmOn = isSprintRoleOnShift(sprintId, 'project_manager', at);

  if (!scrumOn && !devOn && !baOn && !pmOn) {
    updateSprintAutomationState(sprintId, { pausedReason: 'outside_hours' });
    return;
  }

  if (sprintHasActiveWork(sprintId) || activeSprintQueues.has(sprintId)) {
    return;
  }

  if (runLifecycleTick(sprintId, at)) {
    return;
  }

  const lifecyclePause = sprintLifecyclePauseReason(sprintId, at);
  if (lifecyclePause) {
    const blocked = countUnresolvedBlockedItems(sprintId, at) > 0;
    updateSprintAutomationState(sprintId, {
      pausedReason: blocked ? 'blocked_failures' : lifecyclePause,
    });
    return;
  }

  if (!devOn) {
    updateSprintAutomationState(sprintId, { pausedReason: 'awaiting_shift' });
    return;
  }

  const next = nextRunnableDevItem(sprintId);
  if (!next) {
    const blocked = countUnresolvedBlockedItems(sprintId, at) > 0;
    updateSprintAutomationState(sprintId, {
      pausedReason: blocked ? 'blocked_failures' : null,
    });
    return;
  }

  const existingJob = getActiveJobForWorkItem(next.id);
  if (existingJob) return;

  const developer = resolveSprintAgent(sprintId, 'developer');
  const scrumMaster = resolveSprintAgent(sprintId, 'scrum_master');

  if (developer && isAgentTypeOverBudget(developer.type)) {
    updateSprintAutomationState(sprintId, { pausedReason: 'budget_exceeded' });
    return;
  }

  if (scrumMaster) updateAgentStatus(scrumMaster.id, 'running');

  if (developer) {
    updateWorkItem(next.id, {
      status: 'in_progress',
      assignedAgentId: developer.id,
      assignedAgentType: developer.type,
    });
    if (next.parentId) checkParentStoryRollup(next.parentId);
  }

  const workflowId = ensureGrokCopilotWorkflow();
  const job = enqueueWorkItemPipeline(next.id, workflowId, { maxIterations: 3, autoLoop: true });

  logWorkItemActivity({
    workItemId: next.id,
    activityType: 'comment',
    summary: scrumMaster
      ? `Scrum master queued ${next.key} for the developer pipeline`
      : `Shift scheduler auto-started pipeline for ${next.key}`,
    agentType: scrumMaster?.type ?? developer?.type,
    agentId: scrumMaster?.id ?? developer?.id,
    metadata: { event: 'shift_auto_start', sprintId, jobId: job.id, orchestrator: 'scrum_master' },
  });

  if (scrumMaster) updateAgentStatus(scrumMaster.id, 'idle');

  updateSprintAutomationState(sprintId, { pausedReason: null, activeQueueId: job.id });

  broadcast({
    type: 'shift:update',
    payload: { sprintId, action: 'auto_start', workItemId: next.id, jobId: job.id },
    timestamp: now(),
  });
}

async function runScrumMasterStandup(sprintId: string, at: Date): Promise<void> {
  const sprint = getSprint(sprintId);
  if (!sprint) return;

  const last = lastStandupAt.get(sprintId) ?? 0;
  if (at.getTime() - last < STANDUP_INTERVAL_MS) return;

  const items = listWorkItems({ sprintId });
  if (items.length === 0) return;

  const done = items.filter((i) => i.status === 'done').length;
  const inProgress = items.filter((i) => i.status === 'in_progress').length;
  const todo = items.filter((i) => i.status === 'todo' || i.status === 'backlog').length;
  const blocked = items.filter((i) => i.loopStatus === 'failed' || i.loopStatus === 'escalated').length;

  lastStandupAt.set(sprintId, at.getTime());

  const scrumMaster = resolveSprintAgent(sprintId, 'scrum_master');
  let agentSummary: string | undefined;

  if (scrumMaster) {
    updateAgentStatus(scrumMaster.id, 'running');
    try {
      const scope = buildContextScope({
        filePaths: [],
        basePath: process.cwd(),
        includeDiffs: false,
        sensitivityLevel: 0,
      });
      const inProgressKeys = items
        .filter((i) => i.status === 'in_progress')
        .map((i) => i.key)
        .join(', ');
      const result = await executeOutboundPipeline({
        agentType: scrumMaster.type,
        agentId: scrumMaster.id,
        capability: 'planning',
        pipelinePhase: 'planning',
        prompt:
          `Sprint standup for "${sprint.name}".\n` +
          `Board: ${done} done, ${inProgress} in progress, ${todo} todo/backlog` +
          (blocked > 0 ? `, ${blocked} blocked/failed` : '') +
          '.\n' +
          (inProgressKeys ? `In progress: ${inProgressKeys}.\n` : '') +
          'Summarize sprint health, call out blockers, and recommend the next story to pull. Keep it under 200 words.',
        contextScope: scope,
        task: `standup/${sprintId}`,
      });
      agentSummary = result.content.trim();
    } catch (err) {
      console.error('[ShiftScheduler] scrum master standup failed:', (err as Error).message);
    } finally {
      updateAgentStatus(scrumMaster.id, 'idle');
    }
  }

  broadcast({
    type: 'sprint_automation:status',
    payload: {
      sprintId,
      standup: {
        sprintName: sprint.name,
        done,
        inProgress,
        todo,
        summary: agentSummary,
        scrumMasterId: scrumMaster?.id,
      },
    },
    timestamp: now(),
  });
}

async function resumeAwaitingShiftItems(at: Date): Promise<void> {
  const items = getDatabase()
    .prepare(`SELECT id, sprint_id FROM work_item WHERE loop_status = 'awaiting_shift'`)
    .all() as Array<{ id: string; sprint_id: string | null }>;

  for (const row of items) {
    if (!row.sprint_id) continue;
    const reviewerOn = isSprintRoleOnShift(row.sprint_id, 'reviewer', at);
    const testerOn = isSprintRoleOnShift(row.sprint_id, 'tester', at);
    if (!reviewerOn && !testerOn) continue;
    if (getActiveJobForWorkItem(row.id)) continue;

    const workflowId = ensureGrokCopilotWorkflow();
    enqueueLoopRetry(row.id, workflowId, {
      retryMode: 'full',
      orchestrator: 'shift_awaiting_resume',
      summary: 'Shift resumed — pipeline auto-queued after awaiting_shift',
    });
  }
}

async function resumeEscalatedLoopItems(at: Date): Promise<void> {
  const rows = getDatabase()
    .prepare(
      `SELECT id, sprint_id FROM work_item
       WHERE loop_status = 'escalated' AND status = 'in_review'`
    )
    .all() as Array<{ id: string; sprint_id: string | null }>;

  for (const row of rows) {
    if (!row.sprint_id) continue;

    const automation = getSprintAutomation(row.sprint_id);
    if (!automation || automation.mode !== 'autonomous') continue;
    if (!isSprintRoleOnShift(row.sprint_id, 'reviewer', at)) continue;
    if (getActiveJobForWorkItem(row.id) || hasActiveLoopJobForWorkItem(row.id)) continue;

    const reviewer = resolveSprintAgent(row.sprint_id, 'reviewer');
    if (reviewer && isAgentTypeOverBudget(reviewer.type)) {
      updateSprintAutomationState(row.sprint_id, { pausedReason: 'budget_exceeded' });
      continue;
    }

    const workflowId = ensureGrokCopilotWorkflow();
    const { job } = enqueueLoopRetry(row.id, workflowId, {
      retryMode: 'review_only',
      orchestrator: 'shift_auto_review',
      summary: 'Reviewer on shift — harness re-review auto-queued',
    });

    updateSprintAutomationState(row.sprint_id, { pausedReason: null, activeQueueId: job.id });

    broadcast({
      type: 'shift:update',
      payload: { sprintId: row.sprint_id, action: 'auto_review_retry', workItemId: row.id, jobId: job.id },
      timestamp: now(),
    });
  }
}

async function resumeFailedLoopItems(at: Date): Promise<void> {
  const rows = getDatabase()
    .prepare(`SELECT id, sprint_id FROM work_item WHERE loop_status = 'failed'`)
    .all() as Array<{ id: string; sprint_id: string | null }>;

  for (const row of rows) {
    if (!row.sprint_id) continue;

    const automation = getSprintAutomation(row.sprint_id);
    if (!automation || automation.mode !== 'autonomous') continue;
    if (!isSprintRoleOnShift(row.sprint_id, 'developer', at)) continue;
    if (getActiveJobForWorkItem(row.id) || hasActiveLoopJobForWorkItem(row.id)) continue;

    const developer = resolveSprintAgent(row.sprint_id, 'developer');
    if (developer && isAgentTypeOverBudget(developer.type)) {
      updateSprintAutomationState(row.sprint_id, { pausedReason: 'budget_exceeded' });
      continue;
    }

    const workflowId = ensureGrokCopilotWorkflow();
    const { job } = enqueueLoopRetry(row.id, workflowId, {
      retryMode: 'full',
      orchestrator: 'shift_auto_retry',
      summary: 'Developer on shift — failed loop auto-retry queued',
    });

    updateSprintAutomationState(row.sprint_id, { pausedReason: null, activeQueueId: job.id });

    broadcast({
      type: 'shift:update',
      payload: { sprintId: row.sprint_id, action: 'auto_failed_retry', workItemId: row.id, jobId: job.id },
      timestamp: now(),
    });
  }
}

export async function runShiftTick(at: Date = new Date()): Promise<void> {
  const sprintIds = listAutonomousSprints();

  for (const sprintId of sprintIds) {
    const status = getSprintAutomationStatus(sprintId, at);
    updateSprintAutomationState(sprintId, { lastTickAt: at.toISOString() });

    broadcast({
      type: 'sprint_automation:status',
      payload: {
        sprintId,
        mode: status.automation.mode,
        onShiftRoles: status.onShiftRoles,
        pausedReason: status.automation.pausedReason,
      },
      timestamp: now(),
    });

    if (isSprintRoleOnShift(sprintId, 'scrum_master', at)) {
      await runScrumMasterStandup(sprintId, at);
    }

    await runScrumMasterTick(sprintId, at);
  }

  await resumeEscalatedLoopItems(at);
  await resumeFailedLoopItems(at);
  await resumeAwaitingShiftItems(at);
}

export function startShiftScheduler(): void {
  if (tickTimer) return;
  tickTimer = setInterval(() => {
    runShiftTick().catch((err) => console.error('[ShiftScheduler]', err.message));
  }, TICK_MS);
  runShiftTick().catch((err) => console.error('[ShiftScheduler]', err.message));
}

export function stopShiftScheduler(): void {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

/** Track in-flight sprint queue runs started by shift scheduler. */
export function markSprintQueueActive(sprintId: string, active: boolean): void {
  if (active) activeSprintQueues.add(sprintId);
  else activeSprintQueues.delete(sprintId);
}

export function isRoleOnShiftForAgent(agentId: string, at: Date = new Date()): boolean {
  const employment = getEmployment(agentId);
  if (!employment) return true;
  return isOnShift(employment, at);
}