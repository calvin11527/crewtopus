import type { LoopJob } from './job-queue';
import type { LoopStatus, WorkItem } from '../types';
import { getAuditEntry } from './audit-logger';
import { enqueueWorkItemPipeline, getActiveJobForWorkItem } from './job-queue';
import { listWorkItemActivity, logWorkItemActivity } from './work-item-activity';
import { WorkItemBusyError, isWorkItemBusy } from './work-item-guard';
import { getWorkItem, updateWorkItem } from './work-items';

export const TERMINAL_LOOP_STATUSES = new Set<LoopStatus>([
  'approved',
  'failed',
  'cancelled',
  'escalated',
]);

export type LoopRetryMode = 'full' | 'review_only' | 'escalation_continue';

export interface EscalationRetryContext {
  priorImplementation: string;
  reviewFeedback: string;
  implementAuditId?: string;
  reviewAuditId?: string;
}

export interface LoopRetryPayload {
  maxIterations?: number;
  autoLoop?: boolean;
  demo?: boolean;
  retryMode?: LoopRetryMode;
  escalationContext?: EscalationRetryContext;
  autoChainFix?: boolean;
}

export function isTerminalLoopStatus(status: LoopStatus): boolean {
  return TERMINAL_LOOP_STATUSES.has(status);
}

export function canRetryLoop(
  item: Pick<WorkItem, 'status' | 'loopStatus'>,
  hasActiveJob = false
): boolean {
  if (isWorkItemBusy(item, hasActiveJob)) return false;
  return isTerminalLoopStatus(item.loopStatus) || item.loopStatus === 'idle';
}

function auditContent(auditId?: string): string {
  if (!auditId) return '';
  const entry = getAuditEntry(auditId);
  const preview = entry?.responseMetadata?.content;
  return typeof preview === 'string' ? preview.trim() : '';
}

/** Recover the latest implement/review transcript from loop activity for harness-guided retries. */
export function getEscalationRetryContext(workItemId: string): EscalationRetryContext | null {
  const activity = listWorkItemActivity(workItemId, 200);

  let reviewFeedback = '';
  let reviewAuditId: string | undefined;
  let implementOutput = '';
  let implementAuditId: string | undefined;

  let harnessEvalFailures = '';

  for (const entry of activity) {
    if (entry.activityType === 'agent_completed') {
      const phase = entry.metadata?.pipelinePhase;
      if (phase === 'review' && !reviewFeedback) {
        reviewFeedback =
          (typeof entry.metadata?.content === 'string' ? entry.metadata.content : '') ||
          auditContent(entry.auditId);
        reviewAuditId = entry.auditId;
      }
      if (phase === 'implementation' && !implementOutput) {
        implementOutput =
          (typeof entry.metadata?.content === 'string' ? entry.metadata.content : '') ||
          auditContent(entry.auditId);
        implementAuditId = entry.auditId;
      }
    }

    if (entry.metadata?.event === 'loop_iteration_completed' && !reviewFeedback) {
      const verdict = entry.metadata.verdict;
      if (verdict === 'changes_requested' || verdict === 'unknown' || verdict === 'approved') {
        reviewAuditId = entry.metadata.reviewAuditId as string | undefined;
        reviewFeedback = auditContent(reviewAuditId) || reviewFeedback;
      }
      if (!implementOutput) {
        implementAuditId = entry.metadata.implementAuditId as string | undefined;
        implementOutput = auditContent(implementAuditId);
      }
    }

    if (
      !harnessEvalFailures &&
      (entry.metadata?.event === 'loop_eval_completed' ||
        entry.metadata?.event === 'loop_eval_blocked' ||
        entry.metadata?.event === 'loop_iteration_completed')
    ) {
      const evalResults = entry.metadata?.evalResults as
        | Array<{ evalId?: string; type?: string; passed?: boolean; details?: string }>
        | undefined;
      const failed = (evalResults ?? []).filter((e) => e && e.passed === false);
      if (failed.length > 0) {
        harnessEvalFailures = failed
          .map((e) => `- ${e.evalId ?? 'eval'} (${e.type ?? '?'}): ${e.details ?? 'failed'}`)
          .join('\n');
      }
    }
  }

  if (!reviewFeedback && !implementOutput && !harnessEvalFailures) return null;

  const feedbackParts = [
    reviewFeedback ||
      'Prior loop did not complete successfully — re-assess deliverables against acceptance criteria.',
  ];
  if (harnessEvalFailures) {
    feedbackParts.push(
      '',
      '## Harness eval failures (must fix before the loop can complete)',
      harnessEvalFailures
    );
  }

  return {
    priorImplementation:
      implementOutput ||
      'Prior implementation is in the work directory — re-read deliverable files before reviewing.',
    reviewFeedback: feedbackParts.join('\n'),
    implementAuditId,
    reviewAuditId,
  };
}

export function resolveRetryMode(priorLoopStatus: LoopStatus, requested?: LoopRetryMode): LoopRetryMode {
  if (requested) return requested;
  if (priorLoopStatus === 'escalated') return 'escalation_continue';
  return 'full';
}

export function buildLoopRetryPayload(
  workItemId: string,
  priorLoopStatus: LoopStatus,
  options: {
    maxIterations?: number;
    autoLoop?: boolean;
    demo?: boolean;
    retryMode?: LoopRetryMode;
    autoChainFix?: boolean;
  } = {}
): LoopRetryPayload {
  const retryMode = resolveRetryMode(priorLoopStatus, options.retryMode);
  const needsContext = retryMode === 'escalation_continue' || retryMode === 'review_only';
  const escalationContext = needsContext ? getEscalationRetryContext(workItemId) ?? undefined : undefined;

  return {
    maxIterations: options.maxIterations ?? (retryMode === 'review_only' ? 1 : 3),
    autoLoop: options.autoLoop ?? retryMode !== 'review_only',
    demo: options.demo,
    retryMode,
    escalationContext,
    autoChainFix: options.autoChainFix ?? true,
  };
}

/** Reset a terminal loop so a fresh harness run can start. */
export function prepareTerminalLoopRetry(workItemId: string): WorkItem {
  const item = getWorkItem(workItemId);
  if (!item) throw new Error('Work item not found');

  const activeJob = getActiveJobForWorkItem(workItemId);
  if (!canRetryLoop(item, Boolean(activeJob))) {
    throw new WorkItemBusyError(workItemId, `${item.key} cannot start a loop retry right now`);
  }

  return updateWorkItem(workItemId, {
    status: 'in_progress',
    loopStatus: 'idle',
    loopIteration: 0,
  })!;
}

export function enqueueLoopRetry(
  workItemId: string,
  workflowId: string,
  options: {
    maxIterations?: number;
    autoLoop?: boolean;
    demo?: boolean;
    retryMode?: LoopRetryMode;
    autoChainFix?: boolean;
    orchestrator?: string;
    summary?: string;
  } = {}
): { job: LoopJob; workItem: WorkItem; payload: LoopRetryPayload } {
  const before = getWorkItem(workItemId);
  if (!before) throw new Error('Work item not found');

  const priorLoopStatus = before.loopStatus;
  prepareTerminalLoopRetry(workItemId);

  const payload = buildLoopRetryPayload(workItemId, priorLoopStatus, options);
  const job = enqueueWorkItemPipeline(workItemId, workflowId, payload);
  updateWorkItem(workItemId, { loopStatus: 'running' });

  const orchestrator = options.orchestrator ?? 'loop_retry';
  logWorkItemActivity({
    workItemId,
    activityType: 'comment',
    summary:
      options.summary ??
      `Loop retry queued (${payload.retryMode ?? 'full'}) — job ${job.id.slice(0, 8)}…`,
    metadata: {
      event: 'loop_retry_enqueued',
      jobId: job.id,
      retryMode: payload.retryMode,
      orchestrator,
      priorLoopStatus,
    },
  });

  return { job, workItem: getWorkItem(workItemId)!, payload };
}

export function shouldAutoChainFixLoop(
  payload: LoopRetryPayload,
  loopStatus: LoopStatus,
  reviewVerdict: string,
  options?: { evalsPassed?: boolean }
): boolean {
  if (payload.autoChainFix === false) return false;
  if (payload.retryMode !== 'review_only') return false;
  // Already succeeded — do not re-queue work.
  if (loopStatus === 'approved' || loopStatus === 'cancelled') return false;

  // Reviewer wants changes, or harness escalated / failed the loop.
  if (loopStatus === 'escalated' || loopStatus === 'failed') return true;
  if (reviewVerdict === 'changes_requested') return true;

  // Reviewer APPROVED but acceptance / harness evals still block completion.
  // Previously this left the item at idle and looked "stuck successful".
  if (options?.evalsPassed === false) return true;

  return false;
}

/** True when harness evals ran and at least one failed (or none passed). */
export function evalsIndicateBlock(evalResults?: Array<{ passed: boolean }> | null): boolean {
  if (!evalResults || evalResults.length === 0) return false;
  return evalResults.some((e) => !e.passed);
}