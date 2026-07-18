import fs from 'fs';
import path from 'path';

/** Resolve path, following symlinks when the path exists (fixes macOS /var → /private/var). */
function realResolve(target: string): string {
  const resolved = path.resolve(target);
  try {
    return fs.realpathSync(resolved);
  } catch {
    // Walk up to an existing ancestor and rejoin the missing tail.
    let probe = resolved;
    const missing: string[] = [];
    while (!fs.existsSync(probe)) {
      missing.unshift(path.basename(probe));
      const parent = path.dirname(probe);
      if (parent === probe) return resolved;
      probe = parent;
    }
    try {
      return path.join(fs.realpathSync(probe), ...missing);
    } catch {
      return resolved;
    }
  }
}

function isInside(root: string, candidate: string): boolean {
  const rootReal = realResolve(root);
  const candidateReal = realResolve(candidate);
  const rel = path.relative(rootReal, candidateReal);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Resolve `segments` under `root` and ensure the result cannot escape the root
 * (blocks `..`, absolute overrides, and symlink escapes when possible).
 */
export function resolveWithinRoot(root: string, ...segments: string[]): string {
  // Keep logical resolved paths (no forced realpath) so callers/tests that compare
  // against path.join/path.resolve stay stable on macOS /var → /private/var links.
  const rootResolved = path.resolve(root);
  const candidate = path.resolve(rootResolved, ...segments);

  if (!isInside(rootResolved, candidate)) {
    throw new Error(`Path escapes allowed root: ${candidate}`);
  }

  return candidate;
}

/** Like resolveWithinRoot but returns null instead of throwing. */
export function tryResolveWithinRoot(root: string, ...segments: string[]): string | null {
  try {
    return resolveWithinRoot(root, ...segments);
  } catch {
    return null;
  }
}

/** Restrict ids used in filenames (work items, audit ids) to a safe charset. */
export function sanitizePathId(id: string, maxLen = 128): string {
  const cleaned = id.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, maxLen);
  if (!cleaned) throw new Error('Invalid identifier for filesystem path');
  return cleaned;
}

/** Strip CR/LF and control chars from values written to logs. */
export function sanitizeForLog(value: unknown, maxLen = 500): string {
  const text = String(value ?? '');
  return text.replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').slice(0, maxLen);
}

/** Safe object-key merge: only copies own enumerable keys matching a safe pattern. */
export function mergeSafeConfig(
  base: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const key of Object.keys(patch)) {
    // Disallow prototype pollution and weird keys
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) continue;
    const value = patch[key];
    if (value === null) {
      delete merged[key];
    } else {
      merged[key] = value;
    }
  }
  return merged;
}
