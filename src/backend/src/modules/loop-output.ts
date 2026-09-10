import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import type { WorkItem } from '../types';
import type { EvalResult } from './eval-harness';
import { resolveWorkItemOutputDir, resolveWorkItemWorkDir, hasLinkedRepository } from './work-item-context';
import { logWorkItemActivity } from './work-item-activity';

const GIT_TIMEOUT_MS = 15_000;
const DIFF_PREVIEW_CHARS = 8_000;

export interface GitDiffSnapshot {
  repoRoot: string;
  hasRepo: boolean;
  dirty: boolean;
  stat: string;
  diffPreview: string;
  changedFiles: string[];
}

function git(repoRoot: string, args: string[]): string {
  return execFileSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf-8',
    timeout: GIT_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString();
}

function resolveGitRoot(start: string): string | null {
  if (!start || !fs.existsSync(start)) return null;
  try {
    const top = git(start, ['rev-parse', '--show-toplevel']).trim();
    return top || null;
  } catch {
    return null;
  }
}

/** Capture `git status` / `git diff` for a work item or directory. */
export function collectGitDiff(root?: string): GitDiffSnapshot {
  const repoRoot = root ? resolveGitRoot(root) : null;
  if (!repoRoot) {
    return {
      repoRoot: root ?? '',
      hasRepo: false,
      dirty: false,
      stat: '',
      diffPreview: '',
      changedFiles: [],
    };
  }

  let stat = '';
  let diff = '';
  let nameOnly = '';
  try {
    stat = git(repoRoot, ['diff', '--stat', 'HEAD']).trim();
    nameOnly = git(repoRoot, ['diff', '--name-only', 'HEAD']).trim();
    diff = git(repoRoot, ['diff', 'HEAD']).trim();
  } catch {
    /* unborn HEAD or empty repo */
  }

  if (!stat && !nameOnly) {
    try {
      const porcelain = git(repoRoot, ['status', '--porcelain']).trim();
      if (porcelain) {
        nameOnly = porcelain
          .split('\n')
          .map((line) => line.slice(3).trim())
          .filter(Boolean)
          .join('\n');
        stat = porcelain;
      }
    } catch {
      /* ignore */
    }
  }

  const changedFiles = nameOnly ? nameOnly.split('\n').map((l) => l.trim()).filter(Boolean) : [];
  return {
    repoRoot,
    hasRepo: true,
    dirty: changedFiles.length > 0 || Boolean(stat),
    stat,
    diffPreview: diff.slice(0, DIFF_PREVIEW_CHARS),
    changedFiles,
  };
}

export interface LoopOutputArtifact {
  outputPath: string;
  diff: GitDiffSnapshot;
  prUrl?: string;
}

function writeArtifact(outputDir: string, item: WorkItem, diff: GitDiffSnapshot, evals?: EvalResult[]): string {
  const lines = [
    `# Loop output — ${item.key}`,
    '',
    `Title: ${item.title}`,
    `Status: ${item.status} / ${item.loopStatus}`,
    '',
    '## Git diff',
  ];
  if (!diff.hasRepo) {
    lines.push('No git repository at the work item root.');
  } else if (!diff.dirty) {
    lines.push(`Repo: ${diff.repoRoot}`, 'Working tree clean (no diff vs HEAD).');
  } else {
    lines.push(`Repo: ${diff.repoRoot}`, '', '### Stat', '```', diff.stat || '(no --stat output)', '```');
    if (diff.changedFiles.length) {
      lines.push('', '### Files', ...diff.changedFiles.map((f) => `- ${f}`));
    }
    if (diff.diffPreview) {
      lines.push('', '### Diff (truncated)', '```diff', diff.diffPreview, '```');
    }
  }

  if (evals && evals.length > 0) {
    lines.push('', '## Evals');
    for (const ev of evals) {
      lines.push(`- ${ev.passed ? 'PASS' : 'FAIL'} ${ev.evalId} (${ev.type}): ${ev.details}`);
    }
  }

  const outputPath = path.join(outputDir, 'LOOP_OUTPUT.md');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPath, `${lines.join('\n')}\n`, 'utf-8');
  return outputPath;
}

function maybeCreatePullRequest(item: WorkItem, diff: GitDiffSnapshot): string | undefined {
  if (process.env.CREWTOPUS_CREATE_PR !== 'true' && process.env.AGENTHUB_CREATE_PR !== 'true') {
    return undefined;
  }
  if (!diff.hasRepo || !diff.dirty) return undefined;

  try {
    const title = `${item.key}: ${item.title}`.slice(0, 80);
    const body = `Automated Crewtopus loop output for ${item.key}.\n`;
    const stdout = execFileSync(
      'gh',
      ['pr', 'create', '--title', title, '--body', body],
      {
        cwd: diff.repoRoot,
        encoding: 'utf-8',
        timeout: 30_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    ).toString();
    const url = stdout.trim().split('\n').filter(Boolean).at(-1);
    return url;
  } catch {
    return undefined;
  }
}

/** Persist git diff (and optional PR) after a successful implement/review loop. */
export function publishLoopOutput(
  item: WorkItem,
  evals?: EvalResult[]
): LoopOutputArtifact | null {
  const repoRoot = hasLinkedRepository(item) ? resolveWorkItemWorkDir(item) : resolveWorkItemWorkDir(item);
  const diff = collectGitDiff(repoRoot);
  const outputDir = resolveWorkItemOutputDir(item);
  const outputPath = writeArtifact(outputDir, item, diff, evals);
  const prUrl = maybeCreatePullRequest(item, diff);

  logWorkItemActivity({
    workItemId: item.id,
    activityType: 'comment',
    summary: prUrl
      ? `Loop output published (${diff.changedFiles.length} file(s)) — PR ${prUrl}`
      : diff.dirty
        ? `Loop output published: ${diff.changedFiles.length} changed file(s) in ${path.basename(outputPath)}`
        : `Loop output published: working tree clean (${path.basename(outputPath)})`,
    metadata: {
      event: 'loop_output_published',
      outputPath,
      changedFiles: diff.changedFiles.slice(0, 40),
      dirty: diff.dirty,
      hasRepo: diff.hasRepo,
      prUrl,
    },
  });

  return { outputPath, diff, prUrl };
}
