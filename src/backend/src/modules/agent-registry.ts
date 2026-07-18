import { getDatabase } from '../database';
import type { Agent, AgentType, AgentStatus } from '../types';
import { generateId, now, parseJson } from '../utils/helpers';
import { broadcast } from '../websocket';

interface AgentRow {
  id: string;
  name: string;
  type: string;
  enabled: number;
  status: string;
  config: string;
  created_at: string;
}

const DEFAULT_AGENTS: Array<{ name: string; type: AgentType }> = [
  { name: 'Claude Code', type: 'claude' },
  { name: 'Grok CLI', type: 'grok' },
  { name: 'GitHub Copilot', type: 'copilot' },
  { name: 'Antigravity', type: 'antigravity' },
  { name: 'Ollama Local', type: 'ollama' },
  { name: 'Mock Agent', type: 'mock' },
];

function mapAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    type: row.type as AgentType,
    enabled: row.enabled === 1,
    status: row.status as AgentStatus,
    config: parseJson(row.config, {}),
    createdAt: row.created_at,
  };
}

function notifyStatusChange(agent: Agent): void {
  broadcast({
    type: 'agent:status',
    payload: { agentId: agent.id, name: agent.name, status: agent.status, enabled: agent.enabled },
    timestamp: now(),
  });
}

/** Seed default agents if the registry is empty. */
export function seedDefaultAgents(): void {
  const count = getDatabase().prepare('SELECT COUNT(*) as c FROM agent').get() as { c: number };
  if (count.c > 0) return;

  for (const { name, type } of DEFAULT_AGENTS) {
    registerAgent(name, type);
  }
}

/** Register a new agent dynamically. */
export function registerAgent(
  name: string,
  type: AgentType,
  config: Record<string, unknown> = {}
): Agent {
  const db = getDatabase();
  const existing = db.prepare('SELECT id FROM agent WHERE name = ?').get(name);
  if (existing) throw new Error(`Agent "${name}" already registered`);

  const id = generateId();
  const timestamp = now();

  db.prepare(
    `INSERT INTO agent (id, name, type, enabled, status, config, created_at)
     VALUES (?, ?, ?, 1, 'idle', ?, ?)`
  ).run(id, name, type, JSON.stringify(config), timestamp);

  const agent: Agent = { id, name, type, enabled: true, status: 'idle', config, createdAt: timestamp };
  notifyStatusChange(agent);
  return agent;
}

/** List all registered agents. */
export function listAgents(): Agent[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM agent ORDER BY created_at ASC')
    .all() as AgentRow[];
  return rows.map(mapAgent);
}

/** Get an agent by ID. */
export function getAgent(id: string): Agent | null {
  const row = getDatabase()
    .prepare('SELECT * FROM agent WHERE id = ?')
    .get(id) as AgentRow | undefined;
  return row ? mapAgent(row) : null;
}

/** Get an agent by name. */
export function getAgentByName(name: string): Agent | null {
  const row = getDatabase()
    .prepare('SELECT * FROM agent WHERE name = ?')
    .get(name) as AgentRow | undefined;
  return row ? mapAgent(row) : null;
}

/** Enable an agent. */
export function enableAgent(id: string): Agent | null {
  const agent = getAgent(id);
  if (!agent) return null;

  getDatabase()
    .prepare("UPDATE agent SET enabled = 1, status = 'idle' WHERE id = ?")
    .run(id);

  const updated = { ...agent, enabled: true, status: 'idle' as AgentStatus };
  notifyStatusChange(updated);
  return updated;
}

/** Disable an agent. */
export function disableAgent(id: string): Agent | null {
  const agent = getAgent(id);
  if (!agent) return null;

  getDatabase()
    .prepare("UPDATE agent SET enabled = 0, status = 'disabled' WHERE id = ?")
    .run(id);

  const updated = { ...agent, enabled: false, status: 'disabled' as AgentStatus };
  notifyStatusChange(updated);
  return updated;
}

/** Update agent runtime status. */
export function updateAgentStatus(id: string, status: AgentStatus): Agent | null {
  const agent = getAgent(id);
  if (!agent) return null;

  getDatabase().prepare('UPDATE agent SET status = ? WHERE id = ?').run(status, id);

  const updated = { ...agent, status };
  notifyStatusChange(updated);
  return updated;
}

/** Update agent configuration. Explicit `null` values remove keys (e.g. clear monthlyTokenQuota). */
export function updateAgentConfig(
  id: string,
  config: Record<string, unknown>
): Agent | null {
  const agent = getAgent(id);
  if (!agent) return null;

  const merged: Record<string, unknown> = { ...agent.config, ...config };
  for (const [key, value] of Object.entries(config)) {
    if (value === null) {
      delete merged[key];
    }
  }
  getDatabase().prepare('UPDATE agent SET config = ? WHERE id = ?').run(JSON.stringify(merged), id);
  return { ...agent, config: merged };
}

const VALID_AGENT_TYPES: AgentType[] = [
  'claude',
  'grok',
  'copilot',
  'antigravity',
  'ollama',
  'mock',
];

/** Provider calibration keys that do not transfer when switching adapter type. */
const PROVIDER_CALIBRATION_KEYS = [
  'providerUsagePercent',
  'providerCalibrationTokens',
  'providerCalibrationSource',
  'providerCalibratedAt',
  'monthlyTokenQuota',
] as const;

export interface UpdateAgentInput {
  type?: AgentType;
  name?: string;
  config?: Record<string, unknown>;
}

/**
 * Update agent identity/adapter and/or config.
 * Changing `type` (e.g. copilot → grok) switches the CLI used for this agent
 * while keeping the same agent id (sprint staffing and employment stay linked).
 */
export function updateAgent(id: string, updates: UpdateAgentInput): Agent | null {
  const agent = getAgent(id);
  if (!agent) return null;

  if (updates.type !== undefined && !VALID_AGENT_TYPES.includes(updates.type)) {
    throw new Error(`type must be one of: ${VALID_AGENT_TYPES.join(', ')}`);
  }

  const nextName = updates.name !== undefined ? updates.name.trim() : agent.name;
  if (!nextName) throw new Error('name must be a non-empty string');

  if (nextName !== agent.name) {
    const clash = getDatabase()
      .prepare('SELECT id FROM agent WHERE name = ? AND id != ?')
      .get(nextName, id) as { id: string } | undefined;
    if (clash) throw new Error(`Agent "${nextName}" already registered`);
  }

  const typeChanged = updates.type !== undefined && updates.type !== agent.type;
  const nextType = updates.type ?? agent.type;

  if (typeChanged && agent.status === 'running') {
    throw new Error(
      'Cannot change adapter while this agent is running. Wait for the current job to finish, then try again.'
    );
  }

  let nextConfig: Record<string, unknown> = { ...agent.config };
  if (updates.config) {
    nextConfig = { ...nextConfig, ...updates.config };
    for (const [key, value] of Object.entries(updates.config)) {
      if (value === null) delete nextConfig[key];
    }
  }

  if (typeChanged) {
    // Fresh provider quota tracking for the new adapter; keep creditLimit if set.
    for (const key of PROVIDER_CALIBRATION_KEYS) {
      if (!updates.config || !(key in updates.config)) {
        delete nextConfig[key];
      }
    }
    // Drop previous model unless the caller set one for the new type.
    if (!updates.config || !('model' in updates.config)) {
      delete nextConfig.model;
    }
  }

  getDatabase()
    .prepare('UPDATE agent SET name = ?, type = ?, config = ? WHERE id = ?')
    .run(nextName, nextType, JSON.stringify(nextConfig), id);

  const updated: Agent = {
    ...agent,
    name: nextName,
    type: nextType,
    config: nextConfig,
  };
  if (typeChanged || nextName !== agent.name) {
    notifyStatusChange(updated);
  }
  return updated;
}