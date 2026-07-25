/**
 * Agent Capability Knowledge Base — learn adapter features over time and
 * surface opt-in improvement suggestions (never silent config rewrites).
 */
import { spawnSync } from 'child_process';
import { getDatabase } from '../database';
import { listAgents, updateAgentConfig, getAgent } from './agent-registry';
import { getAgentCreditUsage } from './agent-credits';
import { generateId, now, parseJson } from '../utils/helpers';
import type { AgentType } from '../types';
import { broadcast } from '../websocket';

export type CapabilityFactSource =
  | 'help_probe'
  | 'run_outcome'
  | 'error'
  | 'manual'
  | 'seed'
  | 'usage';

export type SuggestionSeverity = 'info' | 'warn' | 'critical';
export type SuggestionStatus = 'open' | 'applied' | 'dismissed';

export interface CapabilityFact {
  id: string;
  agentType: AgentType;
  factKey: string;
  factValue: unknown;
  confidence: number;
  source: CapabilityFactSource;
  observedAt: string;
  lastConfirmedAt: string;
}

export interface ImprovementSuggestion {
  id: string;
  agentType: AgentType | null;
  title: string;
  body: string;
  severity: SuggestionSeverity;
  status: SuggestionStatus;
  evidence: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface FactRow {
  id: string;
  agent_type: string;
  fact_key: string;
  fact_value: string;
  confidence: number;
  source: string;
  observed_at: string;
  last_confirmed_at: string;
}

interface SuggestionRow {
  id: string;
  agent_type: string | null;
  title: string;
  body: string;
  severity: string;
  status: string;
  evidence: string;
  created_at: string;
  updated_at: string;
}

function mapFact(row: FactRow): CapabilityFact {
  return {
    id: row.id,
    agentType: row.agent_type as AgentType,
    factKey: row.fact_key,
    factValue: parseJson(row.fact_value, null),
    confidence: row.confidence,
    source: row.source as CapabilityFactSource,
    observedAt: row.observed_at,
    lastConfirmedAt: row.last_confirmed_at,
  };
}

function mapSuggestion(row: SuggestionRow): ImprovementSuggestion {
  return {
    id: row.id,
    agentType: (row.agent_type as AgentType) || null,
    title: row.title,
    body: row.body,
    severity: row.severity as SuggestionSeverity,
    status: row.status as SuggestionStatus,
    evidence: parseJson(row.evidence, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Upsert a learned fact (same agent_type + fact_key). */
export function upsertCapabilityFact(input: {
  agentType: AgentType;
  factKey: string;
  factValue: unknown;
  confidence?: number;
  source: CapabilityFactSource;
}): CapabilityFact {
  const db = getDatabase();
  const timestamp = now();
  const existing = db
    .prepare('SELECT * FROM agent_capability_fact WHERE agent_type = ? AND fact_key = ?')
    .get(input.agentType, input.factKey) as FactRow | undefined;

  if (existing) {
    db.prepare(
      `UPDATE agent_capability_fact
       SET fact_value = ?, confidence = ?, source = ?, last_confirmed_at = ?
       WHERE id = ?`
    ).run(
      JSON.stringify(input.factValue),
      input.confidence ?? existing.confidence,
      input.source,
      timestamp,
      existing.id
    );
    return mapFact(
      db.prepare('SELECT * FROM agent_capability_fact WHERE id = ?').get(existing.id) as FactRow
    );
  }

  const id = generateId();
  db.prepare(
    `INSERT INTO agent_capability_fact
     (id, agent_type, fact_key, fact_value, confidence, source, observed_at, last_confirmed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.agentType,
    input.factKey,
    JSON.stringify(input.factValue),
    input.confidence ?? 0.7,
    input.source,
    timestamp,
    timestamp
  );
  return mapFact(db.prepare('SELECT * FROM agent_capability_fact WHERE id = ?').get(id) as FactRow);
}

export function listCapabilityFacts(agentType?: AgentType): CapabilityFact[] {
  const db = getDatabase();
  const rows = agentType
    ? (db
        .prepare('SELECT * FROM agent_capability_fact WHERE agent_type = ? ORDER BY fact_key')
        .all(agentType) as FactRow[])
    : (db
        .prepare('SELECT * FROM agent_capability_fact ORDER BY agent_type, fact_key')
        .all() as FactRow[]);
  return rows.map(mapFact);
}

export function listImprovementSuggestions(status: SuggestionStatus | 'all' = 'open'): ImprovementSuggestion[] {
  const db = getDatabase();
  const rows =
    status === 'all'
      ? (db
          .prepare('SELECT * FROM agent_improvement_suggestion ORDER BY created_at DESC LIMIT 100')
          .all() as SuggestionRow[])
      : (db
          .prepare(
            'SELECT * FROM agent_improvement_suggestion WHERE status = ? ORDER BY created_at DESC LIMIT 100'
          )
          .all(status) as SuggestionRow[]);
  return rows.map(mapSuggestion);
}

function findOpenSuggestion(title: string, agentType: AgentType | null): ImprovementSuggestion | null {
  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT * FROM agent_improvement_suggestion
       WHERE status = 'open' AND title = ? AND IFNULL(agent_type, '') = IFNULL(?, '')
       LIMIT 1`
    )
    .get(title, agentType) as SuggestionRow | undefined;
  return row ? mapSuggestion(row) : null;
}

export function createImprovementSuggestion(input: {
  agentType?: AgentType | null;
  title: string;
  body: string;
  severity?: SuggestionSeverity;
  evidence?: Record<string, unknown>;
}): ImprovementSuggestion {
  const existing = findOpenSuggestion(input.title, input.agentType ?? null);
  if (existing) {
    const db = getDatabase();
    const timestamp = now();
    db.prepare(
      `UPDATE agent_improvement_suggestion
       SET body = ?, severity = ?, evidence = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      input.body,
      input.severity ?? existing.severity,
      JSON.stringify(input.evidence ?? existing.evidence),
      timestamp,
      existing.id
    );
    return mapSuggestion(
      db.prepare('SELECT * FROM agent_improvement_suggestion WHERE id = ?').get(existing.id) as SuggestionRow
    );
  }

  const db = getDatabase();
  const id = generateId();
  const timestamp = now();
  db.prepare(
    `INSERT INTO agent_improvement_suggestion
     (id, agent_type, title, body, severity, status, evidence, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)`
  ).run(
    id,
    input.agentType ?? null,
    input.title,
    input.body,
    input.severity ?? 'info',
    JSON.stringify(input.evidence ?? {}),
    timestamp,
    timestamp
  );

  const suggestion = mapSuggestion(
    db.prepare('SELECT * FROM agent_improvement_suggestion WHERE id = ?').get(id) as SuggestionRow
  );

  broadcast({
    type: 'capability:suggestion',
    payload: { suggestionId: suggestion.id, title: suggestion.title, agentType: suggestion.agentType },
    timestamp,
  });

  return suggestion;
}

export function setSuggestionStatus(
  id: string,
  status: SuggestionStatus
): ImprovementSuggestion | null {
  const db = getDatabase();
  const existing = db
    .prepare('SELECT * FROM agent_improvement_suggestion WHERE id = ?')
    .get(id) as SuggestionRow | undefined;
  if (!existing) return null;
  const timestamp = now();
  db.prepare(
    `UPDATE agent_improvement_suggestion SET status = ?, updated_at = ? WHERE id = ?`
  ).run(status, timestamp, id);
  return mapSuggestion(
    db.prepare('SELECT * FROM agent_improvement_suggestion WHERE id = ?').get(id) as SuggestionRow
  );
}

/** Parse common CLI --help flags/models from free text. */
export function parseHelpText(helpText: string): {
  flags: string[];
  models: string[];
  mentions: string[];
} {
  const flags = new Set<string>();
  const models = new Set<string>();
  const mentions = new Set<string>();

  for (const m of helpText.matchAll(/--[a-z0-9][a-z0-9-]*/gi)) {
    flags.add(m[0].toLowerCase());
  }

  // Common model-ish tokens
  for (const m of helpText.matchAll(
    /\b(grok-[\w.-]+|gpt-[\w.-]+|claude-[\w.-]+|o\d[\w.-]*|gemini-[\w.-]+|llama[\w.-]*)\b/gi
  )) {
    models.add(m[1]);
  }

  for (const keyword of [
    'permission',
    'yolo',
    'plan',
    'workspace',
    'mcp',
    'stream',
    'session',
    'model',
    'quota',
    'usage',
  ]) {
    if (helpText.toLowerCase().includes(keyword)) mentions.add(keyword);
  }

  return {
    flags: [...flags].sort().slice(0, 80),
    models: [...models].sort().slice(0, 40),
    mentions: [...mentions].sort(),
  };
}

const CLI_CANDIDATES: Partial<Record<AgentType, string[]>> = {
  grok: [process.env.GROK_CLI || 'grok'],
  copilot: [process.env.COPILOT_CLI || 'copilot'],
  claude: [process.env.CLAUDE_CLI || 'claude'],
  ollama: [process.env.OLLAMA_CLI || 'ollama'],
  mock: [],
  antigravity: [process.env.ANTIGRAVITY_CLI || 'antigravity'],
};

function probeCliHelp(bin: string): string | null {
  try {
    const r = spawnSync(bin, ['--help'], {
      encoding: 'utf-8',
      timeout: 8_000,
      env: process.env,
    });
    const text = `${r.stdout || ''}\n${r.stderr || ''}`.trim();
    return text.length > 20 ? text : null;
  } catch {
    return null;
  }
}

/** Seed static knowledge + optional CLI --help probes. */
export function probeAgentCapabilities(agentTypes?: AgentType[]): {
  facts: CapabilityFact[];
  probed: AgentType[];
} {
  const types =
    agentTypes ??
    (['claude', 'grok', 'copilot', 'antigravity', 'ollama', 'mock'] as AgentType[]);
  const facts: CapabilityFact[] = [];
  const probed: AgentType[] = [];

  // Static seeds (always available)
  const seeds: Array<{ type: AgentType; key: string; value: unknown }> = [
    {
      type: 'mock',
      key: 'modes',
      value: ['planning', 'implementation', 'testing', 'review'],
    },
    {
      type: 'mock',
      key: 'requires_cli',
      value: false,
    },
    {
      type: 'grok',
      key: 'usage_tracking',
      value: {
        method: 'agenthub_audit_plus_dashboard_calibration',
        note: 'No public live billing API for Grok CLI subscription',
      },
    },
    {
      type: 'copilot',
      key: 'usage_tracking',
      value: {
        method: 'session_shutdown_events',
        path: '~/.copilot/session-state/*/events.jsonl',
      },
    },
    {
      type: 'ollama',
      key: 'usage_tracking',
      value: { method: 'unlimited_local', note: 'Local models — no paid quota' },
    },
  ];

  for (const s of seeds) {
    if (!types.includes(s.type)) continue;
    facts.push(
      upsertCapabilityFact({
        agentType: s.type,
        factKey: s.key,
        factValue: s.value,
        confidence: 0.95,
        source: 'seed',
      })
    );
  }

  for (const type of types) {
    const bins = CLI_CANDIDATES[type] ?? [];
    for (const bin of bins) {
      const help = probeCliHelp(bin);
      if (!help) continue;
      probed.push(type);
      const parsed = parseHelpText(help);
      facts.push(
        upsertCapabilityFact({
          agentType: type,
          factKey: 'cli_binary',
          factValue: bin,
          confidence: 0.9,
          source: 'help_probe',
        })
      );
      facts.push(
        upsertCapabilityFact({
          agentType: type,
          factKey: 'cli_flags',
          factValue: parsed.flags,
          confidence: 0.75,
          source: 'help_probe',
        })
      );
      if (parsed.models.length) {
        facts.push(
          upsertCapabilityFact({
            agentType: type,
            factKey: 'cli_models_mentioned',
            factValue: parsed.models,
            confidence: 0.6,
            source: 'help_probe',
          })
        );
      }
      facts.push(
        upsertCapabilityFact({
          agentType: type,
          factKey: 'cli_help_topics',
          factValue: parsed.mentions,
          confidence: 0.7,
          source: 'help_probe',
        })
      );
      break;
    }
  }

  return { facts, probed };
}

/** Learn from a completed or failed agent run. */
export function recordRunLearning(input: {
  agentType: AgentType;
  success: boolean;
  tokenCount?: number;
  errorMessage?: string;
  capability?: string;
  model?: string;
}): void {
  const type = input.agentType;
  upsertCapabilityFact({
    agentType: type,
    factKey: 'last_run',
    factValue: {
      success: input.success,
      tokenCount: input.tokenCount ?? 0,
      capability: input.capability,
      model: input.model,
      at: now(),
      error: input.errorMessage?.slice(0, 300),
    },
    confidence: 0.85,
    source: input.success ? 'run_outcome' : 'error',
  });

  if (input.model) {
    upsertCapabilityFact({
      agentType: type,
      factKey: `model_seen:${input.model}`,
      factValue: { lastSeen: now(), ok: input.success },
      confidence: 0.8,
      source: 'run_outcome',
    });
  }

  if (!input.success && input.errorMessage) {
    const msg = input.errorMessage.toLowerCase();
    if (/rate|quota|budget|429|throttl/.test(msg)) {
      createImprovementSuggestion({
        agentType: type,
        title: `${type}: provider throttle / quota signal`,
        body:
          `Recent ${type} run hit a rate limit or quota error. ` +
          `On Agents → Configure, switch the adapter type (e.g. copilot → grok) or raise/clear limits, ` +
          `then re-run. Crewtopus cannot always read the remote billing dashboard live.`,
        severity: 'critical',
        evidence: { error: input.errorMessage.slice(0, 400) },
      });
    } else if (/not found|unknown model|invalid model/.test(msg)) {
      createImprovementSuggestion({
        agentType: type,
        title: `${type}: model not available`,
        body: `A run failed with a model error. Pick a model from the catalog on the Agents page, or re-probe capabilities.`,
        severity: 'warn',
        evidence: { error: input.errorMessage.slice(0, 400), model: input.model },
      });
    } else if (/auth|login|unauthorized|not authenticated/.test(msg)) {
      createImprovementSuggestion({
        agentType: type,
        title: `${type}: authentication required`,
        body: `CLI appears unauthenticated. Log in with the provider CLI, then retry.`,
        severity: 'warn',
        evidence: { error: input.errorMessage.slice(0, 400) },
      });
    }
  }
}

/** Derive suggestions from current credit usage (adapter switch, calibrate, etc.). */
export function generateUsageBasedSuggestions(): ImprovementSuggestion[] {
  const created: ImprovementSuggestion[] = [];
  const usage = getAgentCreditUsage();
  const agents = listAgents();
  const enabledTypes = new Set(agents.filter((a) => a.enabled).map((a) => a.type));

  for (const entry of usage) {
    if (entry.overBudget || entry.percentageUsed >= 90) {
      const alternatives = (['copilot', 'grok', 'claude', 'ollama', 'mock'] as AgentType[]).filter(
        (t) => t !== entry.agentType && enabledTypes.has(t)
      );
      const alt = alternatives[0];
      created.push(
        createImprovementSuggestion({
          agentType: entry.agentType,
          title: `${entry.agentType}: near or over usage limit`,
          body: alt
            ? `${entry.agentType} is at ${entry.percentageUsed}% usage. Switch staffed roles or agent adapter to ${alt} so work continues. Use Sync now on credits after real CLI activity.`
            : `${entry.agentType} is at ${entry.percentageUsed}% usage. Raise monthlyTokenQuota, re-calibrate dashboard %, or enable another adapter type.`,
          severity: entry.overBudget ? 'critical' : 'warn',
          evidence: {
            percentageUsed: entry.percentageUsed,
            trackingSource: entry.trackingSource,
            alternative: alt,
          },
        })
      );
    }

    if (entry.agentType === 'grok' && entry.trackingSource !== 'dashboard_primary') {
      created.push(
        createImprovementSuggestion({
          agentType: 'grok',
          title: 'Grok: sync SuperGrok weekly % from grok.com',
          body:
            'SuperGrok uses a weekly shared limit (Build + Conversation), not monthly audit tokens. ' +
            'On Credit Usage, open “Sync SuperGrok” and enter overall %, Build %, Conversation %, and reset time from the site (e.g. 61% = Build 59% + Conversation 2%).',
          severity: 'info',
          evidence: { tokenCount: entry.tokenCount, trackingSource: entry.trackingSource },
        })
      );
    }
  }

  return created;
}

/** Apply a safe suggestion (currently: adapter type switch on a named agent). */
export function applyImprovementSuggestion(id: string): {
  suggestion: ImprovementSuggestion;
  applied: Record<string, unknown>;
} {
  const suggestion = listImprovementSuggestions('all').find((s) => s.id === id);
  if (!suggestion) throw new Error('Suggestion not found');
  if (suggestion.status !== 'open') throw new Error('Suggestion is not open');

  const applied: Record<string, unknown> = {};
  const alt = suggestion.evidence.alternative as string | undefined;

  if (alt && suggestion.agentType) {
    // Switch first matching agent of this type to the alternative adapter type via config note
    // (type is a first-class column — use updateAgent if available; store preferredFailover).
    const agents = listAgents().filter((a) => a.type === suggestion.agentType);
    for (const agent of agents) {
      updateAgentConfig(agent.id, {
        preferredFailoverType: alt,
        lastImprovementAppliedAt: now(),
        lastImprovementId: id,
      });
      applied[agent.id] = { preferredFailoverType: alt };
    }
  }

  const updated = setSuggestionStatus(id, 'applied');
  if (!updated) throw new Error('Failed to update suggestion');
  return { suggestion: updated, applied };
}

export function seedCapabilityLearning(): void {
  probeAgentCapabilities(['mock', 'grok', 'copilot', 'ollama', 'claude']);
  generateUsageBasedSuggestions();
}

/** Periodic tick: re-generate usage suggestions (probes are heavier — on demand). */
export function capabilityLearningTick(): void {
  generateUsageBasedSuggestions();
}

/** Resolve preferred failover from agent config if present. */
export function getPreferredFailover(agentId: string): AgentType | undefined {
  const agent = getAgent(agentId);
  const v = agent?.config?.preferredFailoverType;
  if (typeof v === 'string' && v) return v as AgentType;
  return undefined;
}
