import type {
  AgentType,
  LoopStatus,
  WorkflowLoop,
  WorkflowStep,
  WorkItem,
  WorkItemStatus,
} from '../types';
import { DEFAULT_MAX_LOOP_ITERATIONS } from '../types';
import { broadcast } from '../websocket';
import { now } from '../utils/helpers';
import {
  buildWorkItemContextScope,
  buildWorkDirExcerpts,
  resolveWorkItemOutputDir,
  resolveWorkItemWorkDir,
} from './work-item-context';
import {
  getWorkItem,
  updateWorkItem,
  resolveWorkDir,
  listFilesInDir,
  buildWorkItemAgentPrompt,
  buildAgentSkillsPromptSection,
} from './work-items';
import { logWorkItemActivity } from './work-item-activity';
import {
  runLoopEvals,
  allEvalsPassed,
  defaultWorkItemLoopEvals,
  parseReviewVerdict,
  type ReviewVerdict,
  type EvalResult,
  type LoopEval,
} from './eval-harness';
import {
  createLoopRun,
  updateLoopRun,
  completeLoopRun,
  failLoopRun,
  cancelLoopRun,
} from './loop-run';
import { incrementCounter } from '../metrics';
import { isLoopCancelled as isLoopCancelRequested, clearLoopCancel } from './loop-cancel';
import { updateAgentStatus } from './agent-registry';

export type { ReviewVerdict };

export type LoopStepPhase = 'implementation' | 'review' | string;

export interface AgentLoopStepResult {
  phase: LoopStepPhase;
  stepName: string;
  agentType: AgentType;
  content: string;
  auditId: string;
  filesCreated: string[];
  loopIteration: number;
}

export interface EscalationRetryContext {
  priorImplementation: string;
  reviewFeedback: string;
  implementAuditId?: string;
  reviewAuditId?: string;
}

export interface AgentLoopOptions {
  maxIterations?: number;
  autoLoop?: boolean;
  jobId?: string;
  workDir?: string;
  maxTokensPerLoop?: number;
  maxDurationMs?: number;
  /** When true, skip heavyweight evals (e.g. test_command) for mock/demo runs. */
  demo?: boolean;
  /** Re-assess existing deliverables without re-implementing. */
  reviewOnly?: boolean;
  /** Seed iteration 1 implement step with prior escalation feedback. */
  escalationContext?: EscalationRetryContext;
}

/** @alias AgentLoopOptions — used by work-item pipeline API */
export type PipelineOptions = AgentLoopOptions;

export interface AgentLoopResult {
  steps: AgentLoopStepResult[];
  reviewVerdict: ReviewVerdict;
  iterations: number;
  loopStatus: LoopStatus;
  workItem?: WorkItem;
  evalResults?: EvalResult[];
  loopRunId?: string;
}

export { parseReviewVerdict };

function emitLoopUpdate(
  workItemId: string,
  loopIteration: number,
  maxLoopIterations: number,
  loopStatus: LoopStatus
): void {
  broadcast({
    type: 'work_item:loop_update',
    payload: { workItemId, loopIteration, maxLoopIterations, loopStatus },
    timestamp: now(),
  });
}

function buildReviewPrompt(
  item: WorkItem,
  implementOutput: string,
  workDir?: string,
  filesCreated: string[] = [],
  agentId?: string
): string {
  const criteria =
    item.acceptanceCriteria.length > 0
      ? `\nAcceptance criteria:\n${item.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}`
      : '';

  const filesSection =
    workDir && filesCreated.length > 0
      ? `\nFiles created in ${workDir}: ${filesCreated.join(', ')}`
      : workDir
        ? `\nWorking directory: ${workDir}`
        : '';

  const skillsSection = buildAgentSkillsPromptSection(agentId ?? item.assignedAgentId);

  return (
    `Work item ${item.key}: Review the implementation.\n\n` +
    `## Original task\n${item.title}\n${item.description || ''}${criteria}${skillsSection}\n\n` +
    `## Implementation output\n${implementOutput}${filesSection}\n\n` +
    'Review for correctness, security, code quality, and acceptance criteria.\n' +
    'Start your response with exactly APPROVED or CHANGES_REQUESTED on the first line, then detailed feedback.'
  );
}

function buildFixPrompt(
  item: WorkItem,
  priorImplementation: string,
  reviewFeedback: string,
  iteration: number,
  workDir?: string,
  filesInWorkDir: string[] = [],
  agentId?: string
): string {
  const criteria =
    item.acceptanceCriteria.length > 0
      ? `\nAcceptance criteria:\n${item.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}`
      : '';

  const filesSection =
    workDir && filesInWorkDir.length > 0
      ? `\nFiles in ${workDir}: ${filesInWorkDir.join(', ')}`
      : workDir
        ? `\nWorking directory: ${workDir}`
        : '';

  const excerpts = workDir && filesInWorkDir.length > 0 ? buildWorkDirExcerpts(workDir, filesInWorkDir) : '';
  const skillsSection = buildAgentSkillsPromptSection(agentId ?? item.assignedAgentId);

  return (
    `Work item ${item.key} — iteration ${iteration}: Address reviewer feedback from the previous pass.\n\n` +
    `## Original task\n${item.title}\n${item.description || ''}${criteria}${skillsSection}\n\n` +
    `## Your prior implementation\n${priorImplementation}\n\n` +
    `## Reviewer feedback (CHANGES_REQUESTED)\n${reviewFeedback}\n\n` +
    `${filesSection}${excerpts}\n\n` +
    'Apply the requested changes in the working directory. Do not only describe fixes — write or update the files.'
  );
}

function buildGenericLoopPrompt(stepPrompt: string, priorResults: string[]): string {
  const prior =
    priorResults.length > 0
      ? `\n\n## Prior step output\n${priorResults.join('\n\n---\n\n')}`
      : '';
  return `${stepPrompt}${prior}`;
}

function resolveStepPhase(step: WorkflowStep, index: number, total: number): LoopStepPhase {
  const configured = step.config?.phase as string | undefined;
  if (configured) return configured;
  if (step.capability === 'review') return 'review';
  if (step.capability === 'testing') return 'testing';
  if (index === total - 1 && total >= 2) return 'review';
  return 'implementation';
}

function checkLoopCancelled(workItemId: string): boolean {
  if (isLoopCancelRequested(workItemId)) return true;
  const item = getWorkItem(workItemId);
  return item?.loopStatus === 'cancelled';
}

function recordIterationDuration(loopId: string, durationMs: number, stepCount: number): void {
  incrementCounter(
    'agenthub_loop_iteration_duration_ms_total',
    'Cumulative loop iteration duration in milliseconds',
    { loop_id: loopId, step_count: String(stepCount) },
    durationMs
  );
}

function checkLoopBudgets(input: {
  loop: WorkflowLoop;
  options: AgentLoopOptions;
  tokensUsed: number;
  startedAtMs: number;
}): { exceeded: boolean; reason?: string } {
  const maxTokens = input.options.maxTokensPerLoop ?? input.loop.maxTokensPerLoop;
  if (maxTokens != null && input.tokensUsed >= maxTokens) {
    return { exceeded: true, reason: `Token budget exhausted (${input.tokensUsed}/${maxTokens})` };
  }
  const maxDuration = input.options.maxDurationMs ?? input.loop.maxDurationMs;
  if (maxDuration != null && Date.now() - input.startedAtMs >= maxDuration) {
    return { exceeded: true, reason: `Duration budget exhausted (${maxDuration}ms)` };
  }
  return { exceeded: false };
}

function resolveFinalState(
  reviewVerdict: ReviewVerdict,
  iteration: number,
  maxIterations: number,
  autoLoop: boolean,
  onExhausted: WorkflowLoop['onExhausted']
): { status: WorkItemStatus; loopStatus: LoopStatus; needsHumanApproval?: boolean } {
  if (reviewVerdict === 'approved') {
    return { status: 'done', loopStatus: 'approved' };
  }

  if (reviewVerdict === 'changes_requested') {
    if (autoLoop && iteration >= maxIterations) {
      if (onExhausted === 'fail') {
        return { status: 'todo', loopStatus: 'failed' };
      }
      if (onExhausted === 'human_approval') {
        return { status: 'in_review', loopStatus: 'escalated', needsHumanApproval: true };
      }
      return { status: 'in_review', loopStatus: 'escalated' };
    }
    if (autoLoop && iteration < maxIterations) {
      return { status: 'in_progress', loopStatus: 'running' };
    }
    return { status: 'todo', loopStatus: 'idle' };
  }

  return { status: 'in_review', loopStatus: 'idle' };
}

/** Build a synthetic context scope from loop transcript for human approval. */
function buildLoopEscalationScope(
  item: WorkItem,
  steps: AgentLoopStepResult[],
  evalResults?: EvalResult[]
): import('../types').ContextScope {
  const transcript = steps
    .map((s) => `## ${s.phase} (iter ${s.loopIteration}, ${s.agentType})\n${s.content}`)
    .join('\n\n');
  const evalSection =
    evalResults && evalResults.length > 0
      ? `\n\n## Eval results\n${evalResults.map((e) => `- ${e.evalId}: ${e.passed ? 'PASS' : 'FAIL'} — ${e.details}`).join('\n')}`
      : '';

  return {
    files: [`// loop-transcript.md\n${transcript}${evalSection}`],
    diffs: [],
    symbols: [],
    maxTokens: 8000,
    sensitivityLevel: 1,
  };
}

async function runLoopAgentStep(input: {
  workItemId?: string;
  item?: WorkItem;
  workflowId?: string;
  agentType: AgentType;
  agentId?: string;
  phase: LoopStepPhase;
  stepName: string;
  prompt: string;
  capability: string;
  workDir?: string;
  filesBefore: Set<string>;
  loopIteration: number;
  executionLabel: string;
  deltaSinceMs?: number;
}): Promise<{ pipeline: Awaited<ReturnType<typeof import('./outbound-pipeline').executeOutboundPipeline>>; filesCreated: string[] }> {
  const { executeOutboundPipeline } = await import('./outbound-pipeline');
  const resolvedAgentId = input.agentId ?? input.item?.assignedAgentId;

  if (input.workItemId && input.item) {
    logWorkItemActivity({
      workItemId: input.workItemId,
      activityType: 'agent_started',
      summary:
        input.phase === 'review'
          ? `Iteration ${input.loopIteration}: ${input.agentType} review started (auto-triggered after implementation on ${input.item.key})`
          : `Iteration ${input.loopIteration}: ${input.agentType} started ${input.stepName} on ${input.item.key}`,
      agentType: input.agentType,
      agentId: resolvedAgentId,
      metadata: { pipelinePhase: input.phase, loopIteration: input.loopIteration },
    });
  }

  const broadcastPayload: Record<string, unknown> = {
    workItemId: input.workItemId,
    phase: input.phase,
    agentType: input.agentType,
    status: 'started',
    loopIteration: input.loopIteration,
  };

  broadcast({
    type: input.workItemId ? 'work_item:pipeline_step' : 'workflow:step',
    payload: input.workItemId
      ? broadcastPayload
      : {
          stepName: `${input.executionLabel}/${input.phase}`,
          status: 'running',
          loopIteration: input.loopIteration,
        },
    timestamp: now(),
  });

  let contextScope;
  let auditFilePaths: string[] = [];
  let basePath = input.workDir;

  let contextSummary;

  if (input.item) {
    const contextRoot = resolveWorkItemWorkDir(input.item) ?? input.workDir;
    const ctx = buildWorkItemContextScope(input.item, contextRoot, {
      includeDiffs: true,
      loopIteration: input.loopIteration,
      deltaSinceMs: input.deltaSinceMs,
    });
    contextScope = ctx.scope;
    auditFilePaths = ctx.auditFilePaths;
    basePath = ctx.basePath;
    contextSummary = ctx.contextSummary;

    if (ctx.workDirSecretIssues?.length && input.workItemId) {
      logWorkItemActivity({
        workItemId: input.workItemId,
        activityType: 'comment',
        summary: `Pre-outbound secret scan: ${ctx.workDirSecretIssues.length} issue(s) in work dir`,
        metadata: {
          loopIteration: input.loopIteration,
          event: 'work_dir_secret_scan',
          issues: ctx.workDirSecretIssues,
        },
      });
    }
  } else {
    const { buildContextScope } = await import('./context-scope');
    contextScope = buildContextScope({
      filePaths: [],
      basePath: input.workDir,
      includeDiffs: false,
      sensitivityLevel: 0,
    });
  }

  if (resolvedAgentId) updateAgentStatus(resolvedAgentId, 'running');

  let pipeline: Awaited<ReturnType<typeof executeOutboundPipeline>>;
  try {
    pipeline = await executeOutboundPipeline({
      agentType: input.agentType,
      prompt: input.prompt,
      contextScope,
      capability: input.capability,
      agentId: resolvedAgentId,
      workflowId: input.workflowId ?? input.item?.workflowId,
      task: `${input.executionLabel}/${input.phase}/iter${input.loopIteration}`,
      workItemId: input.workItemId,
      pipelinePhase: input.phase,
      loopIteration: input.loopIteration,
      basePath,
      outputDir: input.workDir,
      filePaths: auditFilePaths,
      workspaceId: input.item?.workspaceId,
      contextSummary,
    });
    if (resolvedAgentId) updateAgentStatus(resolvedAgentId, 'idle');
  } catch (err) {
    if (resolvedAgentId) updateAgentStatus(resolvedAgentId, 'error');
    throw err;
  }

  const filesAfter = listFilesInDir(input.workDir);
  const filesCreated = filesAfter.filter((f) => !input.filesBefore.has(f));
  for (const f of filesCreated) input.filesBefore.add(f);

  if (input.workItemId && input.item) {
    const completedSummary =
      input.phase === 'review'
        ? `Iteration ${input.loopIteration}: ${pipeline.agentType} completed review of ${input.item.key}`
        : filesCreated.length > 0
          ? `Iteration ${input.loopIteration}: ${pipeline.agentType} completed ${input.item.key} — created ${filesCreated.join(', ')}`
          : `Iteration ${input.loopIteration}: ${pipeline.agentType} completed work on ${input.item.key}`;

    logWorkItemActivity({
      workItemId: input.workItemId,
      activityType: 'agent_completed',
      summary: completedSummary,
      agentType: pipeline.fallbackFrom ?? pipeline.agentType,
      agentId: resolvedAgentId,
      auditId: pipeline.auditId,
      metadata: {
        pipelinePhase: input.phase,
        content: pipeline.content,
        agentType: pipeline.agentType,
        tokenCount: pipeline.tokenCount,
        workDir: input.workDir ?? null,
        filesCreated,
        autoTriggered: input.phase === 'review',
        loopIteration: input.loopIteration,
        contextFiles: auditFilePaths,
        contextSummary,
      },
    });
  }

  broadcast({
    type: input.workItemId ? 'work_item:pipeline_step' : 'workflow:step',
    payload: input.workItemId
      ? {
          workItemId: input.workItemId,
          phase: input.phase,
          agentType: pipeline.agentType,
          status: 'completed',
          auditId: pipeline.auditId,
          loopIteration: input.loopIteration,
        }
      : {
          stepName: `${input.executionLabel}/${input.phase}`,
          status: 'completed',
          loopIteration: input.loopIteration,
        },
    timestamp: now(),
  });

  return { pipeline, filesCreated };
}

/**
 * Run an implement → review agent loop (WorkflowLoop with until: verdict_approved).
 * Used by work-item pipeline and workflow engine.
 */
export async function runAgentLoop(input: {
  loop: WorkflowLoop;
  workflowId?: string;
  workItemId?: string;
  workDir?: string;
  options?: AgentLoopOptions;
  executionLabel?: string;
  jobId?: string;
  workflowExecutionId?: string;
}): Promise<AgentLoopResult> {
  const { loop, workflowId, workItemId, options = {} } = input;
  const maxIterations = options.maxIterations ?? loop.maxIterations ?? DEFAULT_MAX_LOOP_ITERATIONS;
  const autoLoop = options.autoLoop !== false;
  const executionLabel = input.executionLabel ?? loop.id;

  if (loop.steps.length < 1) {
    throw new Error('Agent loop requires at least one step');
  }

  const reviewStepIndex = loop.steps.findIndex(
    (s, i) => resolveStepPhase(s, i, loop.steps.length) === 'review'
  );
  const hasReviewStep = reviewStepIndex >= 0;

  const item = workItemId ? getWorkItem(workItemId) : null;
  if (workItemId && !item) throw new Error('Work item not found');

  const workDir =
    input.workDir ??
    input.options?.workDir ??
    (item ? resolveWorkItemOutputDir(item) ?? resolveWorkItemWorkDir(item) : resolveWorkDir());

  const filesBefore = new Set(listFilesInDir(workDir));
  const criteria =
    item && item.acceptanceCriteria.length > 0
      ? `\n\nAcceptance criteria:\n${item.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}`
      : '';

  if (item) {
    updateWorkItem(workItemId!, {
      status: 'in_progress',
      loopStatus: 'running',
      loopIteration: 0,
      maxLoopIterations: maxIterations,
      workflowId: workflowId ?? item.workflowId,
    });
    emitLoopUpdate(workItemId!, 0, maxIterations, 'running');
  }

  const allSteps: AgentLoopStepResult[] = [];
  let iteration = 0;
  let reviewVerdict: ReviewVerdict = 'unknown';
  let loopStatus: LoopStatus = 'running';
  let lastImplementOutput = '';
  let lastReviewFeedback = '';
  let lastEvalResults: EvalResult[] = [];

  const loopRunId = createLoopRun({
    workItemId,
    workflowExecutionId: input.workflowExecutionId,
    loopId: loop.id,
    maxIterations,
    jobId: input.jobId ?? options.jobId,
  });

  const loopStartedAtMs = Date.now();
  let previousIterationStartMs = loopStartedAtMs;
  let tokensUsed = 0;

  try {
    while (iteration < maxIterations) {
      iteration++;

      const budgetCheck = checkLoopBudgets({ loop, options, tokensUsed, startedAtMs: loopStartedAtMs });
      if (budgetCheck.exceeded) {
        loopStatus = 'escalated';
        incrementCounter('agenthub_loop_escalations_total', 'Loop escalations to human review', {
          loop_id: loop.id,
          reason: 'budget',
        });
        if (workItemId) {
          logWorkItemActivity({
            workItemId,
            activityType: 'comment',
            summary: `Loop budget exceeded: ${budgetCheck.reason}`,
            metadata: { loopId: loop.id, tokensUsed, reason: budgetCheck.reason },
          });
          updateWorkItem(workItemId, { status: 'in_review', loopStatus: 'escalated', loopIteration: iteration });
          emitLoopUpdate(workItemId, iteration, maxIterations, 'escalated');
        }
        completeLoopRun(loopRunId, { iteration, verdict: reviewVerdict, loopStatus: 'escalated' });
        if (workItemId) clearLoopCancel(workItemId);
        return {
          steps: allSteps,
          reviewVerdict,
          iterations: iteration,
          loopStatus,
          workItem: workItemId ? getWorkItem(workItemId)! : undefined,
          evalResults: lastEvalResults,
          loopRunId,
        };
      }

      if (workItemId && checkLoopCancelled(workItemId)) {
        loopStatus = 'cancelled';
        cancelLoopRun(loopRunId);
        if (item) {
          updateWorkItem(workItemId, { status: 'todo', loopStatus: 'cancelled', loopIteration: iteration });
          emitLoopUpdate(workItemId, iteration, maxIterations, 'cancelled');
        }
        clearLoopCancel(workItemId);
        return {
          steps: allSteps,
          reviewVerdict,
          iterations: iteration,
          loopStatus,
          workItem: workItemId ? getWorkItem(workItemId)! : undefined,
          evalResults: lastEvalResults,
          loopRunId,
        };
      }

      if (item) {
        updateWorkItem(workItemId!, { loopIteration: iteration });
        emitLoopUpdate(workItemId!, iteration, maxIterations, 'running');
      }

      const iterationStartedAt = now();
      const iterationStartMs = Date.now();
      const deltaSinceMs = iteration === 1 ? loopStartedAtMs : previousIterationStartMs;
      previousIterationStartMs = iterationStartMs;
      if (workItemId) {
        logWorkItemActivity({
          workItemId,
          activityType: 'comment',
          summary: `Loop iteration ${iteration}/${maxIterations} started`,
          metadata: {
            loopIteration: iteration,
            maxLoopIterations: maxIterations,
            event: 'loop_iteration_started',
            loopId: loop.id,
          },
        });
      }

      const currentItem = item ? getWorkItem(workItemId!)! : undefined;
      const iterationPriorOutputs: string[] = [];
      let iterationImplementOutput = '';
      let iterationImplementFiles: string[] = [];
      let iterationReviewOutput = '';
      let iterationReviewAuditId: string | undefined;
      let iterationImplementAuditId: string | undefined;

      for (let stepIdx = 0; stepIdx < loop.steps.length; stepIdx++) {
        if (workItemId && checkLoopCancelled(workItemId)) {
          loopStatus = 'cancelled';
          cancelLoopRun(loopRunId);
          if (item) {
            updateWorkItem(workItemId, { status: 'todo', loopStatus: 'cancelled', loopIteration: iteration });
            emitLoopUpdate(workItemId, iteration, maxIterations, 'cancelled');
          }
          clearLoopCancel(workItemId);
          return {
            steps: allSteps,
            reviewVerdict,
            iterations: iteration,
            loopStatus,
            workItem: workItemId ? getWorkItem(workItemId)! : undefined,
            evalResults: lastEvalResults,
            loopRunId,
          };
        }

        const step = loop.steps[stepIdx];
        const phase = resolveStepPhase(step, stepIdx, loop.steps.length);
        const isPrimaryImplement =
          phase === 'implementation' &&
          (stepIdx === 0 || step.capability === 'implementation' || !hasReviewStep);

        const stepAgentId =
          typeof step.config?.agentId === 'string' ? step.config.agentId : currentItem?.assignedAgentId;

        if (options.reviewOnly && phase !== 'review') {
          if (phase === 'implementation') {
            const seeded =
              options.escalationContext?.priorImplementation ||
              lastImplementOutput ||
              iterationPriorOutputs.at(-1) ||
              '';
            iterationImplementOutput = seeded;
            lastImplementOutput = seeded;
            iterationImplementFiles = listFilesInDir(workDir);
          }
          continue;
        }

        let stepPrompt: string;
        if (currentItem) {
          if (phase === 'review') {
            stepPrompt = buildReviewPrompt(
              currentItem,
              iterationImplementOutput || iterationPriorOutputs.at(-1) || '',
              workDir,
              iterationImplementFiles,
              stepAgentId
            );
          } else if (
            isPrimaryImplement &&
            iteration === 1 &&
            options.escalationContext &&
            (options.reviewOnly === false || options.reviewOnly === undefined)
          ) {
            stepPrompt = buildFixPrompt(
              currentItem,
              options.escalationContext.priorImplementation,
              options.escalationContext.reviewFeedback,
              iteration,
              workDir,
              listFilesInDir(workDir),
              stepAgentId
            );
          } else if (isPrimaryImplement && iteration === 1) {
            stepPrompt = buildWorkItemAgentPrompt(currentItem, criteria, workDir);
          } else if (isPrimaryImplement && iteration > 1) {
            stepPrompt = buildFixPrompt(
              currentItem,
              lastImplementOutput,
              lastReviewFeedback,
              iteration,
              workDir,
              listFilesInDir(workDir),
              stepAgentId
            );
          } else {
            const basePrompt =
              (step.config?.prompt as string) || `Execute the "${step.name}" step.`;
            stepPrompt =
              buildGenericLoopPrompt(basePrompt, iterationPriorOutputs) +
              buildAgentSkillsPromptSection(stepAgentId);
          }
        } else {
          stepPrompt = buildGenericLoopPrompt(
            (step.config?.prompt as string) ||
              (phase === 'review'
                ? 'Review the prior output. Start with APPROVED or CHANGES_REQUESTED.'
                : `Execute the "${step.name}" step.`),
            phase === 'review'
              ? [iterationImplementOutput || iterationPriorOutputs.at(-1) || '']
              : iterationPriorOutputs
          );
        }

        const { pipeline: stepResult, filesCreated: stepFiles } = await runLoopAgentStep({
          workItemId,
          item: currentItem,
          workflowId,
          agentType: step.agent,
          agentId: stepAgentId,
          phase,
          stepName: step.name,
          prompt: stepPrompt,
          capability: step.capability || (phase === 'review' ? 'review' : step.name),
          workDir,
          filesBefore,
          loopIteration: iteration,
          executionLabel,
          deltaSinceMs,
        });

        iterationPriorOutputs.push(stepResult.content);
        tokensUsed += stepResult.tokenCount ?? 0;

        const stepBudget = checkLoopBudgets({ loop, options, tokensUsed, startedAtMs: loopStartedAtMs });
        if (stepBudget.exceeded) {
          loopStatus = 'escalated';
          incrementCounter('agenthub_loop_escalations_total', 'Loop escalations to human review', {
            loop_id: loop.id,
            reason: 'budget',
          });
          if (workItemId) {
            logWorkItemActivity({
              workItemId,
              activityType: 'comment',
              summary: `Loop budget exceeded mid-iteration: ${stepBudget.reason}`,
              metadata: { loopId: loop.id, tokensUsed, reason: stepBudget.reason, loopIteration: iteration },
            });
            updateWorkItem(workItemId, { status: 'in_review', loopStatus: 'escalated', loopIteration: iteration });
            emitLoopUpdate(workItemId, iteration, maxIterations, 'escalated');
          }
          completeLoopRun(loopRunId, { iteration, verdict: reviewVerdict, loopStatus: 'escalated' });
          if (workItemId) clearLoopCancel(workItemId);
          return {
            steps: allSteps,
            reviewVerdict,
            iterations: iteration,
            loopStatus,
            workItem: workItemId ? getWorkItem(workItemId)! : undefined,
            evalResults: lastEvalResults,
            loopRunId,
          };
        }

        if (phase === 'review') {
          iterationReviewOutput = stepResult.content;
          iterationReviewAuditId = stepResult.auditId;
          reviewVerdict = parseReviewVerdict(stepResult.content, {
            parser: loop.verdictParser,
            onUnknownVerdict: loop.onUnknownVerdict,
          });
          lastReviewFeedback = stepResult.content;
        } else if (isPrimaryImplement) {
          iterationImplementOutput = stepResult.content;
          lastImplementOutput = stepResult.content;
          iterationImplementFiles = stepFiles;
          iterationImplementAuditId = stepResult.auditId;
        }

        allSteps.push({
          phase,
          stepName: step.name,
          agentType: stepResult.agentType,
          content: stepResult.content,
          auditId: stepResult.auditId,
          filesCreated: stepFiles,
          loopIteration: iteration,
        });
      }

      if (!hasReviewStep && loop.until === 'verdict_approved') {
        reviewVerdict = 'unknown';
      }

      const evals: LoopEval[] =
        loop.evals ??
        (loop.until === 'eval_pass' && currentItem
          ? defaultWorkItemLoopEvals(currentItem, { demo: options.demo })
          : []);

      lastEvalResults =
        evals.length > 0
          ? runLoopEvals(evals, {
              workItem: currentItem,
              workDir,
              reviewContent: iterationReviewOutput,
              reviewVerdict,
            })
          : [];

      if (workItemId && lastEvalResults.length > 0) {
        logWorkItemActivity({
          workItemId,
          activityType: 'comment',
          summary: `Evals: ${lastEvalResults.filter((e) => e.passed).length}/${lastEvalResults.length} passed`,
          metadata: {
            loopIteration: iteration,
            event: 'loop_eval_completed',
            evalResults: lastEvalResults,
            loopId: loop.id,
          },
        });
      }

      updateLoopRun(loopRunId, {
        iteration,
        verdict: reviewVerdict,
        loopStatus: 'running',
      });

      const iterationDurationMs = Date.now() - iterationStartMs;
      recordIterationDuration(loop.id, iterationDurationMs, loop.steps.length);

      if (workItemId) {
        logWorkItemActivity({
          workItemId,
          activityType: 'comment',
          summary: `Loop iteration ${iteration}/${maxIterations} finished → ${reviewVerdict}`,
          metadata: {
            loopIteration: iteration,
            maxLoopIterations: maxIterations,
            verdict: reviewVerdict,
            event: 'loop_iteration_completed',
            implementAuditId: iterationImplementAuditId,
            reviewAuditId: iterationReviewAuditId,
            startedAt: iterationStartedAt,
            completedAt: now(),
            loopId: loop.id,
            evalResults: lastEvalResults,
            stepCount: loop.steps.length,
            tokensUsed,
            durationMs: iterationDurationMs,
          },
        });
      }

      const evalsPassed = evals.length === 0 || allEvalsPassed(lastEvalResults);
      const loopSucceeded =
        loop.until === 'eval_pass'
          ? evalsPassed
          : loop.until === 'verdict_approved' && reviewVerdict === 'approved';

      if (loopSucceeded) {
        loopStatus = 'approved';
        incrementCounter('agenthub_loop_iterations_total', 'Total loop iterations completed', {
          loop_id: loop.id,
          outcome: 'approved',
        });
        if (item) {
          updateWorkItem(workItemId!, { status: 'done', loopStatus: 'approved', loopIteration: iteration });
          emitLoopUpdate(workItemId!, iteration, maxIterations, 'approved');
        }
        completeLoopRun(loopRunId, { iteration, verdict: reviewVerdict, loopStatus: 'approved' });
        break;
      }

      const needsAnotherPass =
        loop.until === 'eval_pass'
          ? !evalsPassed
          : reviewVerdict === 'changes_requested';

      const shouldContinue = autoLoop && needsAnotherPass && iteration < maxIterations;

      if (!shouldContinue) {
        const effectiveVerdict: ReviewVerdict =
          loop.until === 'eval_pass' && !evalsPassed && reviewVerdict === 'approved'
            ? 'changes_requested'
            : reviewVerdict;

        const final = item
          ? resolveFinalState(effectiveVerdict, iteration, maxIterations, autoLoop, loop.onExhausted)
          : {
              status: 'in_review' as WorkItemStatus,
              loopStatus:
                reviewVerdict === 'changes_requested' && iteration >= maxIterations
                  ? loop.onExhausted === 'fail'
                    ? ('failed' as LoopStatus)
                    : ('escalated' as LoopStatus)
                  : ('idle' as LoopStatus),
            };

        loopStatus = final.loopStatus;
        if (final.loopStatus === 'escalated') {
          incrementCounter('agenthub_loop_escalations_total', 'Loop escalations to human review', {
            loop_id: loop.id,
          });
        }
        if (item && final.needsHumanApproval) {
          const { createApprovalRequest } = await import('./approval-gate');
          createApprovalRequest(
            buildLoopEscalationScope(item, allSteps, lastEvalResults),
            item.workflowId,
            {
              workItemId: workItemId!,
              loopRunId: loopRunId,
              summary: `Loop exhausted after ${iteration} iteration(s) on ${item.key} — human review required`,
            }
          );
          logWorkItemActivity({
            workItemId: workItemId!,
            activityType: 'comment',
            summary: `Loop escalated to human approval after ${iteration} iteration(s)`,
            metadata: { loopRunId, loopId: loop.id, reviewVerdict },
          });
        }
        if (item) {
          updateWorkItem(workItemId!, {
            status: final.status,
            loopStatus: final.loopStatus,
            loopIteration: iteration,
          });
          emitLoopUpdate(workItemId!, iteration, maxIterations, final.loopStatus);
        }
        completeLoopRun(loopRunId, { iteration, verdict: reviewVerdict, loopStatus: final.loopStatus });
        break;
      }
    }

    if (workItemId) {
      logWorkItemActivity({
        workItemId,
        activityType: 'comment',
        summary: `Pipeline finished after ${iteration} iteration(s): ${reviewVerdict} (loop: ${loopStatus})`,
        metadata: { reviewVerdict, loopStatus, iterations: iteration, loopId: loop.id, tokensUsed },
      });
      clearLoopCancel(workItemId);
    }

    return {
      steps: allSteps,
      reviewVerdict,
      iterations: iteration,
      loopStatus,
      workItem: workItemId ? getWorkItem(workItemId)! : undefined,
      evalResults: lastEvalResults,
      loopRunId,
    };
  } catch (err) {
    failLoopRun(loopRunId, (err as Error).message);
    if (workItemId) clearLoopCancel(workItemId);
    if (workItemId && item) {
      logWorkItemActivity({
        workItemId,
        activityType: 'agent_failed',
        summary: `Pipeline failed on ${item.key}: ${(err as Error).message}`,
        metadata: { loopId: loop.id, error: (err as Error).message, loopIteration: iteration },
      });
      updateWorkItem(workItemId, { status: 'todo', loopStatus: 'failed', loopIteration: iteration });
      emitLoopUpdate(workItemId, iteration, maxIterations, 'failed');
    }
    throw err;
  }
}