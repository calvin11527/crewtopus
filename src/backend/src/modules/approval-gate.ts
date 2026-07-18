import { getDatabase } from '../database';
import type { ApprovalRequest, ApprovalStatus, ContextScope, SensitivityLevel } from '../types';
import { generateId, now, parseJson } from '../utils/helpers';
import { broadcast } from '../websocket';
import { hashContext } from './context-scope';

interface ApprovalRow {
  id: string;
  workflow_id: string | null;
  work_item_id: string | null;
  loop_run_id: string | null;
  summary: string | null;
  context_scope: string;
  sensitivity_level: number;
  status: string;
  created_at: string;
  resolved_at: string | null;
}

const APPROVAL_THRESHOLD: SensitivityLevel = 2;

function mapApproval(row: ApprovalRow): ApprovalRequest {
  return {
    id: row.id,
    workflowId: row.workflow_id ?? undefined,
    workItemId: row.work_item_id ?? undefined,
    loopRunId: row.loop_run_id ?? undefined,
    summary: row.summary ?? undefined,
    contextScope: parseJson<ContextScope>(row.context_scope, {
      files: [],
      diffs: [],
      symbols: [],
      maxTokens: 8000,
      sensitivityLevel: 0,
    }),
    sensitivityLevel: row.sensitivity_level as SensitivityLevel,
    status: row.status as ApprovalStatus,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? undefined,
  };
}

/** Check if a request requires human approval based on sensitivity. */
export function requiresApproval(sensitivityLevel: SensitivityLevel): boolean {
  return sensitivityLevel >= APPROVAL_THRESHOLD;
}

/** Create a pending approval request. */
export function createApprovalRequest(
  contextScope: ContextScope,
  workflowId?: string,
  options: { workItemId?: string; loopRunId?: string; summary?: string } = {}
): ApprovalRequest {
  const id = generateId();
  const timestamp = now();

  getDatabase()
    .prepare(
      `INSERT INTO approval_request
       (id, workflow_id, work_item_id, loop_run_id, summary, context_scope, sensitivity_level, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
    )
    .run(
      id,
      workflowId ?? null,
      options.workItemId ?? null,
      options.loopRunId ?? null,
      options.summary ?? null,
      JSON.stringify(contextScope),
      contextScope.sensitivityLevel,
      timestamp
    );

  const request: ApprovalRequest = {
    id,
    workflowId,
    workItemId: options.workItemId,
    loopRunId: options.loopRunId,
    summary: options.summary,
    contextScope,
    sensitivityLevel: contextScope.sensitivityLevel as SensitivityLevel,
    status: 'pending',
    createdAt: timestamp,
  };

  broadcast({
    type: 'approval:request',
    payload: {
      requestId: id,
      sensitivityLevel: contextScope.sensitivityLevel,
      workflowId,
      workItemId: options.workItemId,
      loopRunId: options.loopRunId,
    },
    timestamp: now(),
  });

  return request;
}

/** List approval requests, optionally filtered by status. */
export function listApprovalRequests(status?: ApprovalStatus): ApprovalRequest[] {
  const db = getDatabase();
  const rows = status
    ? (db.prepare('SELECT * FROM approval_request WHERE status = ? ORDER BY created_at DESC').all(status) as ApprovalRow[])
    : (db.prepare('SELECT * FROM approval_request ORDER BY created_at DESC').all() as ApprovalRow[]);
  return rows.map(mapApproval);
}

/** Get an approval request by ID. */
export function getApprovalRequest(id: string): ApprovalRequest | null {
  const row = getDatabase()
    .prepare('SELECT * FROM approval_request WHERE id = ?')
    .get(id) as ApprovalRow | undefined;
  return row ? mapApproval(row) : null;
}

/** Approve a pending request. */
export function approveRequest(id: string): ApprovalRequest | null {
  const existing = getApprovalRequest(id);
  if (!existing || existing.status !== 'pending') return null;

  const timestamp = now();
  getDatabase()
    .prepare("UPDATE approval_request SET status = 'approved', resolved_at = ? WHERE id = ?")
    .run(timestamp, id);

  return { ...existing, status: 'approved', resolvedAt: timestamp };
}

/** Reject a pending request. */
export function rejectRequest(id: string): ApprovalRequest | null {
  const existing = getApprovalRequest(id);
  if (!existing || existing.status !== 'pending') return null;

  const timestamp = now();
  getDatabase()
    .prepare("UPDATE approval_request SET status = 'rejected', resolved_at = ? WHERE id = ?")
    .run(timestamp, id);

  return { ...existing, status: 'rejected', resolvedAt: timestamp };
}

/** Modify scope and approve a pending request. */
export function modifyAndApprove(id: string, modifiedScope: ContextScope): ApprovalRequest | null {
  const existing = getApprovalRequest(id);
  if (!existing || existing.status !== 'pending') return null;

  const timestamp = now();
  getDatabase()
    .prepare(
      "UPDATE approval_request SET status = 'modified', context_scope = ?, resolved_at = ? WHERE id = ?"
    )
    .run(JSON.stringify(modifiedScope), timestamp, id);

  return { ...existing, contextScope: modifiedScope, status: 'modified', resolvedAt: timestamp };
}

/** Check if an approved request exists for a given context hash. */
export function hasApprovedContext(contextHash: string): boolean {
  const requests = listApprovalRequests('approved');
  const modified = listApprovalRequests('modified');
  return [...requests, ...modified].some((r) => hashContext(r.contextScope) === contextHash);
}

export class ApprovalRequiredError extends Error {
  readonly approvalRequest: ApprovalRequest;

  constructor(request: ApprovalRequest) {
    super(`Approval required for sensitivity level ${request.sensitivityLevel}. Request ID: ${request.id}`);
    this.name = 'ApprovalRequiredError';
    this.approvalRequest = request;
  }
}