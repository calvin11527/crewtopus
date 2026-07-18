import { getDatabase } from '../database';
import type {
  Workflow,
  WorkflowDefinition,
  WorkflowExecution,
  WorkflowStatus,
  WorkflowStep,
  WorkflowLoopResult,
  ContextScope,
} from '../types';
import { runAgentLoop } from './loop-engine';
import { generateId, now, parseJson } from '../utils/helpers';
import { broadcast } from '../websocket';
import { buildContextScope } from './context-scope';
import { executeOutboundPipeline } from './outbound-pipeline';
import { getAgent, updateAgentStatus } from './agent-registry';
import { incrementCounter } from '../metrics';

interface WorkflowRow {
  id: string;
  workspace_id: string | null;
  name: string;
  definition: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface ExecutionRow {
  id: string;
  workflow_id: string;
  status: string;
  current_step: number;
  result: string | null;
  started_at: string | null;
  completed_at: string | null;
  loop_results: string | null;
}

interface ExecuteWorkflowOptions {
  filePaths?: string[];
  basePath?: string;
  maxTokens?: number;
  workItemId?: string;
  maxLoopIterations?: number;
  autoLoop?: boolean;
}

interface ActiveExecution {
  execution: WorkflowExecution;
  workflow: Workflow;
  stepResults: string[];
  loopResults: WorkflowLoopResult[];
  paused: boolean;
  cancelled: boolean;
  contextScope?: ContextScope;
  basePath?: string;
  filePaths?: string[];
  executeOptions: ExecuteWorkflowOptions;
}

const activeExecutions = new Map<string, ActiveExecution>();

function mapWorkflow(row: WorkflowRow): Workflow {
  return {
    id: row.id,
    workspaceId: row.workspace_id ?? undefined,
    name: row.name,
    definition: parseJson<WorkflowDefinition>(row.definition, { name: row.name, steps: [] }),
    status: row.status as WorkflowStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapExecution(row: ExecutionRow): WorkflowExecution {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    status: row.status as WorkflowStatus,
    currentStep: row.current_step,
    result: row.result ?? undefined,
    loopResults: row.loop_results ? parseJson<WorkflowLoopResult[]>(row.loop_results, []) : undefined,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
  };
}

function persistExecution(execution: WorkflowExecution): void {
  getDatabase()
    .prepare(
      `UPDATE workflow_execution
       SET status = ?, current_step = ?, result = ?, started_at = ?, completed_at = ?, loop_results = ?
       WHERE id = ?`
    )
    .run(
      execution.status,
      execution.currentStep,
      execution.result ?? null,
      execution.startedAt ?? null,
      execution.completedAt ?? null,
      execution.loopResults ? JSON.stringify(execution.loopResults) : null,
      execution.id
    );
}

function emitStep(executionId: string, step: number, stepName: string, status: string): void {
  broadcast({
    type: 'workflow:step',
    payload: { executionId, step, stepName, status },
    timestamp: now(),
  });
}

/** Create a new workflow definition. */
export function createWorkflow(
  name: string,
  definition: WorkflowDefinition,
  workspaceId?: string
): Workflow {
  const id = generateId();
  const timestamp = now();

  getDatabase()
    .prepare(
      `INSERT INTO workflow (id, workspace_id, name, definition, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'draft', ?, ?)`
    )
    .run(id, workspaceId ?? null, name, JSON.stringify(definition), timestamp, timestamp);

  return { id, workspaceId, name, definition, status: 'draft', createdAt: timestamp, updatedAt: timestamp };
}

/** List all workflows. */
export function listWorkflows(workspaceId?: string): Workflow[] {
  const db = getDatabase();
  const rows = workspaceId
    ? (db.prepare('SELECT * FROM workflow WHERE workspace_id = ? ORDER BY updated_at DESC').all(workspaceId) as WorkflowRow[])
    : (db.prepare('SELECT * FROM workflow ORDER BY updated_at DESC').all() as WorkflowRow[]);
  return rows.map(mapWorkflow);
}

/** Get a workflow by ID. */
export function getWorkflow(id: string): Workflow | null {
  const row = getDatabase()
    .prepare('SELECT * FROM workflow WHERE id = ?')
    .get(id) as WorkflowRow | undefined;
  return row ? mapWorkflow(row) : null;
}

/** Update a workflow definition. */
export function updateWorkflow(
  id: string,
  updates: Partial<Pick<Workflow, 'name' | 'definition' | 'status' | 'workspaceId'>>
): Workflow | null {
  const existing = getWorkflow(id);
  if (!existing) return null;

  const name = updates.name ?? existing.name;
  const definition = updates.definition ?? existing.definition;
  const status = updates.status ?? existing.status;
  const workspaceId = updates.workspaceId ?? existing.workspaceId;
  const timestamp = now();

  getDatabase()
    .prepare('UPDATE workflow SET name = ?, definition = ?, status = ?, workspace_id = ?, updated_at = ? WHERE id = ?')
    .run(name, JSON.stringify(definition), status, workspaceId ?? null, timestamp, id);

  return { ...existing, name, definition, status, workspaceId, updatedAt: timestamp };
}

/** Delete a workflow. */
export function deleteWorkflow(id: string): boolean {
  const result = getDatabase().prepare('DELETE FROM workflow WHERE id = ?').run(id);
  return result.changes > 0;
}

/** Get an execution by ID. */
export function getExecution(id: string): WorkflowExecution | null {
  const active = activeExecutions.get(id);
  if (active) return active.execution;

  const row = getDatabase()
    .prepare('SELECT * FROM workflow_execution WHERE id = ?')
    .get(id) as ExecutionRow | undefined;
  return row ? mapExecution(row) : null;
}

/** List executions for a workflow. */
export function listExecutions(workflowId: string): WorkflowExecution[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM workflow_execution WHERE workflow_id = ? ORDER BY started_at DESC')
    .all(workflowId) as ExecutionRow[];
  return rows.map(mapExecution);
}

/** Execute a workflow step-by-step through agent adapters. */
export async function executeWorkflow(
  workflowId: string,
  options: ExecuteWorkflowOptions = {}
): Promise<WorkflowExecution> {
  const workflow = getWorkflow(workflowId);
  if (!workflow) throw new Error('Workflow not found');

  const hasLinearSteps = workflow.definition.steps.length > 0;
  const hasLoops = (workflow.definition.loops?.length ?? 0) > 0;
  if (!hasLinearSteps && !hasLoops) throw new Error('Workflow has no steps or loops');

  const executionId = generateId();
  const timestamp = now();

  const execution: WorkflowExecution = {
    id: executionId,
    workflowId,
    status: 'active',
    currentStep: 0,
    startedAt: timestamp,
  };

  getDatabase()
    .prepare(
      `INSERT INTO workflow_execution (id, workflow_id, status, current_step, started_at)
       VALUES (?, ?, 'active', 0, ?)`
    )
    .run(executionId, workflowId, timestamp);

  updateWorkflow(workflowId, { status: 'active' });

  const contextScope = buildContextScope({
    filePaths: options.filePaths || [],
    basePath: options.basePath,
    maxTokens: options.maxTokens,
    includeDiffs: true,
    includeSymbols: true,
  });

  const active: ActiveExecution = {
    execution,
    workflow,
    stepResults: [],
    loopResults: [],
    paused: false,
    cancelled: false,
    contextScope,
    basePath: options.basePath,
    filePaths: options.filePaths,
    executeOptions: options,
  };
  activeExecutions.set(executionId, active);

  broadcast({
    type: 'workflow:update',
    payload: { executionId, workflowId, status: 'active', message: 'Workflow execution started' },
    timestamp: now(),
  });

  runExecutionLoop(executionId).catch((err) => {
    const ex = activeExecutions.get(executionId);
    if (ex) {
      ex.execution.status = 'failed';
      ex.execution.completedAt = now();
      persistExecution(ex.execution);
      updateWorkflow(workflowId, { status: 'failed' });
      broadcast({
        type: 'workflow:update',
        payload: { executionId, status: 'failed', error: (err as Error).message },
        timestamp: now(),
      });
      activeExecutions.delete(executionId);
    }
  });

  return execution;
}

async function runExecutionLoop(executionId: string): Promise<void> {
  const active = activeExecutions.get(executionId);
  if (!active) return;

  const { workflow, execution, contextScope } = active;
  const steps = workflow.definition.steps;

  while (steps.length > 0 && execution.currentStep < steps.length) {
    if (active.cancelled) {
      execution.status = 'cancelled';
      execution.completedAt = now();
      persistExecution(execution);
      updateWorkflow(workflow.id, { status: 'cancelled' });
      activeExecutions.delete(executionId);
      return;
    }

    if (active.paused) {
      execution.status = 'paused';
      persistExecution(execution);
      return;
    }

    const step = steps[execution.currentStep];
    emitStep(executionId, execution.currentStep, step.name, 'running');

    try {
      const result = await executeStep(
        step,
        contextScope!,
        workflow.name,
        step.name,
        workflow.id,
        active.stepResults,
        { basePath: active.basePath, filePaths: active.filePaths }
      );
      active.stepResults.push(result);
      execution.currentStep++;
      persistExecution(execution);
      emitStep(executionId, execution.currentStep - 1, step.name, 'completed');
    } catch (err) {
      execution.status = 'failed';
      execution.result = (err as Error).message;
      execution.completedAt = now();
      persistExecution(execution);
      updateWorkflow(workflow.id, { status: 'failed' });
      emitStep(executionId, execution.currentStep, step.name, 'failed');
      activeExecutions.delete(executionId);
      throw err;
    }
  }

  if ((workflow.definition.loops?.length ?? 0) > 0) {
    await runWorkflowLoops(active);
  }

  execution.status = 'completed';
  execution.loopResults = active.loopResults;
  execution.result = active.stepResults.join('\n\n---\n\n');
  execution.completedAt = now();
  persistExecution(execution);
  updateWorkflow(workflow.id, { status: 'completed' });

  incrementCounter('agenthub_workflow_completions_total', 'Total completed workflows', { status: 'completed' });

  broadcast({
    type: 'workflow:update',
    payload: {
      executionId,
      workflowId: workflow.id,
      status: 'completed',
      loopResults: active.loopResults,
    },
    timestamp: now(),
  });

  activeExecutions.delete(executionId);
}

async function runWorkflowLoops(active: ActiveExecution): Promise<void> {
  const loops = active.workflow.definition.loops ?? [];
  const opts = active.executeOptions;

  for (const loop of loops) {
    if (active.cancelled) return;

    const result = await runAgentLoop({
      loop,
      workflowId: active.workflow.id,
      workItemId: opts.workItemId,
      workDir: active.basePath,
      options: {
        maxIterations: opts.maxLoopIterations ?? loop.maxIterations,
        autoLoop: opts.autoLoop,
      },
      executionLabel: active.workflow.name,
    });

    for (const step of result.steps) {
      active.stepResults.push(`## ${step.phase} (iter ${step.loopIteration}, ${step.agentType})\n${step.content}`);
    }

    active.loopResults.push({
      loopId: loop.id,
      iterations: result.iterations,
      loopStatus: result.loopStatus,
      reviewVerdict: result.reviewVerdict,
      stepCount: result.steps.length,
    });

    if (loop.onExhausted === 'fail' && result.loopStatus === 'failed') {
      throw new Error(`Loop "${loop.id}" failed after ${result.iterations} iteration(s)`);
    }
  }
}

async function executeStep(
  step: WorkflowStep,
  contextScope: ContextScope,
  workflowName: string,
  stepName: string,
  workflowId: string,
  priorResults: string[] = [],
  options: { basePath?: string; filePaths?: string[] } = {}
): Promise<string> {
  const agent = getAgentByType(step.agent);
  if (agent) updateAgentStatus(agent.id, 'running');

  const priorContext =
    priorResults.length > 0
      ? `\n\n## Prior step output\n${priorResults.join('\n\n---\n\n')}`
      : '';
  const prompt = `Workflow: ${workflowName}\nStep: ${stepName}\n${step.config?.prompt || `Execute the "${stepName}" step.`}${priorContext}`;

  try {
    const result = await executeOutboundPipeline({
      agentType: step.agent,
      prompt,
      contextScope,
      capability: step.capability || step.name,
      agentId: agent?.id,
      workflowId,
      task: `${workflowName}/${stepName}`,
      basePath: options.basePath,
      filePaths: options.filePaths,
    });

    if (agent) updateAgentStatus(agent.id, 'idle');
    return result.content;
  } catch (err) {
    if (agent) updateAgentStatus(agent.id, 'error');
    throw err;
  }
}

function getAgentByType(type: string) {
  const rows = getDatabase()
    .prepare('SELECT id FROM agent WHERE type = ? AND enabled = 1 LIMIT 1')
    .get(type) as { id: string } | undefined;
  return rows ? getAgent(rows.id) : null;
}

/** Get count of currently active workflow executions. */
export function getActiveExecutionCount(): number {
  return activeExecutions.size;
}

/** Pause a running workflow execution. */
export function pauseExecution(executionId: string): WorkflowExecution | null {
  const active = activeExecutions.get(executionId);
  if (!active || active.execution.status !== 'active') return null;

  active.paused = true;
  active.execution.status = 'paused';
  persistExecution(active.execution);
  updateWorkflow(active.workflow.id, { status: 'paused' });

  broadcast({
    type: 'workflow:update',
    payload: { executionId, status: 'paused' },
    timestamp: now(),
  });

  return active.execution;
}

/** Resume a paused workflow execution. */
export async function resumeExecution(executionId: string): Promise<WorkflowExecution | null> {
  const active = activeExecutions.get(executionId);
  if (!active || !active.paused) return null;

  active.paused = false;
  active.execution.status = 'active';
  persistExecution(active.execution);
  updateWorkflow(active.workflow.id, { status: 'active' });

  runExecutionLoop(executionId).catch(() => { /* handled in loop */ });

  return active.execution;
}

/** Cancel a workflow execution. */
export function cancelExecution(executionId: string): WorkflowExecution | null {
  const active = activeExecutions.get(executionId);
  if (!active) {
    const row = getDatabase()
      .prepare('SELECT * FROM workflow_execution WHERE id = ?')
      .get(executionId) as ExecutionRow | undefined;
    if (!row || row.status === 'completed') return null;

    const execution = mapExecution(row);
    execution.status = 'cancelled';
    execution.completedAt = now();
    persistExecution(execution);
    return execution;
  }

  active.cancelled = true;
  return active.execution;
}