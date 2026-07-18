import { getDatabase } from '../database';
import type { LoopStatus } from '../types';
import { generateId, now } from '../utils/helpers';
import type { ReviewVerdict } from './eval-harness';

export type LoopRunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface LoopRun {
  id: string;
  workItemId?: string;
  workflowExecutionId?: string;
  loopId: string;
  iteration: number;
  maxIterations: number;
  status: LoopRunStatus;
  verdict?: ReviewVerdict;
  loopStatus?: LoopStatus;
  jobId?: string;
  error?: string;
  startedAt: string;
  completedAt?: string;
}

interface LoopRunRow {
  id: string;
  work_item_id: string | null;
  workflow_execution_id: string | null;
  loop_id: string;
  iteration: number;
  max_iterations: number;
  status: string;
  verdict: string | null;
  loop_status: string | null;
  job_id: string | null;
  error: string | null;
  started_at: string;
  completed_at: string | null;
}

function mapLoopRun(row: LoopRunRow): LoopRun {
  return {
    id: row.id,
    workItemId: row.work_item_id ?? undefined,
    workflowExecutionId: row.workflow_execution_id ?? undefined,
    loopId: row.loop_id,
    iteration: row.iteration,
    maxIterations: row.max_iterations,
    status: row.status as LoopRunStatus,
    verdict: (row.verdict as ReviewVerdict) ?? undefined,
    loopStatus: (row.loop_status as LoopStatus) ?? undefined,
    jobId: row.job_id ?? undefined,
    error: row.error ?? undefined,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
  };
}

export function createLoopRun(input: {
  workItemId?: string;
  workflowExecutionId?: string;
  loopId: string;
  maxIterations: number;
  jobId?: string;
}): string {
  const id = generateId();
  const timestamp = now();

  getDatabase()
    .prepare(
      `INSERT INTO loop_run
       (id, work_item_id, workflow_execution_id, loop_id, iteration, max_iterations, status, job_id, started_at)
       VALUES (?, ?, ?, ?, 0, ?, 'running', ?, ?)`
    )
    .run(
      id,
      input.workItemId ?? null,
      input.workflowExecutionId ?? null,
      input.loopId,
      input.maxIterations,
      input.jobId ?? null,
      timestamp
    );

  return id;
}

export function updateLoopRun(
  id: string,
  updates: { iteration?: number; verdict?: ReviewVerdict; loopStatus?: LoopStatus }
): void {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (updates.iteration !== undefined) {
    sets.push('iteration = ?');
    params.push(updates.iteration);
  }
  if (updates.verdict !== undefined) {
    sets.push('verdict = ?');
    params.push(updates.verdict);
  }
  if (updates.loopStatus !== undefined) {
    sets.push('loop_status = ?');
    params.push(updates.loopStatus);
  }

  if (sets.length === 0) return;
  params.push(id);
  getDatabase().prepare(`UPDATE loop_run SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

export function completeLoopRun(
  id: string,
  result: { iteration: number; verdict: ReviewVerdict; loopStatus: LoopStatus }
): void {
  getDatabase()
    .prepare(
      `UPDATE loop_run SET iteration = ?, verdict = ?, loop_status = ?, status = 'completed', completed_at = ? WHERE id = ?`
    )
    .run(result.iteration, result.verdict, result.loopStatus, now(), id);
}

export function failLoopRun(id: string, error: string): void {
  getDatabase()
    .prepare(
      `UPDATE loop_run SET status = 'failed', loop_status = 'failed', error = ?, completed_at = ? WHERE id = ?`
    )
    .run(error, now(), id);
}

export function cancelLoopRun(id: string): void {
  getDatabase()
    .prepare(
      `UPDATE loop_run SET status = 'cancelled', loop_status = 'cancelled', error = 'Cancelled by user', completed_at = ? WHERE id = ?`
    )
    .run(now(), id);
}

export function getLoopRun(id: string): LoopRun | null {
  const row = getDatabase().prepare('SELECT * FROM loop_run WHERE id = ?').get(id) as LoopRunRow | undefined;
  return row ? mapLoopRun(row) : null;
}

export function listLoopRuns(workItemId: string): LoopRun[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM loop_run WHERE work_item_id = ? ORDER BY started_at DESC')
    .all(workItemId) as LoopRunRow[];
  return rows.map(mapLoopRun);
}

/** Mark stale running loop runs as failed (server restart recovery). */
export function recoverStaleLoopRuns(): number {
  const result = getDatabase()
    .prepare(
      `UPDATE loop_run SET status = 'failed', loop_status = 'failed', error = 'Interrupted by server restart', completed_at = ?
       WHERE status = 'running'`
    )
    .run(now());
  return result.changes;
}