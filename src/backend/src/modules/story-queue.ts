import type { WorkItem, WorkItemStatus, WorkItemType } from '../types';
import { broadcast } from '../websocket';
import { generateId, now } from '../utils/helpers';
import { getWorkItem, listWorkItems, updateWorkItem } from './work-items';
import { assertWorkItemRunnable, isWorkItemBusy, WorkItemBusyError } from './work-item-guard';
import { getActiveJobForWorkItem } from './job-queue';
import { logWorkItemActivity } from './work-item-activity';
import {
  ensureGrokCopilotWorkflow,
  runWorkItemPipeline,
  type PipelineOptions,
  type PipelineResult,
} from './work-item-pipeline';
import { resolveWorkItemOutputDir } from './work-item-context';

const RUNNABLE_TYPES = new Set<WorkItemType>(['story', 'task', 'bug']);

export interface StoryQueueOptions extends PipelineOptions {
  demo?: boolean;
  skipDone?: boolean;
  stopOnFailure?: boolean;
  /** Continue to next story when one escalates (default true). */
  continueOnEscalated?: boolean;
}

export interface StoryQueueItemResult {
  item: WorkItem;
  workDir?: string;
  pipeline?: PipelineResult;
  skipped?: boolean;
  skipReason?: string;
  error?: string;
  durationMs?: number;
}

export interface StoryQueueResult {
  queueId: string;
  workItemIds: string[];
  status: 'running' | 'completed' | 'failed';
  results: StoryQueueItemResult[];
  totals: {
    total: number;
    completed: number;
    approved: number;
    escalated: number;
    failed: number;
    skipped: number;
  };
  durationMs: number;
  startedAt: string;
  completedAt?: string;
}

export interface ResolveStoryQueueInput {
  sprintId?: string;
  epicId?: string;
  workItemIds?: string[];
  statuses?: WorkItemStatus[];
}

const queueStore = new Map<string, StoryQueueResult>();

export function getStoryQueueRun(queueId: string): StoryQueueResult | null {
  return queueStore.get(queueId) ?? null;
}

/** Resolve ordered runnable stories/tasks for a sprint, epic, or explicit ID list. */
export function resolveStoryQueueItems(input: ResolveStoryQueueInput): WorkItem[] {
  const statuses = input.statuses ?? ['todo', 'in_progress', 'in_review', 'backlog'];

  if (input.workItemIds?.length) {
    return input.workItemIds
      .map((id) => getWorkItem(id))
      .filter((item): item is WorkItem => Boolean(item))
      .filter((item) => RUNNABLE_TYPES.has(item.type))
      .filter((item) => statuses.includes(item.status));
  }

  if (input.epicId) {
    return listWorkItems({ parentId: input.epicId })
      .filter((item) => RUNNABLE_TYPES.has(item.type))
      .filter((item) => statuses.includes(item.status))
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  if (input.sprintId) {
    return listWorkItems({ sprintId: input.sprintId })
      .filter((item) => RUNNABLE_TYPES.has(item.type))
      .filter((item) => statuses.includes(item.status))
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  throw new Error('Provide workItemIds, epicId, or sprintId');
}

function emitQueueEvent(queueId: string, payload: Record<string, unknown>): void {
  broadcast({
    type: 'story_queue:progress',
    payload: { queueId, ...payload },
    timestamp: now(),
  });
}

function summarizeResults(results: StoryQueueItemResult[]): StoryQueueResult['totals'] {
  return {
    total: results.length,
    completed: results.filter((r) => r.pipeline || r.error).length,
    approved: results.filter((r) => r.pipeline?.loopStatus === 'approved').length,
    escalated: results.filter((r) => r.pipeline?.loopStatus === 'escalated').length,
    failed: results.filter((r) => r.error || r.pipeline?.loopStatus === 'failed').length,
    skipped: results.filter((r) => r.skipped).length,
  };
}

/**
 * Run stories/tasks one at a time: each pipeline must finish before the next starts.
 * This is the recommended automation model (serial throughput, reliable isolation).
 */
export async function runStoryQueue(
  items: WorkItem[],
  options: StoryQueueOptions = {},
  queueId = generateId()
): Promise<StoryQueueResult> {
  const startedAt = now();
  const startMs = Date.now();
  ensureGrokCopilotWorkflow();

  const result: StoryQueueResult = {
    queueId,
    workItemIds: items.map((i) => i.id),
    status: 'running',
    results: [],
    totals: { total: items.length, completed: 0, approved: 0, escalated: 0, failed: 0, skipped: 0 },
    durationMs: 0,
    startedAt,
  };

  queueStore.set(queueId, result);
  emitQueueEvent(queueId, { status: 'started', total: items.length, keys: items.map((i) => i.key) });

  for (let index = 0; index < items.length; index++) {
    const child = getWorkItem(items[index].id) ?? items[index];

    if (options.skipDone !== false && child.status === 'done') {
      const skipped: StoryQueueItemResult = {
        item: child,
        skipped: true,
        skipReason: 'already done',
      };
      result.results.push(skipped);
      emitQueueEvent(queueId, {
        status: 'item_skipped',
        index,
        key: child.key,
        reason: 'already done',
      });
      continue;
    }

    const workDir = resolveWorkItemOutputDir(child);
    const activeJob = getActiveJobForWorkItem(child.id);
    if (isWorkItemBusy(child, Boolean(activeJob))) {
      const skipped: StoryQueueItemResult = {
        item: child,
        skipped: true,
        skipReason: activeJob ? 'background job in progress' : 'pipeline already running',
      };
      result.results.push(skipped);
      emitQueueEvent(queueId, {
        status: 'item_skipped',
        index,
        key: child.key,
        reason: skipped.skipReason,
      });
      continue;
    }

    try {
      assertWorkItemRunnable(child.id);
    } catch (err) {
      if (err instanceof WorkItemBusyError) {
        const skipped: StoryQueueItemResult = {
          item: child,
          skipped: true,
          skipReason: err.reason,
        };
        result.results.push(skipped);
        emitQueueEvent(queueId, {
          status: 'item_skipped',
          index,
          key: child.key,
          reason: err.reason,
        });
        continue;
      }
      throw err;
    }

    const terminalLoop = new Set(['approved', 'failed', 'cancelled', 'escalated']);
    const resetLoop = terminalLoop.has(child.loopStatus);
    updateWorkItem(child.id, {
      status: 'in_progress',
      ...(resetLoop ? { loopStatus: 'idle' as const } : {}),
    });

    emitQueueEvent(queueId, {
      status: 'item_started',
      index,
      total: items.length,
      key: child.key,
      workItemId: child.id,
    });

    logWorkItemActivity({
      workItemId: child.id,
      activityType: 'comment',
      summary: `Story queue ${index + 1}/${items.length} started for ${child.key}`,
      metadata: { event: 'story_queue_item_started', queueId, index },
    });

    const itemStart = Date.now();

    try {
      const pipeline = await runWorkItemPipeline(child.id, {
        maxIterations: options.maxIterations ?? 2,
        autoLoop: options.autoLoop !== false,
        workDir,
        demo: options.demo,
      });

      const itemResult: StoryQueueItemResult = {
        item: pipeline.item,
        workDir,
        pipeline,
        durationMs: Date.now() - itemStart,
      };
      result.results.push(itemResult);

      emitQueueEvent(queueId, {
        status: 'item_completed',
        index,
        key: child.key,
        workItemId: child.id,
        loopStatus: pipeline.loopStatus,
        itemStatus: pipeline.item.status,
        durationMs: itemResult.durationMs,
      });

      if (options.stopOnFailure && pipeline.loopStatus !== 'approved') break;
    } catch (err) {
      const message = (err as Error).message;
      result.results.push({
        item: getWorkItem(child.id)!,
        workDir,
        error: message,
        durationMs: Date.now() - itemStart,
      });

      emitQueueEvent(queueId, {
        status: 'item_failed',
        index,
        key: child.key,
        workItemId: child.id,
        error: message,
      });

      if (options.stopOnFailure) break;
    }

    result.totals = summarizeResults(result.results);
    queueStore.set(queueId, { ...result });
  }

  result.totals = summarizeResults(result.results);
  result.durationMs = Date.now() - startMs;
  result.completedAt = now();
  result.status = result.results.some((r) => r.error) ? 'failed' : 'completed';
  queueStore.set(queueId, result);

  emitQueueEvent(queueId, {
    status: 'completed',
    totals: result.totals,
    durationMs: result.durationMs,
  });

  return result;
}

/** Start queue in background; returns immediately with queueId for polling. */
export function startStoryQueueAsync(
  items: WorkItem[],
  options: StoryQueueOptions = {}
): StoryQueueResult {
  const queueId = generateId();
  const pending: StoryQueueResult = {
    queueId,
    workItemIds: items.map((i) => i.id),
    status: 'running',
    results: [],
    totals: {
      total: items.length,
      completed: 0,
      approved: 0,
      escalated: 0,
      failed: 0,
      skipped: 0,
    },
    durationMs: 0,
    startedAt: now(),
  };
  queueStore.set(queueId, pending);

  runStoryQueue(items, options, queueId).catch((err) => {
    const failed = queueStore.get(queueId);
    if (failed) {
      failed.status = 'failed';
      failed.completedAt = now();
      queueStore.set(queueId, failed);
    }
    emitQueueEvent(queueId, { status: 'failed', error: (err as Error).message });
  });

  return pending;
}