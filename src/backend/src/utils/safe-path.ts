import fs from 'fs';
import path from 'path';

/**
 * CodeQL-recognized containment check: resolved path must be under root
 * (including exact root). Uses path.resolve + startsWith with separator.
 */
function isContained(root: string, candidate: string): boolean {
  const rootResolved = path.resolve(root);
  const candidateResolved = path.resolve(candidate);
  const prefix = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep;
  return candidateResolved === rootResolved || candidateResolved.startsWith(prefix);
}

/**
 * Resolve `segments` under `root` and ensure the result cannot escape the root.
 * Pattern matches CodeQL path-injection sanitizers (resolve + startsWith).
 */
export function resolveWithinRoot(root: string, ...segments: string[]): string {
  const rootResolved = path.resolve(root);
  // Reject empty / traversal-only segments early
  for (const seg of segments) {
    if (typeof seg !== 'string' || seg.includes('\0')) {
      throw new Error('Invalid path segment');
    }
  }
  const candidate = path.resolve(rootResolved, ...segments);
  const prefix = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep;
  if (candidate !== rootResolved && !candidate.startsWith(prefix)) {
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

/** True when candidate is under root (CodeQL startsWith pattern). */
export function isPathInside(root: string, candidate: string): boolean {
  return isContained(root, candidate);
}

/** Restrict ids used in filenames (work items, audit ids) to a safe charset. */
export function sanitizePathId(id: string, maxLen = 128): string {
  const cleaned = String(id).replace(/[^a-zA-Z0-9._-]/g, '').slice(0, maxLen);
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    throw new Error('Invalid identifier for filesystem path');
  }
  return cleaned;
}

/** Strip CR/LF and control chars from values written to logs. */
export function sanitizeForLog(value: unknown, maxLen = 200): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .slice(0, maxLen);
}

/** Safe object-key merge: only copies own enumerable keys matching a safe pattern. */
export function mergeSafeConfig(
  base: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = Object.assign({}, base);
  for (const key of Object.keys(patch)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) continue;
    const value = Object.prototype.hasOwnProperty.call(patch, key) ? patch[key] : undefined;
    if (value === null) {
      delete merged[key];
    } else if (value !== undefined) {
      Object.defineProperty(merged, key, {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
  }
  return merged;
}

/** Read a file only after resolving under root (wrapper for common FS sinks). */
export function readFileWithinRoot(root: string, ...segments: string[]): string {
  const filePath = resolveWithinRoot(root, ...segments);
  return fs.readFileSync(filePath, 'utf-8');
}

/** Stat a file only after resolving under root. */
export function statWithinRoot(root: string, ...segments: string[]): fs.Stats {
  const filePath = resolveWithinRoot(root, ...segments);
  return fs.statSync(filePath);
}

/** exists check only after resolving under root. */
export function existsWithinRoot(root: string, ...segments: string[]): boolean {
  try {
    const filePath = resolveWithinRoot(root, ...segments);
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}
