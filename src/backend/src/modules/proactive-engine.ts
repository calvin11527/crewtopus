import chokidar, { FSWatcher } from 'chokidar';
import path from 'path';
import cron, { ScheduledTask } from 'node-cron';
import { getDatabase } from '../database';
import type { Event, ProactiveAction, ProactiveTrigger, ProactiveTriggerConfig, TriggerType } from '../types';
import { generateId, now, parseJson } from '../utils/helpers';
import { broadcast } from '../websocket';
import { executeWorkflow } from './workflow-engine';
import { incrementCounter } from '../metrics';
import { enqueueWorkItemPipeline, hasActiveLoopJobForWorkItem } from './job-queue';
import { getWorkItem } from './work-items';
import { resolveWorkItemOutputDir } from './work-item-context';
import { ensureGrokCopilotWorkflow } from './work-item-pipeline';
import { logWorkItemActivity } from './work-item-activity';

const DEFAULT_DEBOUNCE_MS = 2000;
const IGNORED_FILE_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

interface TriggerRow {
  id: string;
  workspace_id: string | null;
  trigger_type: string;
  workflow_id: string | null;
  config: string;
  enabled: number;
  created_at: string;
}

function mapTrigger(row: TriggerRow): ProactiveTrigger {
  return {
    id: row.id,
    workspaceId: row.workspace_id ?? undefined,
    triggerType: row.trigger_type as TriggerType,
    workflowId: row.workflow_id ?? undefined,
    config: parseJson<ProactiveTriggerConfig>(row.config, {}),
    enabled: row.enabled === 1,
    createdAt: row.created_at,
  };
}

function resolveTriggerAction(trigger: ProactiveTrigger): ProactiveAction {
  if (trigger.config.action) return trigger.config.action;
  if (trigger.config.workItemId) return 'enqueue_pipeline';
  return 'execute_workflow';
}

function shouldIgnoreFilePath(filePath: string): boolean {
  const name = filePath.split(/[/\\]/).pop() ?? '';
  return name.startsWith('.') || IGNORED_FILE_NAMES.has(name);
}

/** Record a system event to the database. */
export function recordEvent(eventType: string, payload: Record<string, unknown>): Event {
  const id = generateId();
  const timestamp = now();

  getDatabase()
    .prepare('INSERT INTO event (id, event_type, payload, created_at) VALUES (?, ?, ?, ?)')
    .run(id, eventType, JSON.stringify(payload), timestamp);

  return { id, eventType, payload, createdAt: timestamp };
}

/**
 * Register a file-watcher trigger that auto-enqueues a work-item pipeline on changes.
 * Watches `.agenthub-work/{KEY}/` under the work item's output directory.
 */
export function registerWorkItemPipelineTrigger(
  workItemId: string,
  options: {
    workspaceId?: string;
    workflowId?: string;
    debounceMs?: number;
    maxIterations?: number;
    autoLoop?: boolean;
    demo?: boolean;
  } = {}
): ProactiveTrigger {
  const item = getWorkItem(workItemId);
  if (!item) throw new Error('Work item not found');

  return proactiveEngine.registerTrigger(
    'file_changed',
    {
      workItemId,
      action: 'enqueue_pipeline',
      debounceMs: options.debounceMs ?? DEFAULT_DEBOUNCE_MS,
      maxIterations: options.maxIterations,
      autoLoop: options.autoLoop ?? true,
      demo: options.demo,
    },
    options.workspaceId ?? item.workspaceId,
    options.workflowId ?? item.workflowId
  );
}

/**
 * Background automation engine (Module J).
 * Watches files, schedules cron jobs, and fires workflow events on triggers.
 * Work-item-linked triggers can auto-enqueue implement/review loops (debounced).
 */
class ProactiveEngine {
  private watchers = new Map<string, FSWatcher>();
  private cronJobs = new Map<string, ScheduledTask>();
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Register a new proactive trigger. */
  registerTrigger(
    triggerType: TriggerType,
    config: ProactiveTriggerConfig = {},
    workspaceId?: string,
    workflowId?: string
  ): ProactiveTrigger {
    const id = generateId();
    const timestamp = now();

    getDatabase()
      .prepare(
        `INSERT INTO proactive_trigger (id, workspace_id, trigger_type, workflow_id, config, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, 1, ?)`
      )
      .run(id, workspaceId ?? null, triggerType, workflowId ?? null, JSON.stringify(config), timestamp);

    const trigger: ProactiveTrigger = {
      id,
      workspaceId,
      triggerType,
      workflowId,
      config,
      enabled: true,
      createdAt: timestamp,
    };

    if (trigger.enabled) this.activateTrigger(trigger);
    return trigger;
  }

  /** List all triggers. */
  listTriggers(workspaceId?: string): ProactiveTrigger[] {
    const db = getDatabase();
    const rows = workspaceId
      ? (db.prepare('SELECT * FROM proactive_trigger WHERE workspace_id = ? ORDER BY created_at DESC').all(workspaceId) as TriggerRow[])
      : (db.prepare('SELECT * FROM proactive_trigger ORDER BY created_at DESC').all() as TriggerRow[]);
    return rows.map(mapTrigger);
  }

  /** Get a trigger by ID. */
  getTrigger(id: string): ProactiveTrigger | null {
    const row = getDatabase()
      .prepare('SELECT * FROM proactive_trigger WHERE id = ?')
      .get(id) as TriggerRow | undefined;
    return row ? mapTrigger(row) : null;
  }

  /** Enable a trigger. */
  enableTrigger(id: string): ProactiveTrigger | null {
    const trigger = this.getTrigger(id);
    if (!trigger) return null;

    getDatabase().prepare('UPDATE proactive_trigger SET enabled = 1 WHERE id = ?').run(id);
    const updated = { ...trigger, enabled: true };
    this.activateTrigger(updated);
    return updated;
  }

  /** Disable a trigger. */
  disableTrigger(id: string): ProactiveTrigger | null {
    const trigger = this.getTrigger(id);
    if (!trigger) return null;

    getDatabase().prepare('UPDATE proactive_trigger SET enabled = 0 WHERE id = ?').run(id);
    this.deactivateTrigger(id);
    return { ...trigger, enabled: false };
  }

  /** Delete a trigger. */
  deleteTrigger(id: string): boolean {
    this.deactivateTrigger(id);
    const result = getDatabase().prepare('DELETE FROM proactive_trigger WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /** Manually fire a trigger event. */
  async fireTrigger(
    triggerType: TriggerType,
    payload: Record<string, unknown> = {},
    workflowId?: string,
    trigger?: ProactiveTrigger
  ): Promise<Event> {
    return this.handleTriggerEvent(triggerType, payload, workflowId, trigger);
  }

  /** Start watching a directory for file changes. */
  watchPath(triggerId: string, watchPath: string, trigger: ProactiveTrigger): void {
    if (this.watchers.has(triggerId)) return;

    const isWorkItemWatch = !!trigger.config.workItemId;
    const watcher = chokidar.watch(watchPath, {
      // Work-item output dirs live under `.agenthub-work/` — do not ignore dot dirs there.
      ignored: isWorkItemWatch
        ? (filePath) => {
            const name = path.basename(filePath);
            return name === '.git' || name === 'node_modules' || IGNORED_FILE_NAMES.has(name);
          }
        : /(^|[/\\])\../,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 25 },
    });

    const onFileEvent = (filePath: string, action: 'changed' | 'added') => {
      const current = this.getTrigger(triggerId);
      if (!current?.enabled) return;
      if (shouldIgnoreFilePath(filePath)) return;

      const debounceMs = current.config.debounceMs ?? DEFAULT_DEBOUNCE_MS;
      const debounceKey = `${triggerId}:${current.config.workItemId ?? watchPath}`;

      this.scheduleDebounced(debounceKey, debounceMs, () => {
        void this.handleTriggerEvent(
          'file_changed',
          { filePath, watchPath, action },
          current.workflowId,
          current
        );
      });
    };

    watcher.on('change', (filePath) => onFileEvent(filePath, 'changed'));
    watcher.on('add', (filePath) => onFileEvent(filePath, 'added'));

    this.watchers.set(triggerId, watcher);
  }

  /** Initialize all enabled triggers on startup. */
  initAllTriggers(): void {
    const triggers = this.listTriggers().filter((t) => t.enabled);
    for (const trigger of triggers) {
      this.activateTrigger(trigger);
    }
  }

  /** Shutdown all watchers, cron jobs, and debounce timers. */
  shutdown(): void {
    for (const [id] of this.watchers) this.deactivateTrigger(id);
    for (const timer of this.debounceTimers.values()) clearTimeout(timer);
    this.debounceTimers.clear();
  }

  /** List recent events. */
  listEvents(limit = 50): Event[] {
    const rows = getDatabase()
      .prepare('SELECT * FROM event ORDER BY created_at DESC LIMIT ?')
      .all(limit) as Array<{ id: string; event_type: string; payload: string; created_at: string }>;

    return rows.map((r) => ({
      id: r.id,
      eventType: r.event_type,
      payload: parseJson(r.payload, {}),
      createdAt: r.created_at,
    }));
  }

  private scheduleDebounced(key: string, debounceMs: number, action: () => void): void {
    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);
      action();
    }, debounceMs);

    this.debounceTimers.set(key, timer);
  }

  private resolveWatchPath(trigger: ProactiveTrigger): string | undefined {
    if (trigger.config.workItemId) {
      const item = getWorkItem(trigger.config.workItemId);
      if (!item) return undefined;
      return resolveWorkItemOutputDir(item);
    }
    return trigger.config.watchPath;
  }

  private activateTrigger(trigger: ProactiveTrigger): void {
    if (trigger.triggerType === 'file_changed') {
      const watchPath = this.resolveWatchPath(trigger);
      if (watchPath) {
        this.watchPath(trigger.id, watchPath, trigger);
      }
    }

    if (trigger.triggerType === 'schedule' && trigger.config.cron) {
      const expression = trigger.config.cron;
      if (!cron.validate(expression)) return;

      const job = cron.schedule(expression, () => {
        void this.handleTriggerEvent('schedule', { cron: expression, triggerId: trigger.id }, trigger.workflowId, trigger);
      });

      this.cronJobs.set(trigger.id, job);
    }
  }

  private deactivateTrigger(id: string): void {
    const watcher = this.watchers.get(id);
    if (watcher) {
      watcher.close();
      this.watchers.delete(id);
    }

    const job = this.cronJobs.get(id);
    if (job) {
      job.stop();
      this.cronJobs.delete(id);
    }

    for (const [key, timer] of this.debounceTimers) {
      if (key.startsWith(`${id}:`)) {
        clearTimeout(timer);
        this.debounceTimers.delete(key);
      }
    }
  }

  private async maybeEnqueuePipeline(
    trigger: ProactiveTrigger,
    payload: Record<string, unknown>
  ): Promise<{ jobId: string } | null> {
    const workItemId = trigger.config.workItemId;
    if (!workItemId) return null;

    const item = getWorkItem(workItemId);
    if (!item) {
      recordEvent('proactive_pipeline_skipped', {
        reason: 'work_item_not_found',
        workItemId,
        triggerId: trigger.id,
      });
      return null;
    }

    if (item.loopStatus === 'running' || hasActiveLoopJobForWorkItem(workItemId)) {
      recordEvent('proactive_pipeline_skipped', {
        reason: 'already_running',
        workItemId,
        triggerId: trigger.id,
        loopStatus: item.loopStatus,
      });
      return null;
    }

    const workflowId = trigger.workflowId ?? item.workflowId ?? ensureGrokCopilotWorkflow();
    const job = enqueueWorkItemPipeline(workItemId, workflowId, {
      maxIterations: trigger.config.maxIterations,
      autoLoop: trigger.config.autoLoop ?? true,
      demo: trigger.config.demo,
    });

    incrementCounter('agenthub_proactive_pipeline_enqueued_total', 'Proactive pipeline jobs enqueued', {
      trigger_type: trigger.triggerType,
    });

    logWorkItemActivity({
      workItemId,
      activityType: 'comment',
      summary: 'Pipeline auto-enqueued by proactive trigger',
      metadata: {
        event: 'proactive_pipeline_enqueued',
        triggerId: trigger.id,
        jobId: job.id,
        filePath: payload.filePath,
      },
    });

    broadcast({
      type: 'proactive:trigger',
      payload: {
        event: 'pipeline_enqueued',
        triggerId: trigger.id,
        workItemId,
        jobId: job.id,
        triggerType: trigger.triggerType,
        ...payload,
      },
      timestamp: now(),
    });

    return { jobId: job.id };
  }

  private async handleTriggerEvent(
    triggerType: TriggerType,
    payload: Record<string, unknown>,
    workflowId?: string,
    trigger?: ProactiveTrigger
  ): Promise<Event> {
    const event = recordEvent(triggerType, {
      ...payload,
      triggerId: trigger?.id,
      workItemId: trigger?.config.workItemId,
    });

    incrementCounter('agenthub_proactive_triggers_total', 'Proactive triggers fired', { type: triggerType });

    broadcast({
      type: 'proactive:trigger',
      payload: { eventId: event.id, triggerType, ...payload },
      timestamp: now(),
    });

    const action = trigger ? resolveTriggerAction(trigger) : 'execute_workflow';

    if (action === 'enqueue_pipeline' && trigger) {
      await this.maybeEnqueuePipeline(trigger, payload);
      return event;
    }

    const effectiveWorkflowId = workflowId ?? trigger?.workflowId;
    if (effectiveWorkflowId) {
      try {
        const filePaths = payload.filePath ? [payload.filePath as string] : [];
        await executeWorkflow(effectiveWorkflowId, { filePaths });
      } catch (err) {
        recordEvent('workflow_trigger_failed', {
          workflowId: effectiveWorkflowId,
          error: (err as Error).message,
          sourceEventId: event.id,
        });
      }
    }

    return event;
  }
}

export const proactiveEngine = new ProactiveEngine();