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
  context_hash: string | null;
  sensitivity_level: number;
  status: string;
  created_at: string;
  resolved_at: string | null;
  consumed_at: string | null;
}

const APPROVAL_THRESHOLD: SensitivityLevel = 2;

function mapApproval(row: ApprovalRow): ApprovalRequest {
  const contextScope = parseJson<ContextScope>(row.context_scope, {
    files: [],
    diffs: [],
    symbols: [],
    maxTokens: 8000,
    sensitivityLevel: 0,
  });
  return {
    id: row.id,
    workflowId: row.workflow_id ?? undefined,
    workItemId: row.work_item_id ?? undefined,
    loopRunId: row.loop_run_id ?? undefined,
    summary: row.summary ?? undefined,
    contextScope,
    contextHash: row.context_hash ?? hashContext(contextScope),
    sensitivityLevel: row.sensitivity_level as SensitivityLevel,
    status: row.status as ApprovalStatus,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? undefined,
    consumedAt: row.consumed_at ?? undefined,
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
  const contextHash = hashContext(contextScope);

  getDatabase()
    .prepare(
      `INSERT INTO approval_request
       (id, workflow_id, work_item_id, loop_run_id, summary, context_scope, context_hash, sensitivity_level, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
    )
    .run(
      id,
      workflowId ?? null,
      options.workItemId ?? null,
      options.loopRunId ?? null,
      options.summary ?? null,
      JSON.stringify(contextScope),
      contextHash,
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
    contextHash,
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

/** Check if an unconsumed approved request exists for a given context hash. */
export function hasApprovedContext(contextHash: string): boolean {
  const rows = getDatabase()
    .prepare(
      `SELECT context_hash, context_scope FROM approval_request
       WHERE status IN ('approved', 'modified') AND consumed_at IS NULL`
    )
    .all() as Array<{ context_hash: string | null; context_scope: string }>;
  return rows.some((row) => {
    if (row.context_hash) return row.context_hash === contextHash;
    const scope = parseJson<ContextScope>(row.context_scope, {
      files: [],
      diffs: [],
      symbols: [],
      maxTokens: 8000,
      sensitivityLevel: 0,
    });
    return hashContext(scope) === contextHash;
  });
}

export class ApprovalBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApprovalBindingError';
  }
}

/**
 * Redeem an approved/modified request exactly once.
 * Binds to work item (when either side has one) and the original context hash.
 */
export function consumeApprovedRequest(
  id: string,
  binding: { workItemId?: string; contextHash: string }
): ApprovalRequest {
  const db = getDatabase();
  return db.transaction(() => {
    const existing = getApprovalRequest(id);
    if (!existing) {
      throw new ApprovalBindingError(`Approval ${id} was not found`);
    }
    if (existing.status !== 'approved' && existing.status !== 'modified') {
      throw new ApprovalBindingError(`Approval ${id} is not approved`);
    }
    if (existing.consumedAt) {
      throw new ApprovalBindingError(`Approval ${id} has already been used`);
    }

    const approvalWorkItem = existing.workItemId;
    const requestWorkItem = binding.workItemId;
    if (approvalWorkItem && requestWorkItem && approvalWorkItem !== requestWorkItem) {
      throw new ApprovalBindingError(
        `Approval ${id} is bound to a different work item`
      );
    }
    if (approvalWorkItem && !requestWorkItem) {
      throw new ApprovalBindingError(`Approval ${id} requires work item ${approvalWorkItem}`);
    }
    if (!approvalWorkItem && requestWorkItem) {
      throw new ApprovalBindingError(`Approval ${id} is not bound to work item ${requestWorkItem}`);
    }

    const storedHash = existing.contextHash ?? hashContext(existing.contextScope);
    if (storedHash !== binding.contextHash) {
      throw new ApprovalBindingError(`Approval ${id} does not match this context`);
    }

    const timestamp = now();
    const updated = db
      .prepare(
        `UPDATE approval_request SET consumed_at = ?
         WHERE id = ? AND consumed_at IS NULL AND status IN ('approved', 'modified')`
      )
      .run(timestamp, id);
    if (updated.changes === 0) {
      throw new ApprovalBindingError(`Approval ${id} has already been used`);
    }

    return { ...existing, consumedAt: timestamp };
  })();
}

export class ApprovalRequiredError extends Error {
  readonly approvalRequest: ApprovalRequest;

  constructor(request: ApprovalRequest) {
    super(`Approval required for sensitivity level ${request.sensitivityLevel}. Request ID: ${request.id}`);
    this.name = 'ApprovalRequiredError';
    this.approvalRequest = request;
  }
}