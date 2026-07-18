import path from 'path';
import { getAdapter } from '../adapters';
import type { AdapterOutput } from '../adapters';
import { detectContextInjectionRisk } from '../adapters/base';
import type { AgentType, ContextScope, ApprovalStatus, RetryPolicy } from '../types';
import { hashContext, hashContextFull, countScopeTokens, type ContextSummary } from './context-scope';
import { runPrivacyGuard } from './privacy-guard';
import {
  requiresApproval,
  createApprovalRequest,
  getApprovalRequest,
  ApprovalRequiredError,
} from './approval-gate';
import { logAuditEntry } from './audit-logger';
import { saveAuditSnapshot, resolveAuditSnapshotDir } from './audit-snapshot';
import { resolveHarnessProfile } from './harness-profile';
import { generateId } from '../utils/helpers';
import { getWorkspace } from './workspace';
import { getWorkItem } from './work-items';
import { assertAgentTypeWithinBudget } from './agent-credits';
import { resolveModelForAgent } from './agent-models';
import { incrementCounter } from '../metrics';
import { broadcast } from '../websocket';
import { now } from '../utils/helpers';

export class PrivacyBlockedError extends Error {
  readonly reasons: string[];

  constructor(reasons: string[]) {
    super(`Outbound request blocked by privacy guard: ${reasons.join('; ')}`);
    this.name = 'PrivacyBlockedError';
    this.reasons = reasons;
  }
}

export interface OutboundRequest {
  agentType: AgentType;
  prompt: string;
  contextScope: ContextScope;
  capability?: string;
  agentId?: string;
  workflowId?: string;
  task?: string;
  filePaths?: string[];
  basePath?: string;
  outputDir?: string;
  workspaceId?: string;
  approvalId?: string;
  workItemId?: string;
  pipelinePhase?: string;
  loopIteration?: number;
  retryPolicy?: RetryPolicy;
  contextSummary?: ContextSummary;
}

export class AgentUnavailableError extends Error {
  readonly agentType: AgentType;

  constructor(agentType: AgentType) {
    super(`Agent "${agentType}" is not available on this host (CLI missing or not authenticated)`);
    this.name = 'AgentUnavailableError';
    this.agentType = agentType;
  }
}

export interface OutboundResult {
  content: string;
  tokenCount: number;
  contextHash: string;
  agentType: AgentType;
  requestedAgentType: AgentType;
  fallbackFrom?: AgentType;
  degraded?: boolean;
  approvalStatus?: ApprovalStatus;
  auditId: string;
  contextSummary?: ContextSummary;
}

function isRetryableError(err: unknown, retryOn: RetryPolicy['retryOn']): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  if (retryOn.includes('timeout') && msg.includes('timed out')) return true;
  if (retryOn.includes('exit_nonzero') && msg.includes('exit')) return true;
  if (retryOn.includes('rate_limit') && msg.includes('rate')) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const AUDIT_CONTENT_PREVIEW_CHARS = 4096;

function previewAuditContent(content: string): { preview: string; contentLength: number } {
  if (content.length <= AUDIT_CONTENT_PREVIEW_CHARS) {
    return { preview: content, contentLength: content.length };
  }
  return {
    preview: `${content.slice(0, AUDIT_CONTENT_PREVIEW_CHARS)}\n… [truncated]`,
    contentLength: content.length,
  };
}

function resolvePermissionMode(
  profile: import('./harness-profile').HarnessProfile,
  pipelinePhase?: string,
  capability?: string
): string {
  const isReview = pipelinePhase === 'review' || capability === 'review';
  const isImplementation = pipelinePhase === 'implementation' || capability === 'implementation';
  // BA (analysis) / PM (planning) must write artifacts under the work item output dir.
  const isPlanning =
    pipelinePhase === 'planning' || capability === 'analysis' || capability === 'planning';
  const raw = isReview
    ? profile.reviewPermission
    : isImplementation || isPlanning
      ? profile.implementationPermission
      : profile.reviewPermission;
  return raw === 'readOnly' ? 'plan' : raw;
}

async function executeAdapterOnce(
  effectiveType: AgentType,
  request: OutboundRequest,
  effectiveScope: ContextScope,
  profile: import('./harness-profile').HarnessProfile
): Promise<AdapterOutput> {
  const adapter = getAdapter(effectiveType);
  const model = resolveModelForAgent(request.agentId, effectiveType);
  return adapter.execute({
    prompt: request.prompt,
    contextScope: effectiveScope,
    config: {
      capability: request.capability,
      cwd: request.outputDir || request.basePath || process.env.GROK_CWD || process.env.AGENTHUB_WORK_DIR,
      pipelinePhase: request.pipelinePhase,
      permissionMode: resolvePermissionMode(profile, request.pipelinePhase, request.capability),
      maxOutputBytes: profile.cliMaxOutputBytes,
      model,
      cliStream: request.workItemId
        ? {
            workItemId: request.workItemId,
            agentType: effectiveType,
            phase: request.pipelinePhase,
            loopIteration: request.loopIteration,
          }
        : undefined,
    },
  });
}

/**
 * Full outbound pipeline: ContextScope → Privacy Guard → Approval Gate → Agent → Audit Logger.
 * All outbound agent requests must pass through this pipeline.
 */
export async function executeOutboundPipeline(request: OutboundRequest): Promise<OutboundResult> {
  assertAgentTypeWithinBudget(request.agentType);
  const workItem = request.workItemId ? getWorkItem(request.workItemId) : null;
  const workspace = request.workspaceId ? getWorkspace(request.workspaceId) : null;
  const profile = resolveHarnessProfile(workspace, workItem);
  const retryPolicy = request.retryPolicy ?? profile.retryPolicy;

  const ctxHash = hashContext(request.contextScope);
  const ctxHashFull = hashContextFull(request.contextScope);
  const injectionRisk = detectContextInjectionRisk(request.contextScope);

  const privacy = runPrivacyGuard(
    request.contextScope,
    request.agentType,
    request.filePaths,
    request.basePath,
    request.workspaceId
  );

  if (!privacy.passed) {
    incrementCounter('agenthub_privacy_blocks_total', 'Requests blocked by privacy guard', {
      reason: 'secrets_or_policy',
    });

    logAuditEntry({
      agentId: request.agentId,
      workflowId: request.workflowId,
      workItemId: request.workItemId,
      loopIteration: request.loopIteration,
      pipelinePhase: request.pipelinePhase,
      agentType: request.agentType,
      task: request.task,
      contextHash: ctxHash,
      files: request.filePaths,
      tokenCount: 0,
      approvalStatus: 'rejected',
      responseMetadata: {
        blocked: true,
        reasons: privacy.blockedReasons,
        contextSummary: request.contextSummary,
        contextHashFull: ctxHashFull,
      },
    });

    throw new PrivacyBlockedError(privacy.blockedReasons);
  }

  let effectiveScope = privacy.sanitizedScope;
  let approvalStatus: ApprovalStatus | undefined;

  if (requiresApproval(effectiveScope.sensitivityLevel as 0 | 1 | 2 | 3) || privacy.requiresApproval) {
    if (request.approvalId) {
      const approval = getApprovalRequest(request.approvalId);
      if (!approval || (approval.status !== 'approved' && approval.status !== 'modified')) {
        throw new Error(`Approval ${request.approvalId} is not approved`);
      }
      if (approval.status === 'modified') {
        effectiveScope = approval.contextScope;
      }
      approvalStatus = approval.status;
    } else {
      const approvalRequest = createApprovalRequest(effectiveScope, request.workflowId, {
        workItemId: request.workItemId,
        summary: request.task,
      });
      throw new ApprovalRequiredError(approvalRequest);
    }
  }

  const requestedAgentType = request.agentType;
  let effectiveType: AgentType = requestedAgentType;
  let fallbackFrom: AgentType | undefined;
  let degraded = false;

  const adapter = getAdapter(effectiveType);
  if (!(await adapter.isAvailable())) {
    if (process.env.AGENTHUB_DISABLE_MOCK_FALLBACK === 'true') {
      throw new AgentUnavailableError(requestedAgentType);
    }
    fallbackFrom = requestedAgentType;
    effectiveType = 'mock';
    degraded = true;

    broadcast({
      type: 'agent:fallback',
      payload: {
        requestedAgent: requestedAgentType,
        fallbackAgent: 'mock',
        workItemId: request.workItemId,
        task: request.task,
      },
      timestamp: now(),
    });

    incrementCounter('agenthub_agent_fallbacks_total', 'Agent fallback to mock', {
      from: requestedAgentType,
    });
  }

  const attempts: Array<{ attempt: number; error?: string; success: boolean }> = [];
  let output: AdapterOutput | null = null;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt++) {
    try {
      output = await executeAdapterOnce(effectiveType, request, effectiveScope, profile);
      attempts.push({ attempt, success: true });
      break;
    } catch (err) {
      lastError = err as Error;
      attempts.push({ attempt, error: lastError.message, success: false });
      if (
        attempt < retryPolicy.maxAttempts &&
        isRetryableError(err, retryPolicy.retryOn) &&
        !(err instanceof PrivacyBlockedError) &&
        !(err instanceof ApprovalRequiredError) &&
        !(err instanceof AgentUnavailableError)
      ) {
        const backoff = retryPolicy.backoffMs[attempt - 1] ?? retryPolicy.backoffMs.at(-1) ?? 1000;
        await sleep(backoff);
        continue;
      }
      throw err;
    }
  }

  if (!output) {
    throw lastError ?? new Error('Outbound pipeline failed with no output');
  }

  incrementCounter('agenthub_agent_invocations_total', 'Total agent invocations', {
    agent: effectiveType,
    capability: request.capability || 'unknown',
  });
  incrementCounter('agenthub_tokens_total', 'Total tokens used', { type: 'prompt' }, countScopeTokens(effectiveScope));
  incrementCounter('agenthub_tokens_total', 'Total tokens used', { type: 'completion' }, output.tokenCount);

  if (request.contextSummary?.truncated.length || request.contextSummary?.dropped.length) {
    incrementCounter('agenthub_context_truncations_total', 'Context files truncated or dropped', {
      phase: request.pipelinePhase || 'unknown',
    });
  }

  const startMs = Date.now();
  incrementCounter(
    'agenthub_outbound_duration_seconds',
    'Outbound pipeline duration (counter proxy)',
    { agent: effectiveType, phase: request.pipelinePhase || 'unknown' },
    Math.max(1, Math.round((Date.now() - startMs) / 1000))
  );

  const auditId = generateId();
  const contextSnapshotPath = profile.auditSnapshots
    ? path.join(resolveAuditSnapshotDir(), `${auditId}.json.gz`)
    : undefined;

  if (profile.auditSnapshots) {
    try {
      saveAuditSnapshot(auditId, effectiveScope);
    } catch {
      /* snapshot is best-effort */
    }
  }

  const contentAudit = previewAuditContent(output.content);
  const resolvedModel = resolveModelForAgent(request.agentId, effectiveType);

  const auditEntry = logAuditEntry({
    id: auditId,
    agentId: request.agentId,
    workflowId: request.workflowId,
    workItemId: request.workItemId,
    loopIteration: request.loopIteration,
    pipelinePhase: request.pipelinePhase,
    agentType: effectiveType,
    task: request.task,
    contextHash: ctxHash,
    files: request.filePaths,
    tokenCount: output.tokenCount,
    cost: estimateCost(effectiveType, output.tokenCount),
    approvalStatus,
    responseMetadata: {
      adapter: effectiveType,
      requestedAgent: requestedAgentType,
      fallbackFrom,
      degraded,
      redacted: privacy.redacted ?? false,
      workItemId: request.workItemId,
      content: contentAudit.preview,
      contentLength: contentAudit.contentLength,
      capability: request.capability,
      contextSummary: request.contextSummary,
      contextHashFull: ctxHashFull,
      contextInjectionRisk: injectionRisk,
      harnessProfileHash: hashContext({ ...effectiveScope, maxTokens: profile.tokenBudget }),
      contextSnapshotPath,
      attempts,
      model: resolvedModel ?? output.metadata.model ?? undefined,
      ...output.metadata,
    },
  });

  return {
    content: output.content,
    tokenCount: output.tokenCount,
    contextHash: ctxHash,
    agentType: effectiveType,
    requestedAgentType,
    fallbackFrom,
    degraded,
    approvalStatus,
    auditId: auditEntry.id,
    contextSummary: request.contextSummary,
  };
}

/** Estimate cost in USD based on agent type and token count. */
function estimateCost(agentType: AgentType, tokenCount: number): number {
  const rates: Record<AgentType, number> = {
    claude: 0.000015,
    grok: 0.00001,
    copilot: 0.00001,
    antigravity: 0.00001,
    ollama: 0,
    mock: 0,
  };
  return (rates[agentType] || 0) * tokenCount;
}