import { getDatabase } from '../database';
import type { WorkItemActivity, AgentType } from '../types';
import { generateId, now, parseJson } from '../utils/helpers';
import { broadcast } from '../websocket';

interface ActivityRow {
  id: string;
  work_item_id: string;
  agent_id: string | null;
  agent_type: string | null;
  activity_type: string;
  summary: string;
  audit_id: string | null;
  metadata: string | null;
  created_at: string;
}

function mapActivity(row: ActivityRow): WorkItemActivity {
  return {
    id: row.id,
    workItemId: row.work_item_id,
    agentId: row.agent_id ?? undefined,
    agentType: (row.agent_type as AgentType) ?? undefined,
    activityType: row.activity_type as WorkItemActivity['activityType'],
    summary: row.summary,
    auditId: row.audit_id ?? undefined,
    metadata: row.metadata ? parseJson(row.metadata, {}) : undefined,
    createdAt: row.created_at,
  };
}

export function logWorkItemActivity(input: {
  workItemId: string;
  activityType: WorkItemActivity['activityType'];
  summary: string;
  agentId?: string;
  agentType?: AgentType;
  auditId?: string;
  metadata?: Record<string, unknown>;
}): WorkItemActivity {
  const id = generateId();
  const timestamp = now();

  getDatabase()
    .prepare(
      `INSERT INTO work_item_activity
       (id, work_item_id, agent_id, agent_type, activity_type, summary, audit_id, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.workItemId,
      input.agentId ?? null,
      input.agentType ?? null,
      input.activityType,
      input.summary,
      input.auditId ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      timestamp
    );

  const activity: WorkItemActivity = {
    id,
    workItemId: input.workItemId,
    agentId: input.agentId,
    agentType: input.agentType,
    activityType: input.activityType,
    summary: input.summary,
    auditId: input.auditId,
    metadata: input.metadata,
    createdAt: timestamp,
  };

  broadcast({
    type: 'work_item:activity',
    payload: { workItemId: input.workItemId, activity },
    timestamp,
  });

  return activity;
}

export function listWorkItemActivity(workItemId: string, limit = 50): WorkItemActivity[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM work_item_activity WHERE work_item_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(workItemId, limit) as ActivityRow[];
  return rows.map(mapActivity);
}