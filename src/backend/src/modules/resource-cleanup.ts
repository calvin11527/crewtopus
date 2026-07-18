import fs from 'fs';
import path from 'path';
import { getDatabase } from '../database';
import { cleanupStreamLogs } from './cli-stream';
import { resolveAuditSnapshotDir } from './audit-snapshot';

const CLEANUP_INTERVAL_MS =
  Number(process.env.AGENTHUB_RESOURCE_CLEANUP_MS) || 60 * 60 * 1000;
const STREAM_LOG_MAX_AGE_MS =
  Number(process.env.AGENTHUB_STREAM_LOG_MAX_AGE_MS) || 24 * 60 * 60 * 1000;
const AUDIT_SNAPSHOT_MAX_AGE_MS =
  Number(process.env.AGENTHUB_AUDIT_SNAPSHOT_MAX_AGE_MS) || 7 * 24 * 60 * 60 * 1000;
const LOOP_JOB_RETENTION_MS =
  Number(process.env.AGENTHUB_LOOP_JOB_RETENTION_MS) || 7 * 24 * 60 * 60 * 1000;

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function cleanupAuditSnapshots(maxAgeMs: number): number {
  const dir = resolveAuditSnapshotDir();
  if (!fs.existsSync(dir)) return 0;

  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;

  try {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.json.gz')) continue;
      const filePath = path.join(dir, name);
      try {
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
          removed++;
        }
      } catch {
        /* best-effort */
      }
    }
  } catch {
    /* best-effort */
  }

  return removed;
}

/** Drop full agent payloads from old completed loop jobs (keeps status metadata). */
function pruneLoopJobResults(maxAgeMs: number): number {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const result = getDatabase()
    .prepare(
      `UPDATE loop_job
       SET result = json_object(
         'loopStatus', json_extract(result, '$.loopStatus'),
         'iterations', json_extract(result, '$.iterations'),
         'reviewVerdict', json_extract(result, '$.reviewVerdict'),
         'loopRunId', json_extract(result, '$.loopRunId'),
         'pruned', 1
       )
       WHERE status IN ('completed', 'failed', 'cancelled')
         AND result IS NOT NULL
         AND json_extract(result, '$.pruned') IS NULL
         AND completed_at IS NOT NULL
         AND completed_at < ?`
    )
    .run(cutoff);
  return result.changes;
}

/** Run all periodic resource cleanup tasks. */
export function runResourceCleanup(): {
  streamLogsRemoved: number;
  auditSnapshotsRemoved: number;
  loopJobsPruned: number;
} {
  const streamLogsRemoved = cleanupStreamLogs(STREAM_LOG_MAX_AGE_MS);
  const auditSnapshotsRemoved = cleanupAuditSnapshots(AUDIT_SNAPSHOT_MAX_AGE_MS);
  const loopJobsPruned = pruneLoopJobResults(LOOP_JOB_RETENTION_MS);

  if (streamLogsRemoved || auditSnapshotsRemoved || loopJobsPruned) {
    console.log(
      `[ResourceCleanup] streamLogs=${streamLogsRemoved} auditSnapshots=${auditSnapshotsRemoved} loopJobs=${loopJobsPruned}`
    );
  }

  return { streamLogsRemoved, auditSnapshotsRemoved, loopJobsPruned };
}

export function startResourceCleanup(): void {
  if (cleanupTimer) return;
  runResourceCleanup();
  cleanupTimer = setInterval(() => {
    try {
      runResourceCleanup();
    } catch (err) {
      console.error('[ResourceCleanup]', (err as Error).message);
    }
  }, CLEANUP_INTERVAL_MS);
}

export function stopResourceCleanup(): void {
  if (!cleanupTimer) return;
  clearInterval(cleanupTimer);
  cleanupTimer = null;
}