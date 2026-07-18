import type { LoopStatus, WorkflowDefinition, WorkflowLoop, WorkItem } from '../types';
import { resolveSprintAgent } from './sprint-team';
import { createWorkflow, getWorkflow, listWorkflows, updateWorkflow } from './workflow-engine';
import { createWorkItem, getWorkItem } from './work-items';
import { listWorkItemActivity } from './work-item-activity';
import { parseReviewVerdict, type ReviewVerdict } from './eval-harness';
import {
  runAgentLoop,
  type AgentLoopStepResult,
  type PipelineOptions,
} from './loop-engine';
import {
  buildLoopRetryPayload,
  enqueueLoopRetry,
  type LoopRetryPayload,
  type LoopRetryMode,
} from './loop-retry';

export const GROK_COPILOT_WORKFLOW_NAME = 'Grok implement → Copilot review';
export const MOCK_DEMO_WORKFLOW_NAME = 'Mock implement → Mock review (demo)';
const LEGACY_GROK_CLAUDE_WORKFLOW_NAME = 'Grok implement → Claude review';
export const PIPELINE_REVIEWER_AGENT = 'copilot' as const;

export type { AgentLoopStepResult as PipelineStepResult, ReviewVerdict, PipelineOptions };
export type { LoopRetryPayload, LoopRetryMode };
export { parseReviewVerdict, enqueueLoopRetry, buildLoopRetryPayload };

export interface PipelineResult {
  item: WorkItem;
  steps: AgentLoopStepResult[];
  reviewVerdict: ReviewVerdict;
  iterations: number;
  loopStatus: LoopStatus;
  evalResults?: import('./eval-harness').EvalResult[];
  loopRunId?: string;
}

export interface LoopIterationRecord {
  id: string;
  iteration: number;
  verdict?: ReviewVerdict;
  implementAuditId?: string;
  reviewAuditId?: string;
  startedAt: string;
  completedAt?: string;
}

export interface WorkItemLoopHistory {
  workItemId: string;
  loopIteration: number;
  maxLoopIterations: number;
  loopStatus: LoopStatus;
  iterations: LoopIterationRecord[];
}

function grokCopilotWorkflowDefinition(): WorkflowDefinition {
  return {
    name: GROK_COPILOT_WORKFLOW_NAME,
    steps: [],
    loops: [
      {
        id: 'grok-copilot',
        until: 'eval_pass',
        maxIterations: 3,
        onExhausted: 'escalate',
        verdictParser: 'approved_changes_requested',
        evals: [
          { id: 'verdict', type: 'verdict_parse', config: { required: 'approved' } },
          { id: 'acceptance', type: 'acceptance_criteria' },
        ],
        steps: [
          {
            name: 'grok_implementation',
            agent: 'grok',
            capability: 'implementation',
            config: {
              prompt:
                'Implement the requested improvements. Write all files to the working directory. ' +
                'Do not only describe changes — apply them with file tools.',
            },
          },
          {
            name: 'test_validation',
            agent: 'copilot',
            capability: 'testing',
            config: {
              prompt:
                'Run or write tests for the implementation in the prior step. ' +
                'Report PASS or FAIL with a short summary of what was validated.',
            },
          },
          {
            name: 'copilot_review',
            agent: 'copilot',
            capability: 'review',
            config: {
              prompt:
                'Review the implementation in the prior step output and any files in context. ' +
                'Start with APPROVED or CHANGES_REQUESTED, then give detailed feedback.',
            },
          },
        ],
      },
    ],
  };
}

function mockDemoWorkflowDefinition(): WorkflowDefinition {
  const grokLoop = grokCopilotWorkflowDefinition().loops![0];
  return {
    name: MOCK_DEMO_WORKFLOW_NAME,
    steps: [],
    loops: [
      {
        ...grokLoop,
        id: 'mock-demo',
        steps: grokLoop.steps.map((step) => {
          if (step.capability === 'implementation') {
            return { ...step, agent: 'mock', name: 'mock_implementation' };
          }
          if (step.capability === 'testing') {
            return { ...step, agent: 'mock', name: 'mock_testing' };
          }
          if (step.capability === 'review') {
            return { ...step, agent: 'mock', name: 'mock_review' };
          }
          return { ...step, agent: 'mock' };
        }),
      },
    ],
  };
}

function getGrokCopilotLoop() {
  const workflowId = ensureGrokCopilotWorkflow();
  const workflow = getWorkflow(workflowId);
  const loop = workflow?.definition.loops?.[0];
  if (!loop) throw new Error('Grok → Copilot workflow loop not configured');
  return { workflowId, loop };
}

function getMockDemoLoop() {
  const workflows = listWorkflows();
  const definition = mockDemoWorkflowDefinition();
  const existing = workflows.find((w) => w.name === MOCK_DEMO_WORKFLOW_NAME);
  const workflowId = existing
    ? (updateWorkflow(existing.id, { definition }), existing.id)
    : createWorkflow(MOCK_DEMO_WORKFLOW_NAME, definition).id;
  const loop = getWorkflow(workflowId)?.definition.loops?.[0];
  if (!loop) throw new Error('Mock demo workflow loop not configured');
  return { workflowId, loop };
}

/** Apply sprint team staffing to workflow loop agent types. */
export function applySprintTeamToLoop(loop: WorkflowLoop, sprintId?: string): WorkflowLoop {
  if (!sprintId) return loop;

  const developer = resolveSprintAgent(sprintId, 'developer');
  const reviewer = resolveSprintAgent(sprintId, 'reviewer');
  const tester = resolveSprintAgent(sprintId, 'tester');

  const steps = loop.steps.map((step) => {
    const cap = step.capability ?? '';
    if (cap === 'implementation' && developer) {
      return { ...step, agent: developer.type, config: { ...step.config, agentId: developer.id } };
    }
    if (cap === 'review' && reviewer) {
      return { ...step, agent: reviewer.type, config: { ...step.config, agentId: reviewer.id } };
    }
    if (cap === 'testing' && tester) {
      return { ...step, agent: tester.type, config: { ...step.config, agentId: tester.id } };
    }
    return step;
  });

  return { ...loop, steps };
}

function resolvePipelineLoopOptions(
  options: PipelineOptions & LoopRetryPayload & { demo?: boolean }
): PipelineOptions & { demo?: boolean } {
  const reviewOnly = options.retryMode === 'review_only' || options.reviewOnly;
  return {
    ...options,
    reviewOnly,
    escalationContext: options.escalationContext,
    maxIterations: options.maxIterations,
    autoLoop: options.autoLoop,
    demo: options.demo,
  };
}

/** Run Grok implementation → Copilot review loop via the shared loop engine. */
export async function runWorkItemPipeline(
  id: string,
  options: PipelineOptions & LoopRetryPayload & { demo?: boolean } = {}
): Promise<PipelineResult> {
  const item = getWorkItem(id);
  const { workflowId, loop: baseLoop } = options.demo ? getMockDemoLoop() : getGrokCopilotLoop();
  const loop = applySprintTeamToLoop(baseLoop, item?.sprintId);
  const loopOptions = resolvePipelineLoopOptions(options);
  const result = await runAgentLoop({
    loop,
    workflowId,
    workItemId: id,
    workDir: options.workDir,
    options: loopOptions,
    jobId: options.jobId,
    executionLabel: 'grok-copilot',
  });

  return {
    item: result.workItem!,
    steps: result.steps,
    reviewVerdict: result.reviewVerdict,
    iterations: result.iterations,
    loopStatus: result.loopStatus,
    evalResults: result.evalResults,
    loopRunId: result.loopRunId,
  };
}

/** Reviewer harness pass on escalated deliverables; chains into implement loop when still blocked. */
export async function runWorkItemReviewRetry(
  id: string,
  options: { jobId?: string; autoChainFix?: boolean } = {}
): Promise<PipelineResult & { chainedJobId?: string }> {
  const item = getWorkItem(id);
  if (!item) throw new Error('Work item not found');

  const priorLoopStatus = item.loopStatus;
  const { workflowId } = getGrokCopilotLoop();
  const payload = buildLoopRetryPayload(id, priorLoopStatus, {
    retryMode: 'review_only',
    autoLoop: false,
    maxIterations: 1,
    autoChainFix: options.autoChainFix,
  });

  const result = await runWorkItemPipeline(id, {
    ...payload,
    jobId: options.jobId,
  });

  if (payload.autoChainFix !== false && (result.reviewVerdict === 'changes_requested' || result.loopStatus === 'escalated')) {
    const chained = enqueueLoopRetry(id, workflowId, {
      retryMode: 'escalation_continue',
      orchestrator: 'review_retry_chain',
      summary: `${item.key}: review requested changes — developer fix loop auto-queued`,
    });
    return { ...result, chainedJobId: chained.job.id };
  }

  return result;
}

export { enqueueWorkItemPipeline, getLoopJob } from './job-queue';

/** Summarize loop iteration history from work item activity. */
export function getWorkItemLoopHistory(workItemId: string): WorkItemLoopHistory {
  const item = getWorkItem(workItemId);
  if (!item) throw new Error('Work item not found');

  const activity = listWorkItemActivity(workItemId, 200);
  const iterations: LoopIterationRecord[] = [];

  for (const entry of activity) {
    if (entry.metadata?.event !== 'loop_iteration_completed') continue;
    const iter = entry.metadata.loopIteration ?? entry.metadata.iteration;
    if (typeof iter !== 'number') continue;

    iterations.push({
      id: entry.id,
      iteration: iter,
      verdict: entry.metadata.verdict as ReviewVerdict | undefined,
      implementAuditId: entry.metadata.implementAuditId as string | undefined,
      reviewAuditId: entry.metadata.reviewAuditId as string | undefined,
      startedAt: (entry.metadata.startedAt as string) || entry.createdAt,
      completedAt: entry.metadata.completedAt as string | undefined,
    });
  }

  return {
    workItemId,
    loopIteration: item.loopIteration,
    maxLoopIterations: item.maxLoopIterations,
    loopStatus: item.loopStatus,
    iterations: iterations.sort((a, b) => a.iteration - b.iteration),
  };
}

/** Ensure the Grok → Copilot workflow template exists (migrates legacy Claude workflow). */
export function ensureGrokCopilotWorkflow(): string {
  const workflows = listWorkflows();
  const definition = grokCopilotWorkflowDefinition();

  const current = workflows.find((w) => w.name === GROK_COPILOT_WORKFLOW_NAME);
  if (current) {
    updateWorkflow(current.id, { definition });
    return current.id;
  }

  const legacy = workflows.find((w) => w.name === LEGACY_GROK_CLAUDE_WORKFLOW_NAME);
  if (legacy) {
    updateWorkflow(legacy.id, { name: GROK_COPILOT_WORKFLOW_NAME, definition });
    return legacy.id;
  }

  return createWorkflow(GROK_COPILOT_WORKFLOW_NAME, definition).id;
}

/** @deprecated Use ensureGrokCopilotWorkflow */
export const ensureGrokClaudeWorkflow = ensureGrokCopilotWorkflow;

/** Create a demo work item for improving AgentHub. */
export function createAgentHubImprovementTask(sprintId?: string): WorkItem {
  return createWorkItem({
    type: 'task',
    title: 'Improve AgentHub project automatically',
    description:
      'Review the AgentHub codebase and suggest concrete improvements. ' +
      'Document findings in a markdown file `improvements.md` in the work directory with prioritized recommendations ' +
      '(bugs, UX, multi-agent orchestration, tests). Keep changes scoped and safe.',
    assignedAgentType: 'grok',
    sprintId,
    status: 'todo',
    acceptanceCriteria: [
      'improvements.md created in work directory',
      'At least 3 actionable recommendations',
      'Copilot review completes after Grok',
    ],
  });
}