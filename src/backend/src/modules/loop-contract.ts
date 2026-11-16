/**
 * Fail-fast validation for WorkflowLoop definitions.
 * Unsupported until / parser / eval types throw before any agent spend.
 */
import type { LoopEval, WorkflowLoop, WorkflowLoopUntil, WorkflowVerdictParser } from '../types';

const SUPPORTED_UNTIL: WorkflowLoopUntil[] = ['verdict_approved', 'eval_pass', 'step_output_match'];
const SUPPORTED_PARSERS: WorkflowVerdictParser[] = [
  'approved_changes_requested',
  'json_block',
  'custom_regex',
];
const SUPPORTED_EVAL_TYPES = new Set([
  'verdict_parse',
  'acceptance_criteria',
  'test_command',
  'file_exists',
  'git_diff',
  'step_output_match',
]);

export class LoopContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoopContractError';
  }
}

function assertEval(evalDef: LoopEval, loopId: string): void {
  if (evalDef.type === 'custom') {
    throw new LoopContractError(
      `Loop "${loopId}": eval type "custom" is not supported. ` +
        `Use file_exists, test_command, git_diff, verdict_parse, acceptance_criteria, or step_output_match.`
    );
  }
  if (!SUPPORTED_EVAL_TYPES.has(evalDef.type)) {
    throw new LoopContractError(
      `Loop "${loopId}": unsupported eval type "${evalDef.type}". ` +
        `Supported: ${[...SUPPORTED_EVAL_TYPES].join(', ')}.`
    );
  }
  if (evalDef.type === 'step_output_match') {
    const pattern = evalDef.config?.pattern;
    if (typeof pattern !== 'string' || !pattern.trim()) {
      throw new LoopContractError(
        `Loop "${loopId}": step_output_match eval "${evalDef.id}" requires config.pattern (regex string).`
      );
    }
  }
}

/** Validate a loop before enqueue / run. Throws LoopContractError on fiction. */
export function assertLoopContract(loop: WorkflowLoop): void {
  if (!SUPPORTED_UNTIL.includes(loop.until)) {
    throw new LoopContractError(
      `Loop "${loop.id}": unsupported until "${loop.until}". ` +
        `Use verdict_approved, eval_pass, or step_output_match.`
    );
  }

  const parser = loop.verdictParser ?? 'approved_changes_requested';
  if (!SUPPORTED_PARSERS.includes(parser)) {
    throw new LoopContractError(
      `Loop "${loop.id}": unsupported verdictParser "${parser}". ` +
        `Use approved_changes_requested, json_block, or custom_regex.`
    );
  }

  if (parser === 'custom_regex') {
    const pattern = loop.verdictRegex;
    if (typeof pattern !== 'string' || !pattern.trim()) {
      throw new LoopContractError(
        `Loop "${loop.id}": verdictParser "custom_regex" requires verdictRegex ` +
          `(e.g. "APPROVED|CHANGES_REQUESTED" with named groups optional).`
      );
    }
  }

  if (loop.until === 'step_output_match') {
    const pattern = loop.untilMatchPattern;
    if (typeof pattern !== 'string' || !pattern.trim()) {
      throw new LoopContractError(
        `Loop "${loop.id}": until "step_output_match" requires untilMatchPattern (regex string). ` +
          `Optional untilMatchStep names which step output to test (default: last step).`
      );
    }
  }

  for (const evalDef of loop.evals ?? []) {
    assertEval(evalDef, loop.id);
  }
}
