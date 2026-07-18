import fs from 'fs';
import path from 'path';
import type { AgentType } from '../types';
import { now } from '../utils/helpers';
import { resolveWithinRoot, sanitizePathId } from '../utils/safe-path';
import { broadcast } from '../websocket';

export interface SpawnCliOptions {
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  maxOutputBytes?: number;
  registry?: {
    workItemId: string;
    loopIteration?: number;
    agentType: AgentType;
  };
}

export interface CliStreamContext {
  workItemId: string;
  agentType: AgentType;
  phase?: string;
  loopIteration?: number;
}

interface StreamBuffer {
  stdout: string;
  stderr: string;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface CliOutputSnapshot {
  workItemId: string;
  stdout: string;
  stderr: string;
  updatedAt: string;
  logPath?: string;
}

const FLUSH_MS = 50;
const MAX_CHUNK = 2048;
const MAX_RING_CHARS = 256_000;
const MAX_STREAM_LOG_BYTES =
  Number(process.env.AGENTHUB_CLI_STREAM_MAX_LOG_BYTES) || 512 * 1024;
const MAX_RING_BUFFER_ENTRIES = Number(process.env.AGENTHUB_MAX_RING_BUFFERS) || 50;

const buffers = new Map<string, StreamBuffer>();
const ringBuffers = new Map<string, { stdout: string; stderr: string; updatedAt: string }>();
const streamLogBytes = new Map<string, number>();

function resolveStreamLogDir(): string {
  const workDir = process.env.AGENTHUB_WORK_DIR;
  const base = workDir && fs.existsSync(workDir) ? workDir : process.cwd();
  const dir = path.join(base, '.agenthub-work', '_streams');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function streamLogPath(workItemId: string): string {
  const safeId = sanitizePathId(workItemId);
  return resolveWithinRoot(resolveStreamLogDir(), `${safeId}.log`);
}

function refreshStreamLogBytes(workItemId: string): number {
  const logPath = streamLogPath(workItemId);
  if (!fs.existsSync(logPath)) {
    streamLogBytes.set(workItemId, 0);
    return 0;
  }
  try {
    const size = fs.statSync(logPath).size;
    streamLogBytes.set(workItemId, size);
    return size;
  } catch {
    streamLogBytes.set(workItemId, 0);
    return 0;
  }
}

function rotateStreamLog(workItemId: string): void {
  const logPath = streamLogPath(workItemId);
  try {
    const content = fs.readFileSync(logPath, 'utf-8');
    const tail = content.slice(-MAX_RING_CHARS);
    fs.writeFileSync(logPath, tail);
    streamLogBytes.set(workItemId, Buffer.byteLength(tail, 'utf-8'));
  } catch {
    try {
      fs.unlinkSync(logPath);
    } catch {
      /* best-effort */
    }
    streamLogBytes.delete(workItemId);
  }
}

function appendToStreamLog(workItemId: string, stream: 'stdout' | 'stderr', chunk: string): void {
  if (process.env.AGENTHUB_CLI_STREAM_PERSIST === 'false') return;

  const payload = `[${stream}] ${chunk}`;
  const payloadBytes = Buffer.byteLength(payload, 'utf-8');
  let size = streamLogBytes.get(workItemId);
  if (size === undefined) size = refreshStreamLogBytes(workItemId);

  if (size + payloadBytes > MAX_STREAM_LOG_BYTES) {
    rotateStreamLog(workItemId);
    size = streamLogBytes.get(workItemId) ?? 0;
    if (size + payloadBytes > MAX_STREAM_LOG_BYTES) return;
  }

  try {
    fs.appendFileSync(streamLogPath(workItemId), payload);
    streamLogBytes.set(workItemId, size + payloadBytes);
  } catch {
    /* best-effort */
  }
}

function evictOldestRingBuffer(): void {
  if (ringBuffers.size <= MAX_RING_BUFFER_ENTRIES) return;

  let oldestId: string | null = null;
  let oldestAt = '';
  for (const [id, ring] of ringBuffers) {
    if (!oldestId || ring.updatedAt < oldestAt) {
      oldestId = id;
      oldestAt = ring.updatedAt;
    }
  }
  if (oldestId) ringBuffers.delete(oldestId);
}

function updateRingBuffer(workItemId: string, stream: 'stdout' | 'stderr', chunk: string): void {
  let ring = ringBuffers.get(workItemId);
  if (!ring) {
    evictOldestRingBuffer();
    ring = { stdout: '', stderr: '', updatedAt: now() };
    ringBuffers.set(workItemId, ring);
  }
  if (stream === 'stdout') {
    ring.stdout = (ring.stdout + chunk).slice(-MAX_RING_CHARS);
  } else {
    ring.stderr = (ring.stderr + chunk).slice(-MAX_RING_CHARS);
  }
  ring.updatedAt = now();
}

function bufferFor(workItemId: string): StreamBuffer {
  let buf = buffers.get(workItemId);
  if (!buf) {
    buf = { stdout: '', stderr: '', timer: null };
    buffers.set(workItemId, buf);
  }
  return buf;
}

function emitChunk(ctx: CliStreamContext, stream: 'stdout' | 'stderr', chunk: string): void {
  if (!chunk) return;
  broadcast({
    type: 'work_item:cli_output',
    payload: {
      workItemId: ctx.workItemId,
      stream,
      chunk,
      agentType: ctx.agentType,
      phase: ctx.phase,
      loopIteration: ctx.loopIteration,
    },
    timestamp: now(),
  });
}

function flushStream(ctx: CliStreamContext, stream: 'stdout' | 'stderr'): void {
  const buf = buffers.get(ctx.workItemId);
  if (!buf) return;

  const pending = stream === 'stdout' ? buf.stdout : buf.stderr;
  if (!pending) return;

  if (stream === 'stdout') buf.stdout = '';
  else buf.stderr = '';

  emitChunk(ctx, stream, pending);
}

function scheduleFlush(ctx: CliStreamContext): void {
  const buf = bufferFor(ctx.workItemId);
  if (buf.timer) return;

  buf.timer = setTimeout(() => {
    buf.timer = null;
    flushStream(ctx, 'stdout');
    flushStream(ctx, 'stderr');
  }, FLUSH_MS);
}

function appendChunk(ctx: CliStreamContext, stream: 'stdout' | 'stderr', chunk: string): void {
  const buf = bufferFor(ctx.workItemId);
  if (stream === 'stdout') buf.stdout += chunk;
  else buf.stderr += chunk;

  updateRingBuffer(ctx.workItemId, stream, chunk);
  appendToStreamLog(ctx.workItemId, stream, chunk);

  const pending = stream === 'stdout' ? buf.stdout : buf.stderr;
  if (pending.length >= MAX_CHUNK) {
    flushStream(ctx, stream);
    return;
  }
  scheduleFlush(ctx);
}

/** Build spawn handlers that broadcast incremental CLI output for a work item. */
export function createCliStreamHandlers(ctx: CliStreamContext): SpawnCliOptions {
  return {
    onStdout: (chunk) => appendChunk(ctx, 'stdout', chunk),
    onStderr: (chunk) => appendChunk(ctx, 'stderr', chunk),
  };
}

/** Flush any buffered CLI output after a process completes. */
export function endCliStream(workItemId: string, ctx?: Omit<CliStreamContext, 'workItemId'>): void {
  const buf = buffers.get(workItemId);
  if (!buf) return;

  if (buf.timer) {
    clearTimeout(buf.timer);
    buf.timer = null;
  }

  if (ctx) {
    const fullCtx: CliStreamContext = { workItemId, ...ctx };
    flushStream(fullCtx, 'stdout');
    flushStream(fullCtx, 'stderr');
  } else {
    if (buf.stdout) {
      emitChunk({ workItemId, agentType: 'mock' }, 'stdout', buf.stdout);
      buf.stdout = '';
    }
    if (buf.stderr) {
      emitChunk({ workItemId, agentType: 'mock' }, 'stderr', buf.stderr);
      buf.stderr = '';
    }
  }

  buffers.delete(workItemId);
  ringBuffers.delete(workItemId);
}

/** Return recent CLI output for a work item (in-memory ring + optional log file tail). */
export function getCliOutputForWorkItem(workItemId: string): CliOutputSnapshot | null {
  const ring = ringBuffers.get(workItemId);
  const logPath = streamLogPath(workItemId);
  let stdout = ring?.stdout ?? '';
  let stderr = ring?.stderr ?? '';

  if (!stdout && !stderr) {
    try {
      const content = fs.readFileSync(logPath, 'utf-8');
      stdout = content.slice(-MAX_RING_CHARS);
    } catch {
      /* no log file */
    }
  }

  if (!stdout && !stderr) return null;

  let hasLog = false;
  try {
    fs.accessSync(logPath);
    hasLog = true;
  } catch {
    hasLog = false;
  }

  return {
    workItemId,
    stdout,
    stderr,
    updatedAt: ring?.updatedAt ?? now(),
    logPath: hasLog ? logPath : undefined,
  };
}

/** Remove stale on-disk CLI stream logs to cap workspace growth. */
export function cleanupStreamLogs(maxAgeMs = 24 * 60 * 60 * 1000): number {
  const dir = resolveStreamLogDir();
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;

  try {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.log')) continue;
      if (name.includes('..') || name.includes('/') || name.includes('\\')) continue;
      let filePath: string;
      try {
        filePath = resolveWithinRoot(dir, name);
      } catch {
        continue;
      }
      try {
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
          streamLogBytes.delete(name.slice(0, -4));
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

/** Clear stream buffers (for tests). */
export function clearCliStreamBuffers(): void {
  for (const buf of buffers.values()) {
    if (buf.timer) clearTimeout(buf.timer);
  }
  buffers.clear();
  ringBuffers.clear();
  streamLogBytes.clear();
}