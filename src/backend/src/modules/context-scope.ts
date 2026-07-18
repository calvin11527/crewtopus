import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import type { ContextScope } from '../types';
import { estimateTokens } from '../adapters/base';
import { scanForSecrets } from './privacy-guard';
import { isExcludedContextPath } from './context-path-filters';

/** Priority tier for context file inclusion (lower = higher priority). */
export type ContextPriorityTier = 1 | 2 | 3 | 4;

/** A file path group with priority for token budgeting. */
export interface ContextFileGroup {
  tier: ContextPriorityTier;
  label: string;
  filePaths: string[];
}

/** Summary of what was included, truncated, or dropped from context. */
export interface ContextSummary {
  included: string[];
  truncated: string[];
  dropped: string[];
  tokenBudgetUsed: number;
}

/** Request to build a ContextScope. */
export interface ContextScopeRequest {
  filePaths?: string[];
  basePath?: string;
  includeDiffs?: boolean;
  includeSymbols?: boolean;
  maxTokens?: number;
  sensitivityLevel?: number;
  /** Priority-ordered file groups; when set, tier-1 files are never silently dropped. */
  fileGroups?: ContextFileGroup[];
}

const SYMBOL_PATTERNS = [
  /export\s+(?:async\s+)?function\s+(\w+)/g,
  /export\s+(?:default\s+)?class\s+(\w+)/g,
  /export\s+(?:const|let|var)\s+(\w+)/g,
  /export\s+interface\s+(\w+)/g,
  /export\s+type\s+(\w+)/g,
  /(?:async\s+)?function\s+(\w+)\s*\(/g,
  /class\s+(\w+)/g,
];

const DEFAULT_MAX_TOKENS = 8000;

/** Read a text file safely; skip binary/unreadable content. */
export function readFileSafe(filePath: string): string {
  try {
    const buf = fs.readFileSync(filePath);
    if (buf.length === 0 || buf.includes(0)) return '';
    return buf.toString('utf-8');
  } catch {
    return '';
  }
}

/** Extract function/class/type signatures from source code. */
export function extractSymbols(content: string, filePath: string): string[] {
  const symbols: string[] = [];
  const ext = path.extname(filePath);

  if (!['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go'].includes(ext)) {
    return symbols;
  }

  for (const pattern of SYMBOL_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const name = match[1];
      if (name && !symbols.includes(name)) {
        symbols.push(name);
      }
    }
  }

  return symbols;
}

/** Synchronously get git diff for a file. */
function getGitDiff(filePath: string, basePath: string): string {
  try {
    const gitDir = path.join(basePath, '.git');
    if (!fs.existsSync(gitDir)) return '';

    const rel = path.relative(basePath, filePath);
    return execSync(`git diff -- "${rel}"`, { cwd: basePath, encoding: 'utf-8', timeout: 5000 }).trim();
  } catch {
    return '';
  }
}

/** Build file/diff entries from a single path. */
function buildFileEntry(
  filePath: string,
  basePath: string,
  request: ContextScopeRequest
): { rel: string; fileEntry: string; diffEntry?: string; symbols: string[] } | null {
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(basePath, filePath);
  if (!fs.existsSync(resolved)) return null;

  const rel = path.relative(basePath, resolved);
  if (isExcludedContextPath(rel)) return null;

  const content = readFileSafe(resolved);
  if (!content) return null;

  const syms =
    request.includeSymbols !== false ? extractSymbols(content, resolved) : [];
  const diff =
    request.includeDiffs ? getGitDiff(resolved, basePath) : '';

  return {
    rel,
    fileEntry: `// ${rel}\n${content}`,
    diffEntry: diff ? `--- ${rel}\n${diff}` : undefined,
    symbols: syms,
  };
}

/** Build a ContextScope from the given request. */
export function buildContextScope(
  request: ContextScopeRequest
): ContextScope & { contextSummary?: ContextSummary } {
  const basePath = request.basePath || process.cwd();
  const maxTokens = request.maxTokens ?? DEFAULT_MAX_TOKENS;
  const files: string[] = [];
  const diffs: string[] = [];
  const symbols: string[] = [];
  const tierOrder: Array<{ rel: string; tier: ContextPriorityTier }> = [];

  const pathsToProcess: Array<{ path: string; tier: ContextPriorityTier }> =
    request.fileGroups
      ? request.fileGroups
          .slice()
          .sort((a, b) => a.tier - b.tier)
          .flatMap((g) => g.filePaths.map((p) => ({ path: p, tier: g.tier })))
      : (request.filePaths ?? []).map((p) => ({ path: p, tier: 4 as ContextPriorityTier }));

  for (const { path: filePath, tier } of pathsToProcess) {
    const entry = buildFileEntry(filePath, basePath, request);
    if (!entry) continue;

    files.push(entry.fileEntry);
    tierOrder.push({ rel: entry.rel, tier });
    if (entry.diffEntry) diffs.push(entry.diffEntry);
    for (const sym of entry.symbols) {
      if (!symbols.includes(sym)) symbols.push(sym);
    }
  }

  const scope: ContextScope = {
    files,
    diffs,
    symbols,
    maxTokens,
    sensitivityLevel: request.sensitivityLevel ?? 0,
  };

  const { scope: truncated, summary } = truncateToTokenBudgetWithSummary(scope, tierOrder);
  return { ...truncated, contextSummary: summary };
}

function extractRelFromFileBlock(fileBlock: string): string {
  const match = fileBlock.match(/^\/\/ (.+)$/m);
  return match?.[1] ?? 'unknown';
}

/** Truncate context to fit within the token budget. */
export function truncateToTokenBudget(scope: ContextScope): ContextScope {
  return truncateToTokenBudgetWithSummary(scope).scope;
}

/** Truncate with explicit summary; tier-1 files are truncated in-place, never dropped. */
export function truncateToTokenBudgetWithSummary(
  scope: ContextScope,
  tierOrder: Array<{ rel: string; tier: ContextPriorityTier }> = []
): { scope: ContextScope; summary: ContextSummary } {
  const budget = scope.maxTokens;
  let used = estimateTokens(scope.symbols.join('\n'));
  const included: string[] = [];
  const truncated: string[] = [];
  const dropped: string[] = [];

  const tierByRel = new Map(tierOrder.map((t) => [t.rel, t.tier]));

  const truncatedFiles: string[] = [];
  for (const file of scope.files) {
    const rel = extractRelFromFileBlock(file);
    const tier = tierByRel.get(rel) ?? 4;
    const tokens = estimateTokens(file);

    if (used + tokens > budget) {
      const remaining = (budget - used) * 4;
      const mustKeep = tier <= 3;
      const shouldTruncate = mustKeep
        ? remaining > 0
        : remaining > 100 && truncatedFiles.length === 0;

      if (shouldTruncate) {
        truncatedFiles.push(file.slice(0, remaining) + '\n// ... truncated');
        truncated.push(rel);
        included.push(rel);
        used = budget;
      } else {
        dropped.push(rel);
      }

      if (tier >= 4 && truncatedFiles.length > 0) break;
      continue;
    }
    truncatedFiles.push(file);
    included.push(rel);
    used += tokens;
  }

  const truncatedDiffs: string[] = [];
  for (const diff of scope.diffs) {
    const tokens = estimateTokens(diff);
    if (used + tokens > budget) {
      const rel = diff.match(/^--- (.+)$/m)?.[1];
      if (rel) dropped.push(`${rel} (diff)`);
      continue;
    }
    truncatedDiffs.push(diff);
    used += tokens;
  }

  return {
    scope: { ...scope, files: truncatedFiles, diffs: truncatedDiffs },
    summary: { included, truncated, dropped, tokenBudgetUsed: used },
  };
}

/** Count total tokens in a ContextScope. */
export function countScopeTokens(scope: ContextScope): number {
  return (
    estimateTokens(scope.files.join('\n')) +
    estimateTokens(scope.diffs.join('\n')) +
    estimateTokens(scope.symbols.join('\n'))
  );
}

/** Canonical JSON for content-addressable hashing. */
export function canonicalizeScope(scope: ContextScope): string {
  return JSON.stringify({
    files: scope.files,
    diffs: scope.diffs,
    symbols: scope.symbols,
    maxTokens: scope.maxTokens,
    sensitivityLevel: scope.sensitivityLevel,
  });
}

/** Full SHA-256 hash of canonicalized scope. */
export function hashContextFull(scope: ContextScope): string {
  return crypto.createHash('sha256').update(canonicalizeScope(scope)).digest('hex');
}

/** Hash a ContextScope for audit logging (short display hash). */
export function hashContext(scope: ContextScope): string {
  return hashContextFull(scope).slice(0, 16);
}

/** Classify sensitivity based on file paths and content patterns. */
export function classifySensitivity(filePaths: string[], basePath?: string): number {
  const sensitivePatterns = [
    /\.env/,
    /secret/i,
    /credential/i,
    /private/i,
    /key\.pem/,
    /\.ssh\//,
  ];

  let level = 0;
  const base = basePath || process.cwd();

  for (const filePath of filePaths) {
    const resolved = path.isAbsolute(filePath) ? filePath : path.join(base, filePath);
    const rel = path.relative(base, resolved);

    for (const pattern of sensitivePatterns) {
      if (pattern.test(rel)) {
        level = Math.max(level, 2);
      }
    }

    // Excluded paths are not shipped to agents; skip content scan only.
    if (isExcludedContextPath(rel)) continue;

    const content = readFileSafe(resolved);
    if (content && scanForSecrets(content, rel).length > 0) {
      level = Math.max(level, 3);
    }
  }

  return Math.min(level, 3) as 0 | 1 | 2 | 3;
}