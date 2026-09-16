import type { AgentType } from '../types';
import { getAgent } from './agent-registry';

export const AGENT_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh'] as const;
export type AgentEffortLevel = (typeof AGENT_EFFORT_LEVELS)[number];

const EFFORT_ENV: Partial<Record<AgentType, string>> = {
  grok: 'GROK_EFFORT',
  copilot: 'COPILOT_EFFORT',
  claude: 'CLAUDE_EFFORT',
};

const ALWAYS_APPROVE_ENV: Partial<Record<AgentType, string>> = {
  grok: 'GROK_ALWAYS_APPROVE',
  copilot: 'COPILOT_YOLO',
  claude: 'CLAUDE_SKIP_PERMISSIONS',
};

export function isAgentEffortLevel(value: unknown): value is AgentEffortLevel {
  return typeof value === 'string' && (AGENT_EFFORT_LEVELS as readonly string[]).includes(value);
}

export function parseEffortLevel(value: unknown): AgentEffortLevel | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (!isAgentEffortLevel(value)) return undefined;
  return value;
}

function envFlag(name: string | undefined): boolean | undefined {
  if (!name) return undefined;
  const raw = process.env[name];
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return undefined;
}

/** Reasoning effort for this outbound run (agent config → env → unset). */
export function resolveAgentEffort(
  agentId: string | undefined,
  agentType: AgentType,
  configEffort?: unknown
): AgentEffortLevel | undefined {
  const fromConfig = parseEffortLevel(configEffort);
  if (fromConfig) return fromConfig;

  if (agentId) {
    const fromAgent = parseEffortLevel(getAgent(agentId)?.config.effort);
    if (fromAgent) return fromAgent;
  }

  return parseEffortLevel(process.env[EFFORT_ENV[agentType] ?? '']);
}

/**
 * Whether the CLI should auto-approve tool executions.
 * Explicit agent config wins; otherwise env; Grok defaults on for unattended loops.
 */
export function resolveAlwaysApprove(
  agentId: string | undefined,
  agentType: AgentType,
  configAlwaysApprove?: unknown
): boolean {
  if (typeof configAlwaysApprove === 'boolean') return configAlwaysApprove;

  if (agentId) {
    const configured = getAgent(agentId)?.config.alwaysApprove;
    if (typeof configured === 'boolean') return configured;
  }

  const fromEnv = envFlag(ALWAYS_APPROVE_ENV[agentType]);
  if (fromEnv !== undefined) return fromEnv;

  return agentType === 'grok';
}

export function validateEffortConfig(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (!isAgentEffortLevel(value)) {
    return `effort must be one of: ${AGENT_EFFORT_LEVELS.join(', ')}`;
  }
  return null;
}

export function validateAlwaysApproveConfig(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'boolean') return 'alwaysApprove must be a boolean';
  return null;
}
