import { getDatabase } from '../database';
import type { Capability, AgentType } from '../types';
import { generateId } from '../utils/helpers';
import { getAgentByName } from './agent-registry';

interface CapabilityRow {
  id: string;
  agent_id: string;
  name: string;
  description: string | null;
}

/** Default capability mappings per agent type. */
const DEFAULT_CAPABILITIES: Record<AgentType, Array<{ name: string; description: string }>> = {
  claude: [
    { name: 'planning', description: 'Task planning and decomposition' },
    { name: 'review', description: 'Code review and quality analysis' },
    { name: 'architecture', description: 'System architecture design' },
  ],
  grok: [
    { name: 'research', description: 'Technical research and investigation' },
    { name: 'analysis', description: 'Data and code analysis' },
  ],
  copilot: [
    { name: 'implementation', description: 'Code implementation' },
    { name: 'testing', description: 'Test writing and execution' },
  ],
  antigravity: [
    { name: 'implementation', description: 'Code implementation' },
    { name: 'refactoring', description: 'Code refactoring' },
  ],
  ollama: [
    { name: 'local-inference', description: 'Local LLM inference' },
    { name: 'privacy-sensitive', description: 'Privacy-sensitive local tasks' },
  ],
  mock: [
    { name: 'testing', description: 'Deterministic mock responses' },
    { name: 'planning', description: 'Mock planning for CI' },
    { name: 'implementation', description: 'Mock implementation for CI' },
  ],
};

const AGENT_NAME_MAP: Record<AgentType, string> = {
  claude: 'Claude Code',
  grok: 'Grok CLI',
  copilot: 'GitHub Copilot',
  antigravity: 'Antigravity',
  ollama: 'Ollama Local',
  mock: 'Mock Agent',
};

function mapCapability(row: CapabilityRow): Capability {
  return {
    id: row.id,
    agentId: row.agent_id,
    name: row.name,
    description: row.description ?? undefined,
  };
}

/** Seed default capabilities for registered agents. */
export function seedDefaultCapabilities(): void {
  const count = getDatabase().prepare('SELECT COUNT(*) as c FROM capability').get() as { c: number };
  if (count.c > 0) return;

  for (const [type, caps] of Object.entries(DEFAULT_CAPABILITIES) as Array<
    [AgentType, Array<{ name: string; description: string }>]
  >) {
    const agent = getAgentByName(AGENT_NAME_MAP[type]);
    if (!agent) continue;
    for (const cap of caps) {
      registerCapability(agent.id, cap.name, cap.description);
    }
  }
}

/** Replace an agent's capabilities with the defaults for an adapter type (e.g. after type switch). */
export function syncCapabilitiesForAgentType(agentId: string, type: AgentType): Capability[] {
  const db = getDatabase();
  db.prepare('DELETE FROM capability WHERE agent_id = ?').run(agentId);
  const caps = DEFAULT_CAPABILITIES[type] ?? [];
  for (const cap of caps) {
    registerCapability(agentId, cap.name, cap.description);
  }
  return getCapabilitiesForAgent(agentId);
}

/** Register a capability for an agent. */
export function registerCapability(
  agentId: string,
  name: string,
  description?: string
): Capability {
  const db = getDatabase();
  const existing = db
    .prepare('SELECT id FROM capability WHERE agent_id = ? AND name = ?')
    .get(agentId, name) as { id: string } | undefined;

  if (existing) {
    const row = db.prepare('SELECT * FROM capability WHERE id = ?').get(existing.id) as CapabilityRow;
    return mapCapability(row);
  }

  const id = generateId();
  db.prepare('INSERT INTO capability (id, agent_id, name, description) VALUES (?, ?, ?, ?)').run(
    id,
    agentId,
    name,
    description ?? null
  );

  return { id, agentId, name, description };
}

/** List all capabilities. */
export function listCapabilities(): Capability[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM capability ORDER BY name ASC')
    .all() as CapabilityRow[];
  return rows.map(mapCapability);
}

/** List capabilities for a specific agent. */
export function getCapabilitiesForAgent(agentId: string): Capability[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM capability WHERE agent_id = ? ORDER BY name ASC')
    .all(agentId) as CapabilityRow[];
  return rows.map(mapCapability);
}

/** Find enabled agents that have a given capability. */
export function findAgentsByCapability(capabilityName: string): Array<{
  agentId: string;
  agentName: string;
  agentType: AgentType;
  capability: Capability;
}> {
  const rows = getDatabase()
    .prepare(
      `SELECT c.id as cap_id, c.agent_id, c.name as cap_name, c.description,
              a.name as agent_name, a.type as agent_type
       FROM capability c
       JOIN agent a ON a.id = c.agent_id
       WHERE c.name = ? AND a.enabled = 1
       ORDER BY a.created_at ASC`
    )
    .all(capabilityName) as Array<{
    cap_id: string;
    agent_id: string;
    cap_name: string;
    description: string | null;
    agent_name: string;
    agent_type: string;
  }>;

  return rows.map((r) => ({
    agentId: r.agent_id,
    agentName: r.agent_name,
    agentType: r.agent_type as AgentType,
    capability: {
      id: r.cap_id,
      agentId: r.agent_id,
      name: r.cap_name,
      description: r.description ?? undefined,
    },
  }));
}

/** Get the capability registry as a map keyed by agent type. */
export function getCapabilityMap(): Record<string, string[]> {
  const rows = getDatabase()
    .prepare(
      `SELECT a.type, c.name FROM capability c
       JOIN agent a ON a.id = c.agent_id
       WHERE a.enabled = 1
       ORDER BY a.type, c.name`
    )
    .all() as Array<{ type: string; name: string }>;

  const map: Record<string, string[]> = {};
  for (const row of rows) {
    if (!map[row.type]) map[row.type] = [];
    map[row.type].push(row.name);
  }
  return map;
}