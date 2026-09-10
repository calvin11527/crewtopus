import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import type { ContextScope, WorkItem } from '../types';
import {
  buildContextScope,
  classifySensitivity,
  type ContextFileGroup,
  type ContextSummary,
} from './context-scope';
import { scanForSecrets } from './privacy-guard';
import {
  CONTEXT_DIR_EXCLUSIONS,
  isExcludedContextFilename,
  isExcludedContextPath,
} from './context-path-filters';
import { getWorkspace, listRepositories, getPrimaryRepository } from './workspace';
import { resolveWorkDir } from './work-items';
import { resolveWithinRoot } from '../utils/safe-path';

export { isExcludedContextPath } from './context-path-filters';

const DEFAULT_CONTEXT_GLOBS = ['*.ts', '*.tsx', '*.js', '*.jsx', '*.py', '*.go', '*.rs', '*.md', '*.json'];
const DEFAULT_MAX_REPO_FILES = 30;
const MAX_WALK_DEPTH = 6;
const MAX_GIT_CHANGED_FILES = 40;
const MAX_AC_LINKED_FILES = 24;
const MAX_WORKDIR_FILES = 80;

/** Parse .agenthubignore (gitignore-style) from a repo root. */
export function parseAgenthubIgnore(repoRoot: string): string[] {
  const ignorePath = path.join(repoRoot, '.agenthubignore');
  if (!fs.existsSync(ignorePath)) return [];
  return fs
    .readFileSync(ignorePath, 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

/** Simple glob match for ignore patterns. */
export function matchesIgnorePattern(relPath: string, pattern: string): boolean {
  if (pattern.endsWith('/')) return relPath.startsWith(pattern.slice(0, -1));
  if (pattern.startsWith('*.')) return relPath.endsWith(pattern.slice(1));
  if (pattern.includes('*')) {
    // Escape all regex metacharacters except *, then map * → [^/]* (no ReDoS-prone .*)
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
    const regex = new RegExp('^' + escaped + '$');
    return regex.test(relPath);
  }
  return relPath === pattern || relPath.endsWith('/' + pattern);
}

/** Check if a relative path is excluded by .agenthubignore. */
export function isAgenthubIgnored(relPath: string, ignorePatterns: string[]): boolean {
  return ignorePatterns.some((p) => matchesIgnorePattern(relPath, p));
}

/** Match simple glob patterns (e.g. star.ts, star-star-slash-star.md). */
export function matchContextGlob(filename: string, pattern: string): boolean {
  if (pattern.startsWith('**/*')) return filename.endsWith(pattern.slice(4));
  if (pattern.startsWith('*.')) return filename.endsWith(pattern.slice(1));
  return filename === pattern;
}

/** Recursively collect files under a directory matching glob patterns. */
export function collectRepoContextFiles(
  rootDir: string,
  patterns: string[] = DEFAULT_CONTEXT_GLOBS,
  maxFiles = DEFAULT_MAX_REPO_FILES,
  depth = 0
): string[] {
  if (depth > MAX_WALK_DEPTH || !fs.existsSync(rootDir)) return [];

  const results: string[] = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory() && CONTEXT_DIR_EXCLUSIONS.has(entry.name)) continue;
    if (!entry.isDirectory() && isExcludedContextFilename(entry.name)) continue;

    if (entry.name.includes('..') || entry.name.includes('/') || entry.name.includes('\\')) continue;
    let full: string;
    try {
      full = resolveWithinRoot(rootDir, entry.name);
    } catch {
      continue;
    }
    if (entry.isDirectory()) {
      results.push(...collectRepoContextFiles(full, patterns, maxFiles - results.length, depth + 1));
    } else if (patterns.some((p) => matchContextGlob(entry.name, p))) {
      results.push(full);
    }
    if (results.length >= maxFiles) break;
  }

  return results;
}

/** List absolute paths of files in a work directory (recursive, capped). */
export function listWorkDirFilePaths(workDir?: string, depth = 0, maxFiles = MAX_WORKDIR_FILES): string[] {
  if (!workDir || !fs.existsSync(workDir) || depth > MAX_WALK_DEPTH) return [];
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(workDir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (out.length >= maxFiles) break;
    if (entry.name.startsWith('._')) continue;
    if (entry.name.includes('..') || entry.name.includes('/') || entry.name.includes('\\')) continue;
    if (isExcludedContextFilename(entry.name)) continue;
    let full: string;
    try {
      full = resolveWithinRoot(workDir, entry.name);
    } catch {
      continue;
    }
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || CONTEXT_DIR_EXCLUSIONS.has(entry.name)) continue;
      out.push(...listWorkDirFilePaths(full, depth + 1, maxFiles - out.length));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function gitNameOnly(repoRoot: string, args: string[]): string[] {
  try {
    const out = execFileSync('git', ['-C', repoRoot, ...args], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString();
    return out
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function resolveRepoFile(repoRoot: string, rel: string): string | null {
  const parts = rel.split(/[/\\]/).filter((p) => p && p !== '.' && p !== '..');
  if (parts.length === 0) return null;
  try {
    const full = resolveWithinRoot(repoRoot, ...parts);
    if (fs.existsSync(full) && fs.statSync(full).isFile() && !isExcludedContextPath(full)) {
      return full;
    }
  } catch {
    /* skip */
  }
  return null;
}

/** Changed / untracked files in a git working tree (absolute paths). */
export function collectGitChangedFiles(repoRoot: string, maxFiles = MAX_GIT_CHANGED_FILES): string[] {
  if (!repoRoot || !fs.existsSync(path.join(repoRoot, '.git'))) return [];
  const names = new Set<string>([
    ...gitNameOnly(repoRoot, ['diff', '--name-only', 'HEAD']),
    ...gitNameOnly(repoRoot, ['diff', '--name-only', '--cached']),
    ...gitNameOnly(repoRoot, ['ls-files', '--others', '--exclude-standard']),
  ]);
  const out: string[] = [];
  for (const rel of names) {
    if (out.length >= maxFiles) break;
    const full = resolveRepoFile(repoRoot, rel);
    if (full) out.push(full);
  }
  return out;
}

/** File-like tokens from title, description, and acceptance criteria. */
export function extractContextFileHints(text: string): string[] {
  const hints = new Set<string>();
  for (const match of text.matchAll(/`([^`]+)`/g)) {
    const value = match[1].trim();
    if (value.includes('.') || value.includes('/') || value.includes('\\')) hints.add(value);
  }
  for (const match of text.matchAll(/\b[\w./-]{1,80}\.[a-z][a-z0-9]{0,5}\b/gi)) {
    hints.add(match[0]);
  }
  for (const word of text.split(/[^A-Za-z0-9]+/)) {
    if (word.length < 3 || word.length > 64) continue;
    if (word[0] < 'A' || word[0] > 'Z') continue;
    if (!/[a-z]/.test(word) || !/[a-z][A-Z]/.test(word)) continue;
    hints.add(word);
  }
  return [...hints];
}

/** Files named or pathed in the work item, even when they sit deeper than the repo walk. */
export function collectAcLinkedFiles(
  workItem: WorkItem,
  repoRoot: string,
  maxFiles = MAX_AC_LINKED_FILES
): string[] {
  if (!repoRoot || !fs.existsSync(repoRoot)) return [];
  const blob = [workItem.title, workItem.description ?? '', ...(workItem.acceptanceCriteria ?? [])].join('\n');
  const hints = extractContextFileHints(blob);
  if (hints.length === 0) return [];

  const found: string[] = [];
  const seen = new Set<string>();
  const remember = (full: string | null) => {
    if (!full || seen.has(full) || found.length >= maxFiles) return;
    seen.add(full);
    found.push(full);
  };

  for (const hint of hints) {
    remember(resolveRepoFile(repoRoot, hint.replace(/^[./]+/, '')));
    if (found.length >= maxFiles) return found;
  }

  const basenames = new Set(hints.map((hint) => path.basename(hint).toLowerCase()));
  const indexed = gitNameOnly(repoRoot, ['ls-files']);
  const candidates =
    indexed.length > 0
      ? indexed
      : collectRepoContextFiles(repoRoot, DEFAULT_CONTEXT_GLOBS, 250).map((file) =>
          path.relative(repoRoot, file)
        );

  for (const rel of candidates) {
    if (found.length >= maxFiles) break;
    const base = path.basename(rel).toLowerCase();
    const stem = base.replace(/\.[^.]+$/, '');
    if (!basenames.has(base) && !basenames.has(stem)) continue;
    remember(resolveRepoFile(repoRoot, rel));
  }

  return found;
}

/**
 * Repo or scratch root used for context resolution (read-only scope).
 * Workspace-linked items use the primary project folder; otherwise work-dir fallback.
 */
/**
 * Working root for a work item: linked repo path when available, otherwise AGENTHUB_WORK_DIR.
 */
export function resolveWorkItemWorkDir(workItem: WorkItem): string {
  if (workItem.workspaceId) {
    const primaryRepo = getPrimaryRepository(workItem.workspaceId);
    if (primaryRepo && fs.existsSync(primaryRepo.path)) {
      return primaryRepo.path;
    }
  }
  return resolveWorkDir();
}

/** True when the work item has a linked workspace repository on disk. */
export function hasLinkedRepository(workItem: WorkItem): boolean {
  if (!workItem.workspaceId) return false;
  const primaryRepo = getPrimaryRepository(workItem.workspaceId);
  return Boolean(primaryRepo && fs.existsSync(primaryRepo.path));
}

/**
 * Directory where agents write output files for a work item.
 * Keeps artifacts under .agenthub-work/{KEY}/ inside the repo or work root.
 * Always returns a usable path (creates dirs as needed).
 */
export function resolveWorkItemOutputDir(workItem: WorkItem): string {
  const base = resolveWorkItemWorkDir(workItem);
  const outputDir = path.join(base, '.agenthub-work', workItem.key);
  fs.mkdirSync(outputDir, { recursive: true });
  return outputDir;
}

export interface WorkItemDeliverable {
  name: string;
  path: string;
  size: number;
  modifiedAt: string;
}

/** List files the agent wrote for this work item (under `.agenthub-work/{KEY}/`). */
export function listWorkItemDeliverables(workItem: WorkItem): {
  outputDir: string | null;
  files: WorkItemDeliverable[];
} {
  const outputDir = resolveWorkItemOutputDir(workItem);
  if (!outputDir || !fs.existsSync(outputDir)) {
    return { outputDir: outputDir ?? null, files: [] };
  }

  const files = fs
    .readdirSync(outputDir)
    .filter((name) => !name.startsWith('.') && !name.startsWith('._'))
    .filter((name) => fs.statSync(path.join(outputDir, name)).isFile())
    .map((name) => {
      const full = path.join(outputDir, name);
      const st = fs.statSync(full);
      return {
        name,
        path: full,
        size: st.size,
        modifiedAt: st.mtime.toISOString(),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return { outputDir, files };
}

/**
 * Resolve file paths for a work item: work-dir files plus optional workspace repo context.
 */
export function resolveWorkItemContextPaths(
  workItem: WorkItem,
  workDir?: string
): { filePaths: string[]; basePath: string } {
  const paths = new Set<string>();
  const explicitWorkDir = workDir !== undefined;
  const focusedWorkDir = workDir ?? resolveWorkItemWorkDir(workItem);
  let basePath = focusedWorkDir || process.cwd();

  for (const filePath of listWorkDirFilePaths(focusedWorkDir)) {
    paths.add(filePath);
  }

  if (workItem.workspaceId) {
    const workspace = getWorkspace(workItem.workspaceId);
    if (workspace) {
      const globs = Array.isArray(workspace.config.contextGlobs)
        ? (workspace.config.contextGlobs as string[])
        : DEFAULT_CONTEXT_GLOBS;
      const maxFiles =
        typeof workspace.config.contextMaxFiles === 'number'
          ? workspace.config.contextMaxFiles
          : DEFAULT_MAX_REPO_FILES;

      const repos = listRepositories(workItem.workspaceId);
      const primaryRepo = getPrimaryRepository(workItem.workspaceId);

      for (const repo of repos) {
        if (!fs.existsSync(repo.path)) continue;
        for (const filePath of collectRepoContextFiles(repo.path, globs, maxFiles)) {
          paths.add(filePath);
        }
      }

      if (!explicitWorkDir) {
        if (primaryRepo && fs.existsSync(primaryRepo.path)) {
          basePath = primaryRepo.path;
        } else if (repos.length > 0 && fs.existsSync(repos[0].path)) {
          basePath = repos[0].path;
        }
      }
    }
  }

  return { filePaths: Array.from(paths), basePath };
}

/** Files in work-dir modified at or after a reference timestamp (loop context delta). */
export function listWorkDirDeltaFiles(workDir: string, sinceMs: number): string[] {
  return listWorkDirFilePaths(workDir).filter((filePath) => {
    try {
      return fs.statSync(filePath).mtimeMs >= sinceMs;
    } catch {
      return false;
    }
  });
}

function uniquePaths(paths: string[], seen: Set<string>): string[] {
  const out: string[] = [];
  for (const filePath of paths) {
    if (seen.has(filePath)) continue;
    seen.add(filePath);
    out.push(filePath);
  }
  return out;
}

/** Build priority-ordered file groups for a work item context. */
export function buildWorkItemContextGroups(
  workItem: WorkItem,
  workDir?: string,
  options: { loopIteration?: number; deltaSinceMs?: number } = {}
): { groups: ContextFileGroup[]; basePath: string } {
  const resolvedWorkDir = workDir || resolveWorkItemOutputDir(workItem);
  const workDirPaths = listWorkDirFilePaths(resolvedWorkDir);
  const { filePaths, basePath } = resolveWorkItemContextPaths(workItem, workDir || undefined);
  const workDirSet = new Set(workDirPaths);
  const repoPaths = filePaths.filter((p) => !workDirSet.has(p));

  let ignorePatterns: string[] = [];
  if (workItem.workspaceId) {
    const repos = listRepositories(workItem.workspaceId);
    for (const repo of repos) {
      ignorePatterns.push(...parseAgenthubIgnore(repo.path));
    }
  }

  const filteredRepo = repoPaths.filter((p) => {
    const rel = path.isAbsolute(p) ? path.relative(basePath, p) : p;
    return !isAgenthubIgnored(rel, ignorePatterns);
  });

  const gitChanged = collectGitChangedFiles(basePath).filter((p) => {
    const rel = path.isAbsolute(p) ? path.relative(basePath, p) : p;
    return !isAgenthubIgnored(rel, ignorePatterns);
  });
  const acLinked = collectAcLinkedFiles(workItem, basePath).filter((p) => {
    const rel = path.isAbsolute(p) ? path.relative(basePath, p) : p;
    return !isAgenthubIgnored(rel, ignorePatterns);
  });

  const loopIteration = options.loopIteration ?? 0;
  const repoCap = loopIteration > 1 ? 5 : DEFAULT_MAX_REPO_FILES;
  const seen = new Set<string>();

  const artifactPaths = uniquePaths(workDirPaths, seen);
  let deltaPaths: string[] = [];
  if (options.deltaSinceMs != null && resolvedWorkDir) {
    const deltaSet = new Set(listWorkDirDeltaFiles(resolvedWorkDir, options.deltaSinceMs));
    deltaPaths = uniquePaths(
      artifactPaths.filter((p) => deltaSet.has(p)),
      new Set()
    );
  }
  const gitPaths = uniquePaths(gitChanged, seen);
  const acPaths = uniquePaths(acLinked, seen);
  const residualRepo = uniquePaths(filteredRepo, seen).slice(0, repoCap);

  const groups: ContextFileGroup[] = [];
  if (deltaPaths.length > 0) {
    groups.push({ tier: 1, label: 'work-dir-delta', filePaths: deltaPaths });
    groups.push({
      tier: 1,
      label: 'artifacts',
      filePaths: artifactPaths.filter((p) => !deltaPaths.includes(p)),
    });
  } else {
    groups.push({ tier: 1, label: 'artifacts', filePaths: artifactPaths });
  }
  groups.push({ tier: 2, label: 'git-changed', filePaths: gitPaths });
  groups.push({ tier: 2, label: 'ac-linked', filePaths: acPaths });
  groups.push({ tier: loopIteration > 1 ? 4 : 3, label: 'repo', filePaths: residualRepo });

  return { groups, basePath };
}

/** Pre-scan work-dir files for secrets before scope assembly. */
export function scanWorkDirSecrets(workDir?: string): string[] {
  const issues: string[] = [];
  for (const filePath of listWorkDirFilePaths(workDir)) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const rel = path.basename(filePath);
    const matches = scanForSecrets(content, rel);
    if (matches.length > 0) {
      issues.push(`${rel}: ${matches.length} secret(s) detected`);
    }
  }
  return issues;
}

/** Read truncated excerpts from work-dir files for fix prompts. */
export function buildWorkDirExcerpts(
  workDir: string,
  fileNames: string[],
  maxCharsPerFile = 1500,
  maxFiles = 3
): string {
  const excerpts: string[] = [];
  for (const name of fileNames.slice(0, maxFiles)) {
    if (name.includes('..') || name.includes('/') || name.includes('\\')) continue;
    let filePath: string;
    try {
      filePath = resolveWithinRoot(workDir, name);
    } catch {
      continue;
    }
    if (!fs.existsSync(filePath)) continue;
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const truncated =
        content.length > maxCharsPerFile
          ? content.slice(0, maxCharsPerFile) + '\n// ... truncated'
          : content;
      excerpts.push(`### ${name}\n${truncated}`);
    } catch {
      /* skip unreadable */
    }
  }
  return excerpts.length > 0 ? `\n## Current file contents\n${excerpts.join('\n\n')}` : '';
}

/** Build a ContextScope for a work item, refreshing file/diff content each call. */
export function buildWorkItemContextScope(
  workItem: WorkItem,
  workDir?: string,
  options: {
    maxTokens?: number;
    includeDiffs?: boolean;
    loopIteration?: number;
    deltaSinceMs?: number;
  } = {}
): {
  scope: ContextScope;
  filePaths: string[];
  basePath: string;
  auditFilePaths: string[];
  contextSummary?: ContextSummary;
  workDirSecretIssues?: string[];
} {
  const resolvedWorkDir = workDir || resolveWorkItemOutputDir(workItem);
  const workDirSecretIssues = scanWorkDirSecrets(resolvedWorkDir);

  const { groups, basePath } = buildWorkItemContextGroups(workItem, workDir || undefined, {
    loopIteration: options.loopIteration,
    deltaSinceMs: options.deltaSinceMs,
  });
  const allPaths = groups.flatMap((g) => g.filePaths);
  let sensitivity = classifySensitivity(allPaths, basePath);
  if (workDirSecretIssues.length > 0) {
    sensitivity = Math.max(sensitivity, 3) as typeof sensitivity;
  }

  const built = buildContextScope({
    fileGroups: groups,
    basePath,
    includeDiffs: options.includeDiffs ?? true,
    includeSymbols: true,
    maxTokens: options.maxTokens,
    sensitivityLevel: sensitivity,
  });

  const { contextSummary, ...scope } = built;

  const auditFilePaths = allPaths.map((f) => {
    try {
      return path.isAbsolute(f) ? path.relative(basePath, f) : f;
    } catch {
      return f;
    }
  });

  return {
    scope,
    filePaths: allPaths,
    basePath,
    auditFilePaths,
    contextSummary,
    workDirSecretIssues: workDirSecretIssues.length > 0 ? workDirSecretIssues : undefined,
  };
}