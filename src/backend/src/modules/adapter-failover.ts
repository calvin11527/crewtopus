/**
 * Automatic adapter failover when a provider is over budget / throttled.
 * Never silently switches without a preferred target or an enabled alternative.
 */
import type { AgentType } from '../types';
import { isAgentTypeOverBudget } from './agent-credits';
import { getThrottleSignal } from './usage-meter';
import { getAgent, listAgents } from './agent-registry';
import { logWorkItemActivity } from './work-item-activity';
import { broadcast } from '../websocket';
import { now } from '../utils/helpers';

const FAILOVER_ORDER: AgentType[] = ['copilot', 'grok', 'claude', 'ollama', 'mock'];

export function isAgentTypeBlocked(agentType: AgentType): boolean {
  if (isAgentTypeOverBudget(agentType)) return true;
  const t = getThrottleSignal(agentType);
  return t?.state === 'quota_exceeded';
}

export function pickFailoverType(
  from: AgentType,
  preferred?: AgentType | string | null,
  options: { allowMock?: boolean } = {}
): AgentType | null {
  const allowMock = options.allowMock === true;
  const preferredType = preferred as AgentType | undefined;
  if (preferredType && preferredType !== from && !isAgentTypeBlocked(preferredType)) {
    if (preferredType === 'mock') {
      if (allowMock) return 'mock';
    } else {
      const hasEnabled = listAgents().some((a) => a.type === preferredType && a.enabled);
      if (hasEnabled) return preferredType;
    }
  }

  for (const type of FAILOVER_ORDER) {
    if (type === from) continue;
    if (isAgentTypeBlocked(type)) continue;
    if (type === 'mock') {
      if (allowMock) return 'mock';
      continue;
    }
    if (listAgents().some((a) => a.type === type && a.enabled)) return type;
  }
  return null;
}

export interface FailoverResolution {
  agentType: AgentType;
  requestedType: AgentType;
  failedOver: boolean;
  reason?: string;
}

/**
 * Resolve which adapter type to run for this request only.
 * Never rewrites the staffed agent row — failover is per-run.
 */
export function resolveOutboundAgentType(input: {
  requestedType: AgentType;
  agentId?: string;
  workItemId?: string;
  allowFailover?: boolean;
  allowMock?: boolean;
}): FailoverResolution {
  const allow = input.allowFailover !== false;
  const requested = input.requestedType;

  if (!isAgentTypeBlocked(requested)) {
    return { agentType: requested, requestedType: requested, failedOver: false };
  }

  if (!allow) {
    return { agentType: requested, requestedType: requested, failedOver: false };
  }

  const agent = input.agentId ? getAgent(input.agentId) : undefined;
  const preferred =
    (agent?.config?.preferredFailoverType as string | undefined) ||
    process.env.CREWTOPUS_DEFAULT_FAILOVER ||
    process.env.AGENTHUB_DEFAULT_FAILOVER;

  const next = pickFailoverType(requested, preferred, { allowMock: input.allowMock === true });
  if (!next) {
    return { agentType: requested, requestedType: requested, failedOver: false };
  }

  const reason = `${requested} blocked (quota/budget) → auto-failover to ${next}`;
  if (input.workItemId) {
    logWorkItemActivity({
      workItemId: input.workItemId,
      activityType: 'comment',
      summary: reason,
      agentType: next,
      agentId: input.agentId,
      metadata: { event: 'adapter_auto_failover', from: requested, to: next },
    });
  }

  broadcast({
    type: 'agent:fallback',
    payload: {
      requestedAgent: requested,
      fallbackAgent: next,
      reason: 'auto_failover_quota',
      workItemId: input.workItemId,
      auto: true,
    },
    timestamp: now(),
  });

  return {
    agentType: next,
    requestedType: requested,
    failedOver: true,
    reason,
  };
}
