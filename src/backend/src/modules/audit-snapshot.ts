import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import type { ContextScope } from '../types';
import { canonicalizeScope } from './context-scope';

/** Resolve `.agenthub-work/_audit` directory for context snapshots. */
export function resolveAuditSnapshotDir(): string {
  const workDir = process.env.AGENTHUB_WORK_DIR;
  if (workDir?.includes('.agenthub-work')) {
    const parent = path.dirname(workDir);
    if (path.basename(parent) === '.agenthub-work') {
      return path.join(parent, '_audit');
    }
  }

  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, '.agenthub-work');
    if (fs.existsSync(candidate)) {
      return path.join(candidate, '_audit');
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return path.join(process.cwd(), '.agenthub-work', '_audit');
}

function snapshotPath(auditId: string): string {
  return path.join(resolveAuditSnapshotDir(), `${auditId}.json.gz`);
}

/** Persist a gzip-compressed canonical context snapshot for forensic replay. */
export function saveAuditSnapshot(auditId: string, scope: ContextScope): string {
  const dir = resolveAuditSnapshotDir();
  fs.mkdirSync(dir, { recursive: true });
  const filePath = snapshotPath(auditId);
  const payload = zlib.gzipSync(canonicalizeScope(scope));
  fs.writeFileSync(filePath, payload);
  return filePath;
}

/** Load a stored context snapshot; returns null when missing or corrupt. */
export function loadAuditSnapshot(auditId: string): ContextScope | null {
  const filePath = snapshotPath(auditId);
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = zlib.gunzipSync(fs.readFileSync(filePath)).toString('utf-8');
    const parsed = JSON.parse(raw) as ContextScope;
    if (!Array.isArray(parsed.files)) return null;
    return {
      files: parsed.files,
      diffs: parsed.diffs ?? [],
      symbols: parsed.symbols ?? [],
      maxTokens: parsed.maxTokens ?? 8000,
      sensitivityLevel: parsed.sensitivityLevel ?? 0,
    };
  } catch {
    return null;
  }
}

/** Check whether a snapshot exists for an audit entry. */
export function hasAuditSnapshot(auditId: string): boolean {
  return fs.existsSync(snapshotPath(auditId));
}