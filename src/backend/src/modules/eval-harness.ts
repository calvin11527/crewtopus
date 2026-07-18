import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import type { OnUnknownVerdict, WorkflowVerdictParser } from '../types';
import type { WorkItem } from '../types';
import { listFilesInDir } from './work-items';
import { resolveWorkItemWorkDir } from './work-item-context';

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

function readWorkDirText(workDir?: string): string {
  if (!workDir || !fs.existsSync(workDir)) return '';
  return listFilesInDir(workDir)
    .map((name) => {
      try {
        return fs.readFileSync(path.join(workDir, name), 'utf-8');
      } catch {
        return '';
      }
    })
    .join('\n');
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
  const exists = workDir ? fs.existsSync(path.join(workDir, file)) : false;
  return {
    evalId: evalDef.id,
    type: evalDef.type,
    passed: exists,
    details: exists ? `Found ${file} in work directory` : `Missing ${file} in work directory`,
    evidence: { file, workDir },
  };
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
  const files = listFilesInDir(workDir);
  const allText = readWorkDirText(workDir);
  const failures: string[] = [];

  for (const criterion of item.acceptanceCriteria) {
    const lower = criterion.toLowerCase();

    const fileMatch = criterion.match(/([^\s`]+\.[a-z0-9]+)\s+created/i);
    if (fileMatch) {
      const fname = fileMatch[1];
      if (!files.includes(fname)) failures.push(`Missing file: ${fname}`);
      continue;
    }

    const countMatch = criterion.match(/at least\s+(\d+)/i);
    if (countMatch && (lower.includes('recommendation') || lower.includes('actionable'))) {
      const min = Number(countMatch[1]);
      const bullets = (allText.match(/^-\s+\S+/gm) || []).length;
      if (bullets < min) failures.push(`Expected ≥${min} recommendations, found ${bullets}`);
      continue;
    }

    if (lower.includes('review completes') || lower.includes('copilot review')) {
      if (ctx.reviewVerdict === 'unknown' && !ctx.reviewContent) {
        failures.push('Review step did not complete');
      }
      continue;
    }

    if (!allText.toLowerCase().includes(criterion.toLowerCase().slice(0, 20))) {
      failures.push(`Criterion not met: ${criterion}`);
    }
  }

  return {
    evalId: evalDef.id,
    type: evalDef.type,
    passed: failures.length === 0,
    score: failures.length === 0 ? 1 : 0,
    details: failures.length === 0 ? 'All acceptance criteria satisfied' : failures.join('; '),
    evidence: { files, failures },
  };
}

function evalTestCommand(evalDef: LoopEval, ctx: EvalContext): EvalResult {
  const command = evalDef.config?.command as string;
  const skipIfNoRepo = evalDef.config?.skipIfNoRepo !== false;
  const useRepoRoot = evalDef.config?.useRepoRoot === true;

  let cwd = (evalDef.config?.cwd as string) || ctx.workDir || process.cwd();
  if (useRepoRoot && ctx.workItem) {
    const repoRoot = resolveWorkItemWorkDir(ctx.workItem);
    if (repoRoot) {
      cwd = repoRoot;
    } else if (skipIfNoRepo) {
      return {
        evalId: evalDef.id,
        type: evalDef.type,
        passed: true,
        details: 'Skipped test_command: no linked workspace repository',
        evidence: { command, skipped: true },
      };
    }
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
  const evals: LoopEval[] = [
    { id: 'verdict', type: 'verdict_parse', config: { required: 'approved' } },
    { id: 'acceptance', type: 'acceptance_criteria' },
  ];

  if (!options?.demo && workItem && resolveWorkItemWorkDir(workItem)) {
    evals.push({
      id: 'tests',
      type: 'test_command',
      config: { command: 'npm test', useRepoRoot: true, skipIfNoRepo: true },
    });
  }

  return evals;
}