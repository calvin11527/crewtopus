import { getDatabase } from '../database';
import type { AgentType, ConsensusMode, ConsensusSession, ConsensusStatus, ConsensusVote } from '../types';
import { generateId, now, parseJson } from '../utils/helpers';
import { broadcast } from '../websocket';
import { getAdapter } from '../adapters';
import { buildContextScope } from './context-scope';
import { executeOutboundPipeline } from './outbound-pipeline';

interface SessionRow {
  id: string;
  workflow_id: string | null;
  mode: string;
  status: string;
  question: string;
  config: string;
  decision: string | null;
  decision_source: string | null;
  created_at: string;
  resolved_at: string | null;
}

interface VoteRow {
  id: string;
  session_id: string;
  agent_id: string | null;
  agent_type: string;
  opinion: string;
  weight: number;
  created_at: string;
}

const DEFAULT_AGENT_WEIGHTS: Record<AgentType, number> = {
  claude: 1.5,
  grok: 1.2,
  copilot: 1.0,
  antigravity: 1.0,
  ollama: 0.8,
  mock: 0.5,
};

function mapSession(row: SessionRow): ConsensusSession {
  return {
    id: row.id,
    workflowId: row.workflow_id ?? undefined,
    mode: row.mode as ConsensusMode,
    status: row.status as ConsensusStatus,
    question: row.question,
    config: parseJson(row.config, {}),
    decision: row.decision ?? undefined,
    decisionSource: row.decision_source ?? undefined,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? undefined,
  };
}

function mapVote(row: VoteRow): ConsensusVote {
  return {
    id: row.id,
    sessionId: row.session_id,
    agentId: row.agent_id ?? undefined,
    agentType: row.agent_type as AgentType,
    opinion: row.opinion,
    weight: row.weight,
    createdAt: row.created_at,
  };
}

/** Create a new consensus session. */
export function createSession(
  question: string,
  mode: ConsensusMode,
  config: Record<string, unknown> = {},
  workflowId?: string
): ConsensusSession {
  const id = generateId();
  const timestamp = now();

  getDatabase()
    .prepare(
      `INSERT INTO consensus_session (id, workflow_id, mode, status, question, config, created_at)
       VALUES (?, ?, ?, 'open', ?, ?, ?)`
    )
    .run(id, workflowId ?? null, mode, question, JSON.stringify(config), timestamp);

  const session: ConsensusSession = {
    id,
    workflowId,
    mode,
    status: 'open',
    question,
    config,
    createdAt: timestamp,
  };

  broadcast({
    type: 'consensus:update',
    payload: { sessionId: id, status: 'open', mode },
    timestamp: now(),
  });

  return session;
}

/** Get a consensus session with its votes. */
export function getSession(id: string): (ConsensusSession & { votes: ConsensusVote[] }) | null {
  const row = getDatabase()
    .prepare('SELECT * FROM consensus_session WHERE id = ?')
    .get(id) as SessionRow | undefined;
  if (!row) return null;

  const votes = listVotes(id);
  return { ...mapSession(row), votes };
}

/** List all consensus sessions. */
export function listSessions(status?: ConsensusStatus): ConsensusSession[] {
  const db = getDatabase();
  const rows = status
    ? (db.prepare('SELECT * FROM consensus_session WHERE status = ? ORDER BY created_at DESC').all(status) as SessionRow[])
    : (db.prepare('SELECT * FROM consensus_session ORDER BY created_at DESC').all() as SessionRow[]);
  return rows.map(mapSession);
}

/** Submit a vote/opinion to a consensus session. */
export function submitVote(
  sessionId: string,
  agentType: AgentType,
  opinion: string,
  weight?: number,
  agentId?: string
): ConsensusVote | null {
  const session = getSession(sessionId);
  if (!session || session.status !== 'open') return null;

  const id = generateId();
  const timestamp = now();
  const effectiveWeight = weight ?? DEFAULT_AGENT_WEIGHTS[agentType] ?? 1.0;

  getDatabase()
    .prepare(
      `INSERT INTO consensus_vote (id, session_id, agent_id, agent_type, opinion, weight, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, sessionId, agentId ?? null, agentType, opinion, effectiveWeight, timestamp);

  const vote: ConsensusVote = {
    id,
    sessionId,
    agentId,
    agentType,
    opinion,
    weight: effectiveWeight,
    createdAt: timestamp,
  };

  broadcast({
    type: 'consensus:update',
    payload: { sessionId, action: 'vote_submitted', agentType, voteId: id },
    timestamp: now(),
  });

  return vote;
}

/** List votes for a session. */
export function listVotes(sessionId: string): ConsensusVote[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM consensus_vote WHERE session_id = ? ORDER BY created_at ASC')
    .all(sessionId) as VoteRow[];
  return rows.map(mapVote);
}

/** Resolve a consensus session using the configured mode. */
export function resolveSession(sessionId: string): ConsensusSession | null {
  const session = getSession(sessionId);
  if (!session || session.status !== 'open') return null;

  const { decision, source } = computeDecision(session);
  const timestamp = now();

  getDatabase()
    .prepare(
      `UPDATE consensus_session SET status = 'resolved', decision = ?, decision_source = ?, resolved_at = ? WHERE id = ?`
    )
    .run(decision, source, timestamp, sessionId);

  const resolved: ConsensusSession = {
    ...session,
    status: 'resolved',
    decision,
    decisionSource: source,
    resolvedAt: timestamp,
  };

  broadcast({
    type: 'consensus:update',
    payload: { sessionId, status: 'resolved', decision, decisionSource: source },
    timestamp: now(),
  });

  return resolved;
}

/** Escalate a session to human review. */
export function escalateToHuman(sessionId: string): ConsensusSession | null {
  const session = getSession(sessionId);
  if (!session || session.status !== 'open') return null;

  const timestamp = now();
  getDatabase()
    .prepare("UPDATE consensus_session SET status = 'escalated', decision_source = 'human_review', resolved_at = ? WHERE id = ?")
    .run(timestamp, sessionId);

  const escalated: ConsensusSession = {
    ...session,
    status: 'escalated',
    decisionSource: 'human_review',
    resolvedAt: timestamp,
  };

  broadcast({
    type: 'consensus:update',
    payload: { sessionId, status: 'escalated' },
    timestamp: now(),
  });

  return escalated;
}

/** Set a human decision on an escalated session. */
export function setHumanDecision(sessionId: string, decision: string): ConsensusSession | null {
  const session = getSession(sessionId);
  if (!session) return null;

  const timestamp = now();
  getDatabase()
    .prepare(
      `UPDATE consensus_session SET status = 'resolved', decision = ?, decision_source = 'human_review', resolved_at = ? WHERE id = ?`
    )
    .run(decision, timestamp, sessionId);

  return {
    ...session,
    status: 'resolved',
    decision,
    decisionSource: 'human_review',
    resolvedAt: timestamp,
  };
}

/** Collect opinions from multiple agents and resolve automatically. */
export async function runMultiAgentConsensus(
  question: string,
  mode: ConsensusMode,
  agentTypes: AgentType[],
  workflowId?: string
): Promise<ConsensusSession & { votes: ConsensusVote[] }> {
  const session = createSession(question, mode, { agentTypes }, workflowId);
  const contextScope = buildContextScope({ filePaths: [], maxTokens: 2000 });

  for (const agentType of agentTypes) {
    try {
      const adapter = getAdapter(agentType);
      const available = await adapter.isAvailable();
      const effectiveType = available ? agentType : 'mock';

      const result = await executeOutboundPipeline({
        agentType: effectiveType,
        prompt: `Consensus question: ${question}\nProvide your opinion concisely.`,
        contextScope,
        capability: 'review',
        workflowId,
        task: `consensus/${session.id}`,
      });

      submitVote(session.id, effectiveType, result.content);
    } catch {
      submitVote(session.id, 'mock', `Unable to get opinion from ${agentType}`);
    }
  }

  if (mode !== 'human_review') {
    resolveSession(session.id);
  }

  return getSession(session.id)!;
}

function computeDecision(session: ConsensusSession & { votes: ConsensusVote[] }): {
  decision: string;
  source: string;
} {
  const votes = session.votes;
  if (votes.length === 0) {
    return { decision: 'No votes submitted', source: 'empty' };
  }

  switch (session.mode) {
    case 'single_authority': {
      const authority = (session.config.authority as AgentType) || votes[0].agentType;
      const authVote = votes.find((v) => v.agentType === authority) || votes[0];
      return { decision: authVote.opinion, source: `single_authority:${authVote.agentType}` };
    }

    case 'weighted_vote': {
      let best = votes[0];
      let bestWeight = best.weight;
      for (const vote of votes) {
        if (vote.weight > bestWeight) {
          best = vote;
          bestWeight = vote.weight;
        }
      }
      return { decision: best.opinion, source: `weighted_vote:${best.agentType}(w=${best.weight})` };
    }

    case 'majority_vote': {
      const buckets = new Map<string, { count: number; opinions: string[]; agents: string[] }>();
      for (const vote of votes) {
        const key = normalizeOpinion(vote.opinion);
        const bucket = buckets.get(key) || { count: 0, opinions: [], agents: [] };
        bucket.count++;
        bucket.opinions.push(vote.opinion);
        bucket.agents.push(vote.agentType);
        buckets.set(key, bucket);
      }

      let winner = { count: 0, opinions: [] as string[], agents: [] as string[] };
      for (const bucket of buckets.values()) {
        if (bucket.count > winner.count) winner = bucket;
      }

      return {
        decision: winner.opinions[0] || 'No majority',
        source: `majority_vote:${winner.agents.join(',')}(${winner.count}/${votes.length})`,
      };
    }

    case 'human_review':
    default:
      return { decision: 'Escalated to human review', source: 'human_review' };
  }
}

function normalizeOpinion(opinion: string): string {
  return opinion.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 100);
}