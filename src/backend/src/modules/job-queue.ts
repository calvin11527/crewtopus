import { getDatabase } from '../database';
import { generateId, now, parseJson } from '../utils/helpers';
import { setGauge, incrementCounter } from '../metrics';
import type { WorkItemStatus } from '../types';
import { getWorkItem, updateWorkItem } from './work-items';
import { logWorkItemActivity } from './work-item-activity';


export type LoopJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type LoopJobType = 'work_item_pipeline' | 'work_item_agent' | 'story_ba' | 'story_pm';

export interface LoopJob {
  id: string;
  workItemId?: string;
  workflowId?: string;
  jobType: LoopJobType;
  status: LoopJobStatus;
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  loopRunId?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

interface LoopJobRow {
  id: string;
  work_item_id: string | null;
  workflow_id: string | null;
  job_type: string;
  status: string;
  payload: string;
  result: string | null;
  error: string | null;
  loop_run_id: string | null;
  worker_pid: number | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

function isWorkerProcessAlive(pid: number | null | undefined): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function mapJob(row: LoopJobRow): LoopJob {
  return {
    id: row.id,
    workItemId: row.work_item_id ?? undefined,
    workflowId: row.workflow_id ?? undefined,
    jobType: row.job_type as LoopJobType,
    status: row.status as LoopJobStatus,
    payload: parseJson(row.payload, {}),
    result: row.result ? parseJson<Record<string, unknown>>(row.result, {}) : undefined,
    error: row.error ?? undefined,
    loopRunId: row.loop_run_id ?? undefined,
    createdAt: row.created_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
  };
}

function countJobsByStatus(status: LoopJobStatus): number {
  const row = getDatabase()
    .prepare('SELECT COUNT(*) AS c FROM loop_job WHERE status = ?')
    .get(status) as { c: number };
  return row.c;
}

export function updateQueueDepthGauge(): void {
  setGauge('agenthub_queue_depth', 'Pending loop jobs in queue', countJobsByStatus('pending'));
}

/** Enqueue a work-item pipeline job (durable SQLite queue). */
export function enqueueWorkItemPipeline(
  workItemId: string,
  workflowId: string,
  options: {
    maxIterations?: number;
    autoLoop?: boolean;
    demo?: boolean;
    retryMode?: string;
    escalationContext?: {
      priorImplementation: string;
      reviewFeedback: string;
      implementAuditId?: string;
      reviewAuditId?: string;
    };
    autoChainFix?: boolean;
  } = {}
): LoopJob {
  const id = generateId();
  const timestamp = now();

  getDatabase()
    .prepare(
      `INSERT INTO loop_job (id, work_item_id, workflow_id, job_type, status, payload, created_at)
       VALUES (?, ?, ?, 'work_item_pipeline', 'pending', ?, ?)`
    )
    .run(id, workItemId, workflowId, JSON.stringify(options), timestamp);

  incrementCounter('agenthub_loop_jobs_enqueued_total', 'Loop jobs enqueued', { type: 'work_item_pipeline' });
  updateQueueDepthGauge();

  pushToRedis(id).catch(() => { /* optional redis */ });

  return getLoopJob(id)!;
}

/** Enqueue BA or PM lifecycle phase for a story. */
export function enqueueStoryLifecycleJob(
  workItemId: string,
  jobType: 'story_ba' | 'story_pm',
  payload: {
    sprintId: string;
    chainFullLifecycle?: boolean;
    storyId?: string;
    maxIterations?: number;
    autoLoop?: boolean;
    orchestrator?: string;
  }
): LoopJob {
  const id = generateId();
  const timestamp = now();

  getDatabase()
    .prepare(
      `INSERT INTO loop_job (id, work_item_id, workflow_id, job_type, status, payload, created_at)
       VALUES (?, ?, NULL, ?, 'pending', ?, ?)`
    )
    .run(id, workItemId, jobType, JSON.stringify(payload), timestamp);

  incrementCounter('agenthub_loop_jobs_enqueued_total', 'Loop jobs enqueued', { type: jobType });
  updateQueueDepthGauge();

  pushToRedis(id).catch(() => { /* optional redis */ });

  return getLoopJob(id)!;
}

/** Enqueue a single-agent run (durable SQLite queue). */
export function enqueueWorkItemAgent(workItemId: string): LoopJob {
  const id = generateId();
  const timestamp = now();

  getDatabase()
    .prepare(
      `INSERT INTO loop_job (id, work_item_id, workflow_id, job_type, status, payload, created_at)
       VALUES (?, ?, NULL, 'work_item_agent', 'pending', '{}', ?)`
    )
    .run(id, workItemId, timestamp);

  incrementCounter('agenthub_loop_jobs_enqueued_total', 'Loop jobs enqueued', { type: 'work_item_agent' });
  updateQueueDepthGauge();

  pushToRedis(id).catch(() => { /* optional redis */ });

  return getLoopJob(id)!;
}

export function getLoopJob(id: string): LoopJob | null {
  const row = getDatabase().prepare('SELECT * FROM loop_job WHERE id = ?').get(id) as LoopJobRow | undefined;
  return row ? mapJob(row) : null;
}

/** Pending or running job for a work item (at most one active run). */
export function getActiveJobForWorkItem(workItemId: string): LoopJob | null {
  const row = getDatabase()
    .prepare(
      `SELECT * FROM loop_job
       WHERE work_item_id = ? AND status IN ('pending', 'running')
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(workItemId) as LoopJobRow | undefined;
  return row ? mapJob(row) : null;
}

/** True when a work item already has a pending or running loop job. */
export function hasActiveLoopJobForWorkItem(workItemId: string): boolean {
  const row = getDatabase()
    .prepare(
      `SELECT COUNT(*) AS c FROM loop_job
       WHERE work_item_id = ? AND status IN ('pending', 'running')`
    )
    .get(workItemId) as { c: number };
  return row.c > 0;
}

export function claimNextPendingJob(): LoopJob | null {
  const row = getDatabase()
    .prepare(
      `SELECT * FROM loop_job WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1`
    )
    .get() as LoopJobRow | undefined;

  if (!row) return null;

  const timestamp = now();
  const updated = getDatabase()
    .prepare(
      `UPDATE loop_job SET status = 'running', started_at = ?, worker_pid = ? WHERE id = ? AND status = 'pending'`
    )
    .run(timestamp, process.pid, row.id);

  if (updated.changes === 0) return null;

  updateQueueDepthGauge();
  return getLoopJob(row.id);
}

export function completeLoopJob(
  id: string,
  result: Record<string, unknown>,
  loopRunId?: string
): LoopJob | null {
  getDatabase()
    .prepare(
      `UPDATE loop_job SET status = 'completed', result = ?, loop_run_id = ?, completed_at = ? WHERE id = ?`
    )
    .run(JSON.stringify(result), loopRunId ?? null, now(), id);

  updateQueueDepthGauge();
  return getLoopJob(id);
}

export function failLoopJob(id: string, error: string, loopRunId?: string): LoopJob | null {
  getDatabase()
    .prepare(
      `UPDATE loop_job SET status = 'failed', error = ?, loop_run_id = ?, completed_at = ? WHERE id = ?`
    )
    .run(error, loopRunId ?? null, now(), id);

  updateQueueDepthGauge();
  return getLoopJob(id);
}

/** Recover jobs stuck in running state after crash (skip jobs owned by live workers). */
export function recoverStaleLoopJobs(): number {
  const running = getDatabase()
    .prepare(`SELECT id, work_item_id, worker_pid FROM loop_job WHERE status = 'running'`)
    .all() as Array<{ id: string; work_item_id: string | null; worker_pid: number | null }>;

  let recovered = 0;
  for (const row of running) {
    if (isWorkerProcessAlive(row.worker_pid)) continue;

    failLoopJob(row.id, 'Interrupted by server restart');
    recovered++;

    if (!row.work_item_id) continue;
    const item = getWorkItem(row.work_item_id);
    if (!item || item.status !== 'in_progress') continue;
    updateWorkItem(row.work_item_id, {
      status: 'todo',
      loopStatus: item.loopStatus === 'running' ? 'failed' : 'idle',
    });
    logWorkItemActivity({
      workItemId: row.work_item_id,
      activityType: 'agent_failed',
      summary: `Agent run interrupted on ${item.key} (server restart)`,
      agentType: item.assignedAgentType,
      metadata: { error: 'Interrupted by server restart' },
    });
  }

  updateQueueDepthGauge();
  return recovered;
}

/** Reset work items left in loop_status=running with no active job or loop run. */
export function recoverOrphanedWorkItemLoops(): number {
  const rows = getDatabase()
    .prepare(`SELECT id, key, status FROM work_item WHERE loop_status = 'running'`)
    .all() as Array<{ id: string; key: string; status: string }>;

  let recovered = 0;
  for (const row of rows) {
    if (getActiveJobForWorkItem(row.id)) continue;

    const activeRun = getDatabase()
      .prepare(`SELECT id FROM loop_run WHERE work_item_id = ? AND status = 'running' LIMIT 1`)
      .get(row.id);
    if (activeRun) continue;

    updateWorkItem(row.id, {
      status: row.status === 'in_progress' ? 'todo' : (row.status as WorkItemStatus),
      loopStatus: 'failed',
    });
    logWorkItemActivity({
      workItemId: row.id,
      activityType: 'agent_failed',
      summary: `Loop on ${row.key} was interrupted (no active job)`,
      metadata: { event: 'orphan_loop_recovery' },
    });
    recovered++;
  }

  return recovered;
}

/** Reset work items left in status=in_progress with no active job or running loop. */
export function recoverOrphanedInProgressWorkItems(): number {
  const rows = getDatabase()
    .prepare(`SELECT id, key FROM work_item WHERE status = 'in_progress' AND loop_status != 'running'`)
    .all() as Array<{ id: string; key: string }>;

  let recovered = 0;
  for (const row of rows) {
    if (getActiveJobForWorkItem(row.id)) continue;

    const activeRun = getDatabase()
      .prepare(`SELECT id FROM loop_run WHERE work_item_id = ? AND status = 'running' LIMIT 1`)
      .get(row.id);
    if (activeRun) continue;

    updateWorkItem(row.id, { status: 'todo' });
    logWorkItemActivity({
      workItemId: row.id,
      activityType: 'agent_failed',
      summary: `Work on ${row.key} was interrupted (no active run)`,
      metadata: { event: 'orphan_in_progress_recovery' },
    });
    recovered++;
  }

  return recovered;
}

interface RedisNotifyClient {
  lPush(key: string, value: string): Promise<unknown>;
  quit(): Promise<unknown>;
}

let redisClientPromise: Promise<RedisNotifyClient | null> | null = null;

async function getRedisClient(): Promise<RedisNotifyClient | null> {
  const url = process.env.AGENTHUB_REDIS_URL || process.env.REDIS_URL;
  if (!url) return null;

  if (!redisClientPromise) {
    redisClientPromise = (async () => {
      try {
        const { createClient } = await import('redis');
        const client = createClient({ url });
        client.on('error', () => {
          /* handled on reconnect attempts */
        });
        await client.connect();
        return client as unknown as RedisNotifyClient;
      } catch {
        redisClientPromise = null;
        return null;
      }
    })();
  }

  return redisClientPromise;
}

/** Optional Redis notify (LPUSH) when AGENTHUB_REDIS_URL is set. */
async function pushToRedis(jobId: string): Promise<void> {
  try {
    const client = await getRedisClient();
    if (!client) return;
    await client.lPush('agenthub:loop:jobs', jobId);
  } catch {
    redisClientPromise = null;
    // Redis is optional; SQLite queue remains source of truth
  }
}

export async function closeRedisClient(): Promise<void> {
  const client = redisClientPromise ? await redisClientPromise.catch(() => null) : null;
  redisClientPromise = null;
  if (client) {
    try {
      await client.quit();
    } catch {
      /* best-effort */
    }
  }
}