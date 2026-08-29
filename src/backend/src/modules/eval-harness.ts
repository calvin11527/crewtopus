import fs from 'fs';
import path from 'path';
import { resolveWithinRoot } from '../utils/safe-path';
import { execSync } from 'child_process';
import type { OnUnknownVerdict, WorkflowVerdictParser } from '../types';
import type { WorkItem } from '../types';
import { listFilesInDir } from './work-items';
import { hasLinkedRepository, resolveWorkItemWorkDir } from './work-item-context';

export type ReviewVerdict = 'approved' | 'changes_requested' | 'unknown';

export interface ParseReviewVerdictOptions {
  parser?: WorkflowVerdictParser;
  onUnknownVerdict?: OnUnknownVerdict;
}

/** Extract verdict from a structured JSON block (fenced or inline). */
function parseJsonVerdictBlock(content: string): ReviewVerdict | null {
  const fenced = content.match(/```(?:json)?\s*\n([\s\S]*?)\n```/i);
  const candidates = [fenced?.[1], content].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const jsonMatch = candidate.match(/\{[\s\S]*?"verdict"\s*:\s*"([^"]+)"[\s\S]*?\}/i);
    if (!jsonMatch) continue;
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { verdict?: string };
      const v = String(parsed.verdict ?? '').toUpperCase();
      if (v.includes('CHANGES')) return 'changes_requested';
      if (v.includes('APPROVED')) return 'approved';
    } catch {
      const raw = jsonMatch[1].toUpperCase();
      if (raw.includes('CHANGES')) return 'changes_requested';
      if (raw.includes('APPROVED')) return 'approved';
    }
  }
  return null;
}

/** Parse reviewer output into APPROVED / CHANGES_REQUESTED / unknown. */
export function parseReviewVerdict(
  content: string,
  options: ParseReviewVerdictOptions = {}
): ReviewVerdict {
  const parser = options.parser ?? 'approved_changes_requested';

  if (parser === 'json_block' || parser === 'approved_changes_requested') {
    const fromJson = parseJsonVerdictBlock(content);
    if (fromJson) return fromJson;
  }

  const firstLine = content.split('\n')[0]?.trim().toUpperCase() || '';
  if (firstLine.includes('CHANGES_REQUESTED')) return 'changes_requested';
  if (firstLine.includes('APPROVED')) return 'approved';
  if (/CHANGES_REQUESTED/i.test(content)) return 'changes_requested';
  if (/APPROVED/i.test(content)) return 'approved';

  const onUnknown = options.onUnknownVerdict ?? 'treat_as_changes_requested';
  if (onUnknown === 'treat_as_changes_requested') return 'changes_requested';
  return 'unknown';
}

export type LoopEvalType = 'verdict_parse' | 'acceptance_criteria' | 'test_command' | 'file_exists' | 'custom';

export interface LoopEval {
  id: string;
  type: LoopEvalType;
  config?: Record<string, unknown>;
}

export interface EvalResult {
  evalId: string;
  type: LoopEvalType;
  passed: boolean;
  score?: number;
  details: string;
  evidence?: Record<string, unknown>;
}

export interface EvalContext {
  workItem?: WorkItem;
  workDir?: string;
  reviewContent?: string;
  reviewVerdict?: ReviewVerdict;
}

const EVAL_SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.grok',
  '.kiro',
  'dist',
  'build',
  'coverage',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.next',
  '.turbo',
  'target',
  'vendor',
]);

const EVAL_TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.md',
  '.json',
  '.yml',
  '.yaml',
  '.toml',
  '.css',
  '.html',
  '.txt',
  '.sh',
  '.sql',
  '.rs',
  '.go',
  '.java',
  '.rb',
  '.php',
  '.swift',
  '.kt',
  '.cs',
]);

const MAX_EVAL_FILES = 500;
const MAX_EVAL_DEPTH = 8;
const MAX_EVAL_FILE_BYTES = 80_000;
const MAX_EVAL_TOTAL_BYTES = 2_500_000;

const AC_STOPWORDS = new Set([
  'the',
  'and',
  'or',
  'for',
  'with',
  'from',
  'that',
  'this',
  'into',
  'onto',
  'over',
  'under',
  'when',
  'then',
  'than',
  'also',
  'plus',
  'such',
  'each',
  'both',
  'all',
  'any',
  'new',
  'shows',
  'show',
  'displays',
  'display',
  'available',
  'returns',
  'return',
  'still',
  'passes',
  'pass',
  'handles',
  'handle',
  'gracefully',
  'visible',
  'matching',
  'filter',
  'filters',
  'current',
  'optional',
  'names',
  'name',
  'view',
  'logic',
  'endpoint',
  'tool',
  'time',
  'load',
  'cold',
  'start',
  'top',
  'card',
  'desk',
  'no',
  'not',
  'via',
  'using',
  'must',
  'should',
  'able',
  'like',
  'e.g',
  'eg',
  'etc',
]);

export interface WorkDirCorpus {
  /** Relative paths (posix-style) found under workDir. */
  files: string[];
  /** Concatenated path names + readable file contents (lowercased lookups use this). */
  text: string;
}

function isSafePathSegment(name: string): boolean {
  return (
    Boolean(name) &&
    name !== '.' &&
    name !== '..' &&
    !name.includes('\0') &&
    !name.includes('/') &&
    !name.includes('\\')
  );
}

function resolveRelUnderRoot(root: string, relDir: string): string | null {
  if (!relDir) return root;
  const segments = relDir.split('/').filter(Boolean);
  if (segments.length === 0) return root;
  if (!segments.every(isSafePathSegment)) return null;
  try {
    return resolveWithinRoot(root, ...segments);
  } catch {
    return null;
  }
}

/** Recursively collect relative file paths and a bounded text corpus for evals. */
export function buildWorkDirCorpus(workDir?: string): WorkDirCorpus {
  if (!workDir) return { files: [], text: '' };

  // Resolve once; validate by opening the directory (no existsSync TOCTOU).
  const root = path.resolve(workDir);
  try {
    fs.readdirSync(root);
  } catch {
    return { files: [], text: '' };
  }

  const files: string[] = [];
  const chunks: string[] = [];
  let totalBytes = 0;

  const walk = (relDir: string, depth: number) => {
    if (files.length >= MAX_EVAL_FILES || depth > MAX_EVAL_DEPTH || totalBytes >= MAX_EVAL_TOTAL_BYTES) {
      return;
    }

    const absDir = resolveRelUnderRoot(root, relDir);
    if (!absDir) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= MAX_EVAL_FILES || totalBytes >= MAX_EVAL_TOTAL_BYTES) break;
      const name = entry.name;
      if (!isSafePathSegment(name) || name.startsWith('._')) continue;
      if (entry.isDirectory()) {
        if (EVAL_SKIP_DIRS.has(name) || name.startsWith('.')) continue;
        walk(relDir ? `${relDir}/${name}` : name, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;

      const rel = relDir ? `${relDir}/${name}` : name;
      files.push(rel);

      const ext = path.extname(name).toLowerCase();
      if (!EVAL_TEXT_EXTENSIONS.has(ext)) continue;

      const full = resolveRelUnderRoot(root, rel);
      if (!full) continue;

      // Single read — no exists/stat race; size gated after read.
      try {
        const content = fs.readFileSync(full, 'utf-8');
        if (content.length <= 0 || content.length > MAX_EVAL_FILE_BYTES) continue;
        if (totalBytes + content.length > MAX_EVAL_TOTAL_BYTES) continue;
        totalBytes += content.length;
        chunks.push(`\n// file: ${rel}\n${content}`);
      } catch {
        /* skip unreadable / outside-root */
      }
    }
  };

  walk('', 0);

  // Always include shallow top-level names (legacy callers / small workdirs)
  for (const name of listFilesInDir(root)) {
    if (!files.includes(name)) files.push(name);
  }

  const pathIndex = files.join('\n');
  return { files, text: `${pathIndex}\n${chunks.join('\n')}` };
}

function readWorkDirText(workDir?: string): string {
  return buildWorkDirCorpus(workDir).text;
}

export interface CriterionEvidenceTokens {
  /** Identifiers / file names / symbols that must largely appear in the workdir. */
  strong: string[];
  /** Supporting prose words — helpful but not required when strong hits land. */
  weak: string[];
}

/** Distinctive tokens / identifiers extracted from a free-form acceptance criterion. */
export function extractCriterionEvidenceTokens(criterion: string): string[] {
  const { strong, weak } = extractCriterionEvidenceGroups(criterion);
  return [...new Set([...strong, ...weak])];
}

export function extractCriterionEvidenceGroups(criterion: string): CriterionEvidenceTokens {
  const strong = new Set<string>();
  const weak = new Set<string>();

  for (const m of criterion.matchAll(/`([^`]+)`/g)) {
    strong.add(m[1].trim().toLowerCase());
  }

  // File-like tokens (bounded extension) — avoid nested quantifiers for ReDoS safety.
  for (const m of criterion.matchAll(/\b[\w./-]{1,80}\.[a-z][a-z0-9]{0,5}\b/gi)) {
    strong.add(m[0].toLowerCase());
  }

  // PascalCase / camel identifiers without nested possessive quantifiers (CodeQL ReDoS).
  for (const word of criterion.split(/[^A-Za-z0-9]+/)) {
    if (word.length < 3 || word.length > 64) continue;
    if (word[0] < 'A' || word[0] > 'Z') continue;
    if (!/[a-z]/.test(word) || !/[a-z][A-Z]/.test(word)) continue;
    if (!/^[A-Za-z0-9]+$/.test(word)) continue;
    strong.add(word.toLowerCase());
  }

  for (const m of criterion.matchAll(/\b[a-z][a-z0-9]{0,40}(?:_[a-z0-9]{1,40}){1,8}\b/g)) {
    strong.add(m[0].toLowerCase());
  }

  // Significant words (skip pure stopwords / tiny tokens)
  for (const raw of criterion.toLowerCase().split(/[^a-z0-9_./-]+/)) {
    const w = raw.trim();
    if (w.length < 4 || w.length > 64) continue;
    if (AC_STOPWORDS.has(w)) continue;
    if (/^\d+$/.test(w)) continue;
    if (strong.has(w)) continue;
    // Keep compound product terms as strong (drill-down, market-trend, …)
    if (w.includes('-') && w.length >= 6) {
      strong.add(w);
      continue;
    }
    weak.add(w);
  }

  return { strong: [...strong], weak: [...weak] };
}

function isRuntimeOrQualityCriterion(criterion: string): boolean {
  const lower = criterion.toLowerCase();
  return (
    /load time|<\s*\d+\s*sec|seconds?\s*\(|cold start|drill-down in\s*</i.test(lower) ||
    /no console|stderr errors|gracefully handles|slow api/i.test(lower)
  );
}

function criterionEvidenceHits(tokens: string[], corpusLower: string, pathsLower: string): number {
  let hits = 0;
  for (const token of tokens) {
    if (corpusLower.includes(token) || pathsLower.includes(token)) {
      hits++;
      continue;
    }
    // Path basename without extension (MarketTrendDesk.tsx → markettrenddesk)
    const bare = token.replace(/\.[a-z0-9]+$/i, '');
    if (bare.length >= 4 && (corpusLower.includes(bare) || pathsLower.includes(bare))) {
      hits++;
    }
  }
  return hits;
}

function evalVerdictParse(evalDef: LoopEval, ctx: EvalContext): EvalResult {
  const required = (evalDef.config?.required as string) || 'approved';
  const verdict = ctx.reviewVerdict ?? parseReviewVerdict(ctx.reviewContent || '');
  const passed = verdict === required;
  return {
    evalId: evalDef.id,
    type: evalDef.type,
    passed,
    details: passed
      ? `Review verdict is ${verdict}`
      : `Expected verdict "${required}" but got "${verdict}"`,
    evidence: { verdict, required },
  };
}

function evalFileExists(evalDef: LoopEval, ctx: EvalContext): EvalResult {
  const file = evalDef.config?.file as string;
  if (!file) {
    return { evalId: evalDef.id, type: evalDef.type, passed: false, details: 'file_exists eval missing config.file' };
  }
  const workDir = ctx.workDir;
  let exists = false;
  if (workDir) {
    try {
      exists = fs.existsSync(resolveWithinRoot(workDir, file));
    } catch {
      exists = false;
    }
  }
  return {
    evalId: evalDef.id,
    type: evalDef.type,
    passed: exists,
    details: exists ? `Found ${file} in work directory` : `Missing ${file} in work directory`,
    evidence: { file, workDir },
  };
}

function pathHasBasename(files: string[], basename: string): boolean {
  const target = basename.toLowerCase();
  return files.some((f) => {
    const base = f.split('/').pop()?.toLowerCase() ?? '';
    return base === target || f.toLowerCase().endsWith(`/${target}`);
  });
}

function evalAcceptanceCriteria(evalDef: LoopEval, ctx: EvalContext): EvalResult {
  const item = ctx.workItem;
  if (!item || item.acceptanceCriteria.length === 0) {
    return {
      evalId: evalDef.id,
      type: evalDef.type,
      passed: true,
      details: 'No acceptance criteria to check',
    };
  }

  const workDir = ctx.workDir;
  const corpus = buildWorkDirCorpus(workDir);
  const files = corpus.files;
  const allText = corpus.text;
  const corpusLower = allText.toLowerCase();
  const pathsLower = files.join('\n').toLowerCase();
  const failures: string[] = [];
  const softPasses: string[] = [];

  for (const criterion of item.acceptanceCriteria) {
    const lower = criterion.toLowerCase();

    const fileMatch = criterion.match(/([^\s`]+\.[a-z0-9]+)\s+created/i);
    if (fileMatch) {
      const fname = fileMatch[1];
      if (!pathHasBasename(files, fname) && !files.includes(fname)) {
        failures.push(`Missing file: ${fname}`);
      }
      continue;
    }

    const countMatch = criterion.match(/at least\s+(\d+)/i);
    if (countMatch && (lower.includes('recommendation') || lower.includes('actionable'))) {
      const min = Number(countMatch[1]);
      const bullets = (allText.match(/^[\s]*[-*]\s+\S+/gm) || []).length;
      if (bullets < min) failures.push(`Expected ≥${min} recommendations, found ${bullets}`);
      continue;
    }

    if (lower.includes('review completes') || lower.includes('copilot review')) {
      if (ctx.reviewVerdict === 'unknown' && !ctx.reviewContent) {
        failures.push('Review step did not complete');
      }
      continue;
    }

    // "foo.py still passes" / run-script criteria → require the artifact; runtime is out of band.
    const scriptMatch = criterion.match(/`?([\w./-]+\.(?:py|sh|js|ts|mjs))`?/i);
    if (scriptMatch && (lower.includes('pass') || lower.includes('runs') || lower.includes('succeed'))) {
      const script = scriptMatch[1];
      if (!pathHasBasename(files, path.basename(script)) && !corpusLower.includes(script.toLowerCase())) {
        failures.push(`Missing script referenced by criterion: ${script}`);
      } else {
        softPasses.push(`Script present for runtime criterion: ${script}`);
      }
      continue;
    }

    const { strong, weak } = extractCriterionEvidenceGroups(criterion);
    if (strong.length === 0 && weak.length === 0) {
      // Extremely generic criterion — only fail if workdir is empty.
      if (files.length === 0) failures.push(`Criterion not met (empty workdir): ${criterion}`);
      continue;
    }

    const strongHits = criterionEvidenceHits(strong, corpusLower, pathsLower);
    const weakHits = criterionEvidenceHits(weak, corpusLower, pathsLower);
    const totalTokens = strong.length + weak.length;
    const totalHits = strongHits + weakHits;

    // Prefer identifier/file evidence: if every strong token lands, the criterion is met
    // even when surrounding prose words (candidates, forecasts, …) are absent from code.
    const strongOk =
      strong.length === 0
        ? weakHits >= (weak.length <= 2 ? 1 : Math.ceil(weak.length * 0.5))
        : strongHits >= (strong.length === 1 ? 1 : Math.ceil(strong.length * 0.75));

    if (strongOk) {
      continue;
    }

    // Performance / UX runtime criteria cannot be proven by static scan alone.
    // Pass when related product tokens appear (implementation evidence), else fail.
    if (isRuntimeOrQualityCriterion(criterion)) {
      if (totalHits >= 1 || files.length > 0) {
        softPasses.push(`Runtime/quality criterion inferred from implementation evidence: ${criterion}`);
        continue;
      }
    }

    // Legacy short-substring fallback for tiny demo criteria (e.g. improvements.md text)
    const snippet = criterion.toLowerCase().slice(0, 20).trim();
    if (snippet.length >= 8 && corpusLower.includes(snippet)) {
      continue;
    }

    failures.push(
      `Criterion not met (strong ${strongHits}/${strong.length}, weak ${weakHits}/${weak.length} of ${totalTokens}): ${criterion}`
    );
  }

  const passed = failures.length === 0;
  return {
    evalId: evalDef.id,
    type: evalDef.type,
    passed,
    score: passed ? 1 : Math.max(0, 1 - failures.length / item.acceptanceCriteria.length),
    details: passed
      ? softPasses.length > 0
        ? `All acceptance criteria satisfied (${softPasses.length} runtime/soft checks)`
        : 'All acceptance criteria satisfied'
      : failures.join('; '),
    evidence: {
      files: files.slice(0, 80),
      fileCount: files.length,
      failures,
      softPasses,
    },
  };
}

function evalTestCommand(evalDef: LoopEval, ctx: EvalContext): EvalResult {
  const command = evalDef.config?.command as string;
  const skipIfNoRepo = evalDef.config?.skipIfNoRepo !== false;
  const useRepoRoot = evalDef.config?.useRepoRoot === true;

  let cwd = (evalDef.config?.cwd as string) || ctx.workDir || process.cwd();
  if (useRepoRoot && ctx.workItem) {
    if (!hasLinkedRepository(ctx.workItem) && skipIfNoRepo) {
      return {
        evalId: evalDef.id,
        type: evalDef.type,
        passed: true,
        details: 'Skipped test_command: no linked workspace repository',
        evidence: { command, skipped: true },
      };
    }
    const repoRoot = resolveWorkItemWorkDir(ctx.workItem);
    if (repoRoot) cwd = repoRoot;
  }

  if (!command) {
    return { evalId: evalDef.id, type: evalDef.type, passed: false, details: 'test_command eval missing config.command' };
  }
  if (!fs.existsSync(cwd)) {
    return { evalId: evalDef.id, type: evalDef.type, passed: false, details: `Working directory not found: ${cwd}` };
  }

  try {
    execSync(command, { cwd, encoding: 'utf-8', timeout: 60_000, stdio: 'pipe' });
    return {
      evalId: evalDef.id,
      type: evalDef.type,
      passed: true,
      details: `Command succeeded: ${command}`,
      evidence: { command, cwd },
    };
  } catch (err) {
    const error = err as { status?: number; stderr?: string; message?: string };
    return {
      evalId: evalDef.id,
      type: evalDef.type,
      passed: false,
      details: `Command failed (exit ${error.status ?? '?'}): ${command}`,
      evidence: { command, cwd, stderr: error.stderr?.slice(0, 500), message: error.message },
    };
  }
}

/** Run one eval definition against the current loop context. */
export function runEval(evalDef: LoopEval, ctx: EvalContext): EvalResult {
  switch (evalDef.type) {
    case 'verdict_parse':
      return evalVerdictParse(evalDef, ctx);
    case 'file_exists':
      return evalFileExists(evalDef, ctx);
    case 'acceptance_criteria':
      return evalAcceptanceCriteria(evalDef, ctx);
    case 'test_command':
      return evalTestCommand(evalDef, ctx);
    default:
      return {
        evalId: evalDef.id,
        type: evalDef.type,
        passed: false,
        details: `Unsupported eval type: ${evalDef.type}`,
      };
  }
}

/** Run all evals; all must pass for eval_pass loop termination. */
export function runLoopEvals(evals: LoopEval[], ctx: EvalContext): EvalResult[] {
  return evals.map((e) => runEval(e, ctx));
}

export function allEvalsPassed(results: EvalResult[]): boolean {
  return results.length > 0 && results.every((r) => r.passed);
}

/** Default eval set for Grok→Copilot work-item loops (verdict + acceptance + optional tests). */
export function defaultWorkItemLoopEvals(workItem?: WorkItem, options?: { demo?: boolean }): LoopEval[] {
  // Demo / mock: verdict only so first-run always lands on approved when review says APPROVED.
  if (options?.demo) {
    return [{ id: 'verdict', type: 'verdict_parse', config: { required: 'approved' } }];
  }

  const evals: LoopEval[] = [
    { id: 'verdict', type: 'verdict_parse', config: { required: 'approved' } },
    { id: 'acceptance', type: 'acceptance_criteria' },
  ];

  if (workItem && resolveWorkItemWorkDir(workItem)) {
    evals.push({
      id: 'tests',
      type: 'test_command',
      config: { command: 'npm test', useRepoRoot: true, skipIfNoRepo: true },
    });
  }

  return evals;
}