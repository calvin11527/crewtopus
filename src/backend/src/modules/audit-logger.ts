import { getDatabase } from '../database';
import type { AgentType, AuditEntry, ApprovalStatus } from '../types';
import { generateId, now, parseJson } from '../utils/helpers';
import { broadcast } from '../websocket';

interface AuditRow {
  id: string;
  agent_id: string | null;
  workflow_id: string | null;
  work_item_id: string | null;
  loop_iteration: number | null;
  pipeline_phase: string | null;
  agent_type: string | null;
  task: string | null;
  context_hash: string;
  files: string;
  token_count: number;
  cost: number;
  approval_status: string | null;
  response_metadata: string | null;
  timestamp: string;
}

function mapAudit(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    agentId: row.agent_id ?? undefined,
    workflowId: row.workflow_id ?? undefined,
    workItemId: row.work_item_id ?? undefined,
    loopIteration: row.loop_iteration ?? undefined,
    pipelinePhase: row.pipeline_phase ?? undefined,
    agentType: (row.agent_type as AgentType) ?? undefined,
    task: row.task ?? undefined,
    contextHash: row.context_hash,
    files: parseJson<string[]>(row.files, []),
    tokenCount: row.token_count,
    cost: row.cost,
    approvalStatus: (row.approval_status as ApprovalStatus) ?? undefined,
    responseMetadata: row.response_metadata ? parseJson(row.response_metadata, {}) : undefined,
    timestamp: row.timestamp,
  };
}

export interface AuditLogInput {
  id?: string;
  agentId?: string;
  workflowId?: string;
  workItemId?: string;
  loopIteration?: number;
  pipelinePhase?: string;
  agentType?: AgentType;
  task?: string;
  contextHash: string;
  files?: string[];
  tokenCount: number;
  cost?: number;
  approvalStatus?: ApprovalStatus;
  responseMetadata?: Record<string, unknown>;
}

/** Write an immutable audit log entry. */
export function logAuditEntry(input: AuditLogInput): AuditEntry {
  const id = input.id ?? generateId();
  const timestamp = now();

  getDatabase()
    .prepare(
      `INSERT INTO audit_log
       (id, agent_id, workflow_id, work_item_id, loop_iteration, pipeline_phase, agent_type,
        task, context_hash, files, token_count, cost, approval_status, response_metadata, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.agentId ?? null,
      input.workflowId ?? null,
      input.workItemId ?? null,
      input.loopIteration ?? null,
      input.pipelinePhase ?? null,
      input.agentType ?? null,
      input.task ?? null,
      input.contextHash,
      JSON.stringify(input.files || []),
      input.tokenCount,
      input.cost ?? 0,
      input.approvalStatus ?? null,
      input.responseMetadata ? JSON.stringify(input.responseMetadata) : null,
      timestamp
    );

  const entry: AuditEntry = {
    id,
    agentId: input.agentId,
    workflowId: input.workflowId,
    workItemId: input.workItemId,
    loopIteration: input.loopIteration,
    pipelinePhase: input.pipelinePhase,
    agentType: input.agentType,
    task: input.task,
    contextHash: input.contextHash,
    files: input.files || [],
    tokenCount: input.tokenCount,
    cost: input.cost ?? 0,
    approvalStatus: input.approvalStatus,
    responseMetadata: input.responseMetadata,
    timestamp,
  };

  broadcast({
    type: 'audit:entry',
    payload: {
      id: entry.id,
      agentId: entry.agentId,
      workItemId: entry.workItemId,
      loopIteration: entry.loopIteration,
      contextHash: entry.contextHash,
      tokenCount: entry.tokenCount,
      cost: entry.cost,
    },
    timestamp,
  });

  return entry;
}

/** List audit entries with optional filters. */
export function listAuditEntries(
  options: {
    agentId?: string;
    workflowId?: string;
    workItemId?: string;
    loopIteration?: number;
    limit?: number;
    offset?: number;
  } = {}
): AuditEntry[] {
  const { agentId, workflowId, workItemId, loopIteration, limit = 100, offset = 0 } = options;
  const db = getDatabase();

  let sql = 'SELECT * FROM audit_log';
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (agentId) {
    conditions.push('agent_id = ?');
    params.push(agentId);
  }
  if (workflowId) {
    conditions.push('workflow_id = ?');
    params.push(workflowId);
  }
  if (workItemId) {
    conditions.push('work_item_id = ?');
    params.push(workItemId);
  }
  if (loopIteration !== undefined) {
    conditions.push('loop_iteration = ?');
    params.push(loopIteration);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = db.prepare(sql).all(...params) as AuditRow[];
  return rows.map(mapAudit);
}

/** Get a single audit entry by ID. */
export function getAuditEntry(id: string): AuditEntry | null {
  const row = getDatabase()
    .prepare('SELECT * FROM audit_log WHERE id = ?')
    .get(id) as AuditRow | undefined;
  return row ? mapAudit(row) : null;
}

/** Get audit statistics summary. */
export function getAuditStats(): {
  totalEntries: number;
  totalTokens: number;
  totalCost: number;
  blockedCount: number;
} {
  const db = getDatabase();
  const total = db.prepare('SELECT COUNT(*) as c FROM audit_log').get() as { c: number };
  const tokens = db.prepare('SELECT COALESCE(SUM(token_count), 0) as t FROM audit_log').get() as { t: number };
  const cost = db.prepare('SELECT COALESCE(SUM(cost), 0) as c FROM audit_log').get() as { c: number };
  const blocked = db
    .prepare("SELECT COUNT(*) as c FROM audit_log WHERE approval_status = 'rejected'")
    .get() as { c: number };

  return {
    totalEntries: total.c,
    totalTokens: tokens.t,
    totalCost: cost.c,
    blockedCount: blocked.c,
  };
}