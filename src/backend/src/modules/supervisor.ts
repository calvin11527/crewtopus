import { getDatabase } from '../database';
import { generateId, now } from '../utils/helpers';
import { findAgentsByCapability } from './capability-registry';
import { getAgent, updateAgentStatus } from './agent-registry';
import { broadcast } from '../websocket';
import { buildContextScope } from './context-scope';
import { executeOutboundPipeline, PrivacyBlockedError } from './outbound-pipeline';
import { ApprovalRequiredError } from './approval-gate';
import type { Agent, AgentType } from '../types';

export type SupervisorTaskStatus = 'queued' | 'assigned' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface SupervisorTask {
  id: string;
  description: string;
  capability: string;
  workspaceId?: string;
  assignedAgentId?: string;
  assignedAgentType?: AgentType;
  status: SupervisorTaskStatus;
  result?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskSubmission {
  description: string;
  capability: string;
  workspaceId?: string;
  preferredAgentType?: AgentType;
  filePaths?: string[];
  basePath?: string;
  maxTokens?: number;
}

export interface AgentSelection {
  agent: Agent;
  capability: string;
  reason: string;
}

interface TaskRow {
  id: string;
  description: string;
  capability: string;
  workspace_id: string | null;
  assigned_agent_id: string | null;
  assigned_agent_type: string | null;
  status: string;
  result: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

function mapTask(row: TaskRow): SupervisorTask {
  return {
    id: row.id,
    description: row.description,
    capability: row.capability,
    workspaceId: row.workspace_id ?? undefined,
    assignedAgentId: row.assigned_agent_id ?? undefined,
    assignedAgentType: (row.assigned_agent_type as AgentType) ?? undefined,
    status: row.status as SupervisorTaskStatus,
    result: row.result ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function persistTask(task: SupervisorTask): void {
  getDatabase()
    .prepare(
      `INSERT OR REPLACE INTO supervisor_task
       (id, description, capability, workspace_id, assigned_agent_id, assigned_agent_type, status, result, error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      task.id,
      task.description,
      task.capability,
      task.workspaceId ?? null,
      task.assignedAgentId ?? null,
      task.assignedAgentType ?? null,
      task.status,
      task.result ?? null,
      task.error ?? null,
      task.createdAt,
      task.updatedAt
    );
}

function loadTask(id: string): SupervisorTask | null {
  const row = getDatabase().prepare('SELECT * FROM supervisor_task WHERE id = ?').get(id) as TaskRow | undefined;
  return row ? mapTask(row) : null;
}

/** Rebuild in-memory agent locks from persisted running/assigned tasks (e.g. after restart). */
export function reconcileSupervisorAgentLocks(): number {
  const rows = getDatabase()
    .prepare(`SELECT id, assigned_agent_id FROM supervisor_task WHERE status IN ('assigned', 'running')`)
    .all() as { id: string; assigned_agent_id: string | null }[];

  const locks = new Map<string, string>();
  for (const row of rows) {
    if (row.assigned_agent_id) locks.set(row.assigned_agent_id, row.id);
  }

  supervisor.rebuildAgentLocksFrom(locks);
  return locks.size;
}

/** Mark stale running/assigned supervisor tasks as failed on boot. */
export function recoverStaleSupervisorTasks(): number {
  const timestamp = now();
  const result = getDatabase()
    .prepare(
      `UPDATE supervisor_task SET status = 'failed', error = 'Interrupted by server restart', updated_at = ?
       WHERE status IN ('running', 'assigned')`
    )
    .run(timestamp);
  return result.changes;
}

class SupervisorEngine {
  private agentLocks = new Map<string, string>();

  constructor() {
    this.rebuildAgentLocks();
  }

  private rebuildAgentLocks(): void {
    const rows = getDatabase()
      .prepare(`SELECT id, assigned_agent_id FROM supervisor_task WHERE status IN ('assigned', 'running')`)
      .all() as { id: string; assigned_agent_id: string | null }[];
    const locks = new Map<string, string>();
    for (const row of rows) {
      if (row.assigned_agent_id) locks.set(row.assigned_agent_id, row.id);
    }
    this.rebuildAgentLocksFrom(locks);
  }

  /** Replace agent locks from a reconciled map (used on boot and in tests). */
  rebuildAgentLocksFrom(locks: Map<string, string>): void {
    this.agentLocks.clear();
    for (const [agentId, taskId] of locks) {
      this.agentLocks.set(agentId, taskId);
    }
  }

  /** Expose lock count for diagnostics and tests. */
  getLockedAgentCount(): number {
    return this.agentLocks.size;
  }

  isAgentLocked(agentId: string): boolean {
    return this.agentLocks.has(agentId);
  }

  submitTask(submission: TaskSubmission): SupervisorTask {
    const selection = this.selectAgent(submission.capability, submission.preferredAgentType);
    if (!selection) {
      throw new Error(`No enabled agent found for capability "${submission.capability}"`);
    }

    const timestamp = now();
    const task: SupervisorTask = {
      id: generateId(),
      description: submission.description,
      capability: submission.capability,
      workspaceId: submission.workspaceId,
      assignedAgentId: selection.agent.id,
      assignedAgentType: selection.agent.type,
      status: 'assigned',
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    persistTask(task);
    this.agentLocks.set(selection.agent.id, task.id);
    updateAgentStatus(selection.agent.id, 'running');
    this.emitTaskUpdate(task, `Assigned to ${selection.agent.name}: ${selection.reason}`);
    return task;
  }

  selectAgent(capability: string, preferredType?: AgentType): AgentSelection | null {
    const candidates = findAgentsByCapability(capability);
    if (candidates.length === 0) return null;

    let chosen = candidates[0];
    if (preferredType) {
      const preferred = candidates.find((c) => c.agentType === preferredType);
      if (preferred) chosen = preferred;
    }

    const available = candidates.find((c) => !this.agentLocks.has(c.agentId));
    if (available) chosen = available;

    const agent = getAgent(chosen.agentId);
    if (!agent || !agent.enabled) return null;

    return {
      agent,
      capability,
      reason: preferredType
        ? `Preferred type "${preferredType}" with capability "${capability}"`
        : `First available agent with capability "${capability}"`,
    };
  }

  async startTask(
    taskId: string,
    options: {
      filePaths?: string[];
      basePath?: string;
      maxTokens?: number;
      approvalId?: string;
    } = {}
  ): Promise<SupervisorTask | null> {
    const task = loadTask(taskId);
    if (!task || !task.assignedAgentId || !task.assignedAgentType) return null;
    if (task.status === 'cancelled' || task.status === 'completed') return null;

    task.status = 'running';
    task.updatedAt = now();
    persistTask(task);
    this.emitTaskUpdate(task, 'Task execution started');

    try {
      const contextScope = buildContextScope({
        filePaths: options.filePaths || [],
        basePath: options.basePath,
        maxTokens: options.maxTokens,
      });

      const result = await this.executeWithAdapter(
        task.assignedAgentType,
        task.description,
        contextScope,
        task.capability,
        {
          agentId: task.assignedAgentId,
          workspaceId: task.workspaceId,
          filePaths: options.filePaths,
          basePath: options.basePath,
          approvalId: options.approvalId,
          task: task.description,
        }
      );

      return this.completeTask(taskId, result);
    } catch (err) {
      if (err instanceof ApprovalRequiredError) {
        task.status = 'assigned';
        task.updatedAt = now();
        persistTask(task);
        this.emitTaskUpdate(task, err.message);
        return task;
      }
      return this.failTask(taskId, (err as Error).message);
    }
  }

  async executeWithAdapter(
    agentType: AgentType,
    prompt: string,
    contextScope: import('../types').ContextScope,
    capability?: string,
    meta: {
      agentId?: string;
      workflowId?: string;
      workspaceId?: string;
      filePaths?: string[];
      basePath?: string;
      approvalId?: string;
      task?: string;
    } = {}
  ): Promise<string> {
    const result = await executeOutboundPipeline({
      agentType,
      prompt,
      contextScope,
      capability,
      agentId: meta.agentId,
      workflowId: meta.workflowId,
      workspaceId: meta.workspaceId,
      filePaths: meta.filePaths,
      basePath: meta.basePath,
      approvalId: meta.approvalId,
      task: meta.task,
    });
    return result.content;
  }

  completeTask(taskId: string, result: string): SupervisorTask | null {
    const task = loadTask(taskId);
    if (!task) return null;

    task.status = 'completed';
    task.result = result;
    task.updatedAt = now();
    persistTask(task);

    if (task.assignedAgentId) {
      this.agentLocks.delete(task.assignedAgentId);
      updateAgentStatus(task.assignedAgentId, 'idle');
    }

    this.emitTaskUpdate(task, 'Task completed');
    return task;
  }

  failTask(taskId: string, error: string): SupervisorTask | null {
    const task = loadTask(taskId);
    if (!task) return null;

    task.status = 'failed';
    task.error = error;
    task.updatedAt = now();
    persistTask(task);

    if (task.assignedAgentId) {
      this.agentLocks.delete(task.assignedAgentId);
      updateAgentStatus(task.assignedAgentId, 'error');
    }

    this.emitTaskUpdate(task, `Task failed: ${error}`);
    return task;
  }

  cancelTask(taskId: string): SupervisorTask | null {
    const task = loadTask(taskId);
    if (!task) return null;
    if (task.status === 'completed') return null;

    task.status = 'cancelled';
    task.updatedAt = now();
    persistTask(task);

    if (task.assignedAgentId) {
      this.agentLocks.delete(task.assignedAgentId);
      updateAgentStatus(task.assignedAgentId, 'idle');
    }

    this.emitTaskUpdate(task, 'Task cancelled');
    return task;
  }

  getTask(taskId: string): SupervisorTask | undefined {
    return loadTask(taskId) ?? undefined;
  }

  listTasks(status?: SupervisorTaskStatus): SupervisorTask[] {
    const rows = status
      ? (getDatabase()
          .prepare('SELECT * FROM supervisor_task WHERE status = ? ORDER BY updated_at DESC')
          .all(status) as TaskRow[])
      : (getDatabase().prepare('SELECT * FROM supervisor_task ORDER BY updated_at DESC').all() as TaskRow[]);
    return rows.map(mapTask);
  }

  getStatus(): {
    activeTasks: number;
    queuedTasks: number;
    lockedAgents: number;
    totalTasks: number;
  } {
    const tasks = this.listTasks();
    return {
      activeTasks: tasks.filter((t) => t.status === 'running' || t.status === 'assigned').length,
      queuedTasks: tasks.filter((t) => t.status === 'queued').length,
      lockedAgents: this.agentLocks.size,
      totalTasks: tasks.length,
    };
  }

  validateCommunication(sourceAgentId: string, targetAgentId: string): void {
    if (sourceAgentId === targetAgentId) return;
    throw new Error(
      'Direct agent-to-agent communication is not allowed. All requests must route through the supervisor.'
    );
  }

  private emitTaskUpdate(task: SupervisorTask, message: string): void {
    broadcast({
      type: 'workflow:update',
      payload: { taskId: task.id, status: task.status, message, agentId: task.assignedAgentId },
      timestamp: now(),
    });
  }
}

export const supervisor = new SupervisorEngine();