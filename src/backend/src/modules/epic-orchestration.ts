import fs from 'fs';
import path from 'path';
import type { Sprint, WorkItem, WorkItemStatus, WorkItemType } from '../types';
import {
  createSprint,
  createWorkItem,
  getSprint,
  getWorkItem,
  listWorkItems,
  updateWorkItem,
  resolveWorkDir,
} from './work-items';
import { ensureGrokCopilotWorkflow, type PipelineOptions, type PipelineResult } from './work-item-pipeline';
import { resolveStoryQueueItems, runStoryQueue } from './story-queue';
import { listWorkspaces } from './workspace';
import { logWorkItemActivity } from './work-item-activity';
import { now } from '../utils/helpers';

export const IMPROVEMENT_EPIC_TITLE = 'Automate AgentHub project improvements';

export interface ImprovementEpicChildSpec {
  type: WorkItemType;
  title: string;
  description: string;
  storyPoints?: number;
  acceptanceCriteria: string[];
  outputFile: string;
}

export const IMPROVEMENT_EPIC_CHILDREN: ImprovementEpicChildSpec[] = [
  {
    type: 'story',
    title: 'Document prioritized improvements in improvements.md',
    description:
      'Review the linked AgentHub workspace and write prioritized, actionable recommendations to improvements.md.',
    storyPoints: 5,
    outputFile: 'improvements.md',
    acceptanceCriteria: [
      'improvements.md created in work directory',
      'At least 3 actionable recommendations',
      'Copilot review completes after Grok',
    ],
  },
  {
    type: 'task',
    title: 'Publish automation readiness checklist',
    description: 'Create automation-checklist.md summarizing what is wired for scrum + workflow automation.',
    storyPoints: 3,
    outputFile: 'automation-checklist.md',
    acceptanceCriteria: [
      'automation-checklist.md created in work directory',
      'Grok→Copilot pipeline configured',
      'Copilot review completes after Grok',
    ],
  },
  {
    type: 'task',
    title: 'Verify pipeline activity reflects implement and review steps',
    description: 'Produce pipeline-verification.md confirming loop history and board activity are populated.',
    storyPoints: 2,
    outputFile: 'pipeline-verification.md',
    acceptanceCriteria: [
      'pipeline-verification.md created in work directory',
      'Implement and review steps completed',
      'Copilot review completes after Grok',
    ],
  },
];

export interface CreateImprovementEpicOptions {
  workspaceId?: string;
  sprintId?: string;
  sprintName?: string;
}

export interface ImprovementEpicBundle {
  sprint: Sprint;
  epic: WorkItem;
  children: WorkItem[];
  workflowId: string;
}

export interface EpicSummary {
  epic: WorkItem;
  children: WorkItem[];
  totals: {
    children: number;
    done: number;
    inReview: number;
    inProgress: number;
    todo: number;
    backlog: number;
    storyPoints: number;
    completedPoints: number;
  };
}

export interface EpicChildRunResult {
  item: WorkItem;
  workDir: string;
  pipeline?: PipelineResult;
  skipped?: boolean;
  skipReason?: string;
  error?: string;
}

export interface EpicOrchestrationResult {
  epic: WorkItem;
  summary: EpicSummary;
  childResults: EpicChildRunResult[];
}

const RUNNABLE_TYPES = new Set<WorkItemType>(['story', 'task', 'bug']);

function resolveImprovementWorkspaceId(explicit?: string): string | undefined {
  if (explicit) return explicit;
  const workspaces = listWorkspaces();
  const preferred = workspaces.find((w) => /improvement|agenthub/i.test(w.name));
  return preferred?.id ?? workspaces[0]?.id;
}

/** Per-child scratch directory under AGENTHUB_WORK_DIR so outputs do not overwrite each other. */
export function resolveEpicChildWorkDir(epic: WorkItem, child: WorkItem): string {
  const base = resolveWorkDir();
  const dir = path.join(base, epic.key, child.key);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Create the standard improvement automation epic with child stories/tasks. */
export function createImprovementEpic(options: CreateImprovementEpicOptions = {}): ImprovementEpicBundle {
  const workspaceId = resolveImprovementWorkspaceId(options.workspaceId);
  let sprint: Sprint;

  if (options.sprintId) {
    const existing = getSprint(options.sprintId);
    if (!existing) throw new Error('Sprint not found');
    sprint = existing;
  } else {
    sprint = createSprint(options.sprintName || 'Improvement Automation Sprint', {
      goal: 'Prove epic → story → Grok→Copilot pipeline automation end-to-end',
      workspaceId,
      status: 'active',
      startDate: now().slice(0, 10),
    });
  }

  const workflowId = ensureGrokCopilotWorkflow();

  const epic = createWorkItem({
    type: 'epic',
    title: IMPROVEMENT_EPIC_TITLE,
    description:
      'Orchestrates automated AgentHub improvement work: child stories run the Grok implement → Copilot review loop ' +
      'with evals, activity logging, and epic status rollup.',
    sprintId: sprint.id,
    workspaceId,
    storyPoints: IMPROVEMENT_EPIC_CHILDREN.reduce((sum, c) => sum + (c.storyPoints ?? 0), 0),
    priority: 'high',
    status: 'in_progress',
    labels: ['automation', 'improvement', 'epic-demo'],
    acceptanceCriteria: [
      'All child stories complete pipeline or escalate with visible activity',
      'Epic status rolls up from child outcomes',
      'Outputs land in per-story work directories',
    ],
  });

  const children = IMPROVEMENT_EPIC_CHILDREN.map((spec) =>
    createWorkItem({
      type: spec.type,
      title: spec.title,
      description: spec.description,
      parentId: epic.id,
      sprintId: sprint.id,
      workspaceId,
      storyPoints: spec.storyPoints,
      assignedAgentType: 'grok',
      status: 'todo',
      workflowId,
      labels: ['automation', spec.outputFile.replace('.md', '')],
      acceptanceCriteria: spec.acceptanceCriteria,
    })
  );

  logWorkItemActivity({
    workItemId: epic.id,
    activityType: 'comment',
    summary: `Improvement epic created with ${children.length} child items`,
    metadata: { childIds: children.map((c) => c.id), childKeys: children.map((c) => c.key) },
  });

  return { sprint, epic, children, workflowId };
}

export function getEpicChildren(epicId: string): WorkItem[] {
  const epic = getWorkItem(epicId);
  if (!epic || epic.type !== 'epic') throw new Error('Epic not found');
  return listWorkItems({ parentId: epicId });
}

export function summarizeEpic(epicId: string): EpicSummary {
  const epic = getWorkItem(epicId);
  if (!epic || epic.type !== 'epic') throw new Error('Epic not found');

  const children = getEpicChildren(epicId);
  const totals = {
    children: children.length,
    done: children.filter((c) => c.status === 'done').length,
    inReview: children.filter((c) => c.status === 'in_review').length,
    inProgress: children.filter((c) => c.status === 'in_progress').length,
    todo: children.filter((c) => c.status === 'todo').length,
    backlog: children.filter((c) => c.status === 'backlog').length,
    storyPoints: children.reduce((sum, c) => sum + (c.storyPoints ?? 0), 0),
    completedPoints: children
      .filter((c) => c.status === 'done')
      .reduce((sum, c) => sum + (c.storyPoints ?? 0), 0),
  };

  return { epic, children, totals };
}

/** Roll up epic status from child work items. */
export function rollupEpicStatus(epicId: string): WorkItem {
  const { epic, children } = summarizeEpic(epicId);
  if (children.length === 0) return epic;

  const statuses = children.map((c) => c.status);
  let status: WorkItemStatus = epic.status;

  if (statuses.every((s) => s === 'done')) {
    status = 'done';
  } else if (statuses.some((s) => s === 'in_progress' || s === 'in_review')) {
    status = 'in_progress';
  } else if (statuses.some((s) => s === 'done')) {
    status = 'in_progress';
  } else if (statuses.every((s) => s === 'backlog' || s === 'todo')) {
    status = 'todo';
  }

  const updated = updateWorkItem(epicId, { status });
  if (!updated) throw new Error('Epic not found');

  logWorkItemActivity({
    workItemId: epicId,
    activityType: 'status_change',
    summary: `Epic rolled up to ${status} (${children.filter((c) => c.status === 'done').length}/${children.length} children done)`,
    metadata: { rollup: true, childStatuses: children.map((c) => ({ key: c.key, status: c.status })) },
  });

  return updated;
}

export interface RunEpicOptions extends PipelineOptions {
  stopOnFailure?: boolean;
  skipDone?: boolean;
  /** Use mock implement/review agents for fast, deterministic demos. */
  demo?: boolean;
}

/** Run Grok→Copilot pipeline on each runnable child, then roll up epic status. */
export async function runEpicOrchestration(
  epicId: string,
  options: RunEpicOptions = {}
): Promise<EpicOrchestrationResult> {
  const epic = getWorkItem(epicId);
  if (!epic || epic.type !== 'epic') throw new Error('Epic not found');

  ensureGrokCopilotWorkflow();
  updateWorkItem(epicId, { status: 'in_progress', loopStatus: 'running' });

  logWorkItemActivity({
    workItemId: epicId,
    activityType: 'comment',
    summary: 'Epic orchestration started',
    metadata: { event: 'epic_orchestration_started' },
  });

  const children = resolveStoryQueueItems({ epicId });
  const queueResult = await runStoryQueue(children, {
    ...options,
    workDir: undefined,
  });

  const childResults: EpicChildRunResult[] = queueResult.results.map((r) => ({
    item: r.item,
    workDir: r.workDir ?? resolveEpicChildWorkDir(epic, r.item),
    pipeline: r.pipeline,
    skipped: r.skipped,
    skipReason: r.skipReason,
    error: r.error,
  }));

  const rolledUp = rollupEpicStatus(epicId);
  updateWorkItem(epicId, {
    loopStatus: rolledUp.status === 'done' ? 'approved' : childResults.some((r) => r.error) ? 'failed' : 'idle',
  });

  logWorkItemActivity({
    workItemId: epicId,
    activityType: 'comment',
    summary: `Epic orchestration finished — ${childResults.filter((r) => r.pipeline?.loopStatus === 'approved').length}/${children.length} approved`,
    metadata: {
      event: 'epic_orchestration_completed',
      childResults: childResults.map((r) => ({
        key: r.item.key,
        status: r.item.status,
        loopStatus: r.pipeline?.loopStatus,
        error: r.error,
        skipped: r.skipped,
        workDir: r.workDir,
      })),
    },
  });

  return {
    epic: getWorkItem(epicId)!,
    summary: summarizeEpic(epicId),
    childResults,
  };
}