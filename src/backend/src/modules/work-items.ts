import fs from 'fs';
import path from 'path';
import { getDatabase } from '../database';
import type {
  Sprint,
  SprintStatus,
  WorkItem,
  WorkItemPriority,
  WorkItemStatus,
  WorkItemType,
  WorkBoard,
  AgentType,
  LoopStatus,
} from '../types';
import { DEFAULT_MAX_LOOP_ITERATIONS } from '../types';
import { generateId, now, parseJson } from '../utils/helpers';
import { broadcast } from '../websocket';
import { logWorkItemActivity, listWorkItemActivity } from './work-item-activity';
import { getEmployment } from './agent-employment';
import { resolveSkillDefinition } from './agent-skills';

const BOARD_COLUMNS: WorkItemStatus[] = ['backlog', 'todo', 'in_progress', 'in_review', 'done'];

/**
 * Scratch/output root for agent work.
 * Prefer AGENTHUB_WORK_DIR / GROK_CWD; fall back to `<cwd>/.agenthub-work` so BA/PM/pipeline
 * can run without requiring env vars (empty-sprint bootstrap, local dev).
 */
export function resolveWorkDir(): string {
  const dir =
    process.env.AGENTHUB_WORK_DIR ||
    process.env.GROK_CWD ||
    path.join(process.cwd(), '.agenthub-work');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const AGENT_OUTPUT_SKIP = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

export interface WorkDirFileSnapshot {
  mtimeMs: number;
  size: number;
}

export function listFilesInDir(dir?: string): string[] {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => !name.startsWith('._') && !AGENT_OUTPUT_SKIP.has(name))
    .filter((name) => fs.statSync(path.join(dir, name)).isFile());
}

export function snapshotWorkDirFiles(dir?: string): Map<string, WorkDirFileSnapshot> {
  const snap = new Map<string, WorkDirFileSnapshot>();
  if (!dir || !fs.existsSync(dir)) return snap;

  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('._') || AGENT_OUTPUT_SKIP.has(name)) continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (!st.isFile()) continue;
    snap.set(name, { mtimeMs: st.mtimeMs, size: st.size });
  }
  return snap;
}

export function diffWorkDirFiles(
  before: Map<string, WorkDirFileSnapshot>,
  after: Map<string, WorkDirFileSnapshot>
): { created: string[]; updated: string[] } {
  const created: string[] = [];
  const updated: string[] = [];

  for (const [name, afterSnap] of after) {
    const beforeSnap = before.get(name);
    if (!beforeSnap) {
      created.push(name);
    } else if (beforeSnap.mtimeMs !== afterSnap.mtimeMs || beforeSnap.size !== afterSnap.size) {
      updated.push(name);
    }
  }

  return { created, updated };
}

const MAX_SKILL_PROMPT_CHARS = 2000;

/** Append hired-agent role and skill expertise for prompt grounding. */
export function buildAgentSkillsPromptSection(agentId?: string): string {
  if (!agentId) return '';
  const employment = getEmployment(agentId);
  if (!employment) return '';

  const lines: string[] = [];
  if (employment.displayTitle || employment.role) {
    lines.push('\n\n## Agent profile');
    if (employment.displayTitle) lines.push(`Title: ${employment.displayTitle}`);
    if (employment.profileDescription) lines.push(employment.profileDescription);
  }

  if (employment.skills.length === 0) return lines.join('\n');

  lines.push('\n\n## Agent skills');
  let used = 0;
  for (const skillId of employment.skills) {
    const skill = resolveSkillDefinition(skillId);
    const line = `- ${skill?.label ?? skillId}: ${skill?.description ?? skillId}`;
    if (used + line.length > MAX_SKILL_PROMPT_CHARS) break;
    lines.push(line);
    used += line.length;
  }
  return lines.join('\n');
}

export function buildWorkItemAgentPrompt(item: WorkItem, criteria: string, workDir?: string): string {
  const workDirSection = workDir
    ? `\n\nWorking directory (use this exact path for all file operations): ${workDir}\n` +
      'You MUST use your file-write tools to create or modify files in that directory. ' +
      'Do not only describe what you would do — actually write the files and verify they exist before finishing.'
    : '';

  const skillsSection = buildAgentSkillsPromptSection(item.assignedAgentId);

  return `Work item ${item.key}: ${item.title}\n\n${item.description || ''}${criteria}${skillsSection}${workDirSection}`;
}

interface SprintRow {
  id: string;
  workspace_id: string | null;
  name: string;
  goal: string | null;
  status: string;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
}

interface WorkItemRow {
  id: string;
  key: string;
  workspace_id: string | null;
  sprint_id: string | null;
  parent_id: string | null;
  type: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  story_points: number | null;
  assigned_agent_id: string | null;
  assigned_agent_type: string | null;
  workflow_id: string | null;
  labels: string;
  acceptance_criteria: string;
  loop_iteration: number;
  max_loop_iterations: number;
  loop_status: string;
  created_at: string;
  updated_at: string;
}

function mapSprint(row: SprintRow): Sprint {
  return {
    id: row.id,
    workspaceId: row.workspace_id ?? undefined,
    name: row.name,
    goal: row.goal ?? undefined,
    status: row.status as SprintStatus,
    startDate: row.start_date ?? undefined,
    endDate: row.end_date ?? undefined,
    createdAt: row.created_at,
  };
}

function mapWorkItem(row: WorkItemRow): WorkItem {
  return {
    id: row.id,
    key: row.key,
    workspaceId: row.workspace_id ?? undefined,
    sprintId: row.sprint_id ?? undefined,
    parentId: row.parent_id ?? undefined,
    type: row.type as WorkItemType,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status as WorkItemStatus,
    priority: row.priority as WorkItemPriority,
    storyPoints: row.story_points ?? undefined,
    assignedAgentId: row.assigned_agent_id ?? undefined,
    assignedAgentType: (row.assigned_agent_type as AgentType) ?? undefined,
    workflowId: row.workflow_id ?? undefined,
    labels: parseJson<string[]>(row.labels, []),
    acceptanceCriteria: parseJson<string[]>(row.acceptance_criteria, []),
    loopIteration: row.loop_iteration ?? 0,
    maxLoopIterations: row.max_loop_iterations ?? DEFAULT_MAX_LOOP_ITERATIONS,
    loopStatus: (row.loop_status as LoopStatus) ?? 'idle',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function nextWorkItemKey(): string {
  const db = getDatabase();
  db.prepare('INSERT OR IGNORE INTO work_item_counter (id, next_number) VALUES (1, 1)').run();
  const row = db.prepare('SELECT next_number FROM work_item_counter WHERE id = 1').get() as {
    next_number: number;
  };
  const key = `AH-${row.next_number}`;
  db.prepare('UPDATE work_item_counter SET next_number = next_number + 1 WHERE id = 1').run();
  return key;
}

function notifyWorkItem(item: WorkItem): void {
  broadcast({
    type: 'work_item:update',
    payload: { id: item.id, key: item.key, status: item.status, title: item.title },
    timestamp: now(),
  });
}

export { listWorkItemActivity };

export function createSprint(
  name: string,
  options: {
    goal?: string;
    workspaceId?: string;
    status?: SprintStatus;
    startDate?: string;
    endDate?: string;
  } = {}
): Sprint {
  const id = generateId();
  const timestamp = now();

  getDatabase()
    .prepare(
      `INSERT INTO sprint (id, workspace_id, name, goal, status, start_date, end_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      options.workspaceId ?? null,
      name,
      options.goal ?? null,
      options.status ?? 'planning',
      options.startDate ?? null,
      options.endDate ?? null,
      timestamp
    );

  return {
    id,
    workspaceId: options.workspaceId,
    name,
    goal: options.goal,
    status: options.status ?? 'planning',
    startDate: options.startDate,
    endDate: options.endDate,
    createdAt: timestamp,
  };
}

export function listSprints(workspaceId?: string): Sprint[] {
  const db = getDatabase();
  const rows = workspaceId
    ? (db.prepare('SELECT * FROM sprint WHERE workspace_id = ? OR workspace_id IS NULL ORDER BY created_at DESC').all(workspaceId) as SprintRow[])
    : (db.prepare('SELECT * FROM sprint ORDER BY created_at DESC').all() as SprintRow[]);
  return rows.map(mapSprint);
}

export function getSprint(id: string): Sprint | null {
  const row = getDatabase().prepare('SELECT * FROM sprint WHERE id = ?').get(id) as SprintRow | undefined;
  return row ? mapSprint(row) : null;
}

export function updateSprint(
  id: string,
  updates: {
    name?: string;
    goal?: string | null;
    workspaceId?: string | null;
    status?: SprintStatus;
    startDate?: string | null;
    endDate?: string | null;
  }
): Sprint | null {
  const existing = getSprint(id);
  if (!existing) return null;

  const name = updates.name?.trim() || existing.name;
  const goal = updates.goal !== undefined ? updates.goal : existing.goal ?? null;
  const workspaceId =
    updates.workspaceId !== undefined ? updates.workspaceId : existing.workspaceId ?? null;
  const status = updates.status ?? existing.status;
  const startDate = updates.startDate !== undefined ? updates.startDate : existing.startDate ?? null;
  const endDate = updates.endDate !== undefined ? updates.endDate : existing.endDate ?? null;

  getDatabase()
    .prepare(
      `UPDATE sprint
       SET name = ?, goal = ?, workspace_id = ?, status = ?, start_date = ?, end_date = ?
       WHERE id = ?`
    )
    .run(name, goal, workspaceId, status, startDate, endDate, id);

  return getSprint(id);
}

export function deleteSprint(id: string): boolean {
  const result = getDatabase().prepare('DELETE FROM sprint WHERE id = ?').run(id);
  return result.changes > 0;
}

export function createWorkItem(input: {
  type: WorkItemType;
  title: string;
  description?: string;
  workspaceId?: string;
  sprintId?: string;
  parentId?: string;
  status?: WorkItemStatus;
  priority?: WorkItemPriority;
  storyPoints?: number;
  assignedAgentId?: string;
  assignedAgentType?: AgentType;
  workflowId?: string;
  labels?: string[];
  acceptanceCriteria?: string[];
  loopStatus?: LoopStatus;
}): WorkItem {
  const id = generateId();
  const key = nextWorkItemKey();
  const timestamp = now();

  getDatabase()
    .prepare(
      `INSERT INTO work_item
       (id, key, workspace_id, sprint_id, parent_id, type, title, description, status, priority,
        story_points, assigned_agent_id, assigned_agent_type, workflow_id, labels, acceptance_criteria,
        loop_iteration, max_loop_iterations, loop_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      key,
      input.workspaceId ?? null,
      input.sprintId ?? null,
      input.parentId ?? null,
      input.type,
      input.title,
      input.description ?? null,
      input.status ?? 'backlog',
      input.priority ?? 'medium',
      input.storyPoints ?? null,
      input.assignedAgentId ?? null,
      input.assignedAgentType ?? null,
      input.workflowId ?? null,
      JSON.stringify(input.labels ?? []),
      JSON.stringify(input.acceptanceCriteria ?? []),
      0,
      DEFAULT_MAX_LOOP_ITERATIONS,
      input.loopStatus ?? 'idle',
      timestamp,
      timestamp
    );

  const item = mapWorkItem(
    getDatabase().prepare('SELECT * FROM work_item WHERE id = ?').get(id) as WorkItemRow
  );

  logWorkItemActivity({
    workItemId: id,
    activityType: 'comment',
    summary: `Created ${input.type} ${key}`,
  });

  notifyWorkItem(item);
  return item;
}

export function listWorkItems(filters: {
  sprintId?: string;
  workspaceId?: string;
  parentId?: string;
  status?: WorkItemStatus;
  type?: WorkItemType;
} = {}): WorkItem[] {
  const db = getDatabase();
  let sql = 'SELECT * FROM work_item WHERE 1=1';
  const params: unknown[] = [];

  if (filters.sprintId) {
    sql += ' AND sprint_id = ?';
    params.push(filters.sprintId);
  }
  if (filters.workspaceId) {
    sql += ' AND workspace_id = ?';
    params.push(filters.workspaceId);
  }
  if (filters.parentId) {
    sql += ' AND parent_id = ?';
    params.push(filters.parentId);
  }
  if (filters.status) {
    sql += ' AND status = ?';
    params.push(filters.status);
  }
  if (filters.type) {
    sql += ' AND type = ?';
    params.push(filters.type);
  }

  sql += ' ORDER BY updated_at DESC';
  const rows = db.prepare(sql).all(...params) as WorkItemRow[];
  return rows.map(mapWorkItem);
}

export function getWorkItem(id: string): WorkItem | null {
  const row = getDatabase().prepare('SELECT * FROM work_item WHERE id = ?').get(id) as WorkItemRow | undefined;
  return row ? mapWorkItem(row) : null;
}

export function updateWorkItem(
  id: string,
  updates: Partial<
    Pick<
      WorkItem,
      | 'title'
      | 'description'
      | 'status'
      | 'priority'
      | 'storyPoints'
      | 'sprintId'
      | 'parentId'
      | 'assignedAgentId'
      | 'assignedAgentType'
      | 'workflowId'
      | 'labels'
      | 'acceptanceCriteria'
      | 'loopIteration'
      | 'maxLoopIterations'
      | 'loopStatus'
      | 'workspaceId'
    >
  >
): WorkItem | null {
  const existing = getWorkItem(id);
  if (!existing) return null;

  const title = updates.title ?? existing.title;
  const description = updates.description ?? existing.description;
  const status = updates.status ?? existing.status;
  const priority = updates.priority ?? existing.priority;
  const storyPoints = updates.storyPoints ?? existing.storyPoints;
  const sprintId = updates.sprintId ?? existing.sprintId;
  const parentId = updates.parentId ?? existing.parentId;
  const assignedAgentId = updates.assignedAgentId ?? existing.assignedAgentId;
  const assignedAgentType = updates.assignedAgentType ?? existing.assignedAgentType;
  const workflowId = updates.workflowId ?? existing.workflowId;
  const labels = updates.labels ?? existing.labels;
  const acceptanceCriteria = updates.acceptanceCriteria ?? existing.acceptanceCriteria;
  const loopIteration = updates.loopIteration ?? existing.loopIteration;
  const maxLoopIterations = updates.maxLoopIterations ?? existing.maxLoopIterations;
  const loopStatus = updates.loopStatus ?? existing.loopStatus;
  const workspaceId = updates.workspaceId ?? existing.workspaceId;
  const timestamp = now();

  getDatabase()
    .prepare(
      `UPDATE work_item SET title = ?, description = ?, status = ?, priority = ?, story_points = ?,
       sprint_id = ?, parent_id = ?, workspace_id = ?, assigned_agent_id = ?, assigned_agent_type = ?, workflow_id = ?,
       labels = ?, acceptance_criteria = ?, loop_iteration = ?, max_loop_iterations = ?, loop_status = ?,
       updated_at = ? WHERE id = ?`
    )
    .run(
      title,
      description ?? null,
      status,
      priority,
      storyPoints ?? null,
      sprintId ?? null,
      parentId ?? null,
      workspaceId ?? null,
      assignedAgentId ?? null,
      assignedAgentType ?? null,
      workflowId ?? null,
      JSON.stringify(labels),
      JSON.stringify(acceptanceCriteria),
      loopIteration,
      maxLoopIterations,
      loopStatus,
      timestamp,
      id
    );

  if (updates.status && updates.status !== existing.status) {
    logWorkItemActivity({
      workItemId: id,
      activityType: 'status_change',
      summary: `Status changed from ${existing.status} to ${updates.status}`,
      metadata: { from: existing.status, to: updates.status },
    });
  }

  const item = getWorkItem(id)!;
  notifyWorkItem(item);
  return item;
}

export function deleteWorkItem(id: string): boolean {
  const existing = getWorkItem(id);
  if (!existing) return false;

  getDatabase().prepare('DELETE FROM work_item WHERE id = ?').run(id);

  broadcast({
    type: 'work_item:update',
    payload: { deleted: true, id, key: existing.key },
    timestamp: now(),
  });

  return true;
}

export function getBoard(sprintId?: string): WorkBoard {
  const items = listWorkItems(sprintId ? { sprintId } : {});
  const columns = Object.fromEntries(BOARD_COLUMNS.map((c) => [c, [] as WorkItem[]])) as Record<
    WorkItemStatus,
    WorkItem[]
  >;

  let points = 0;
  for (const item of items) {
    columns[item.status].push(item);
    if (item.storyPoints) points += item.storyPoints;
  }

  return {
    sprint: sprintId ? getSprint(sprintId) ?? undefined : undefined,
    columns,
    totals: { items: items.length, points },
  };
}

/** Mark work item busy and log queue event before background worker picks up the job. */
export function prepareWorkItemAgentRun(id: string, jobId: string): WorkItem {
  const item = getWorkItem(id);
  if (!item) throw new Error('Work item not found');

  logWorkItemActivity({
    workItemId: id,
    activityType: 'comment',
    summary: `Agent run queued (job ${jobId.slice(0, 8)}…)`,
    agentType: item.assignedAgentType,
    agentId: item.assignedAgentId,
    metadata: { event: 'agent_queued', jobId },
  });

  return updateWorkItem(id, { status: 'in_progress' })!;
}

export async function runWorkItemAgent(id: string): Promise<{
  item: WorkItem;
  result: { content: string; agentType: AgentType; auditId: string };
}> {
  const item = getWorkItem(id);
  if (!item) throw new Error('Work item not found');

  const agentType = item.assignedAgentType || 'mock';
  updateWorkItem(id, { status: 'in_progress' });

  logWorkItemActivity({
    workItemId: id,
    activityType: 'agent_started',
    summary: `Agent ${agentType} started work on ${item.key}`,
    agentType,
    agentId: item.assignedAgentId,
  });

  const criteria =
    item.acceptanceCriteria.length > 0
      ? `\n\nAcceptance criteria:\n${item.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}`
      : '';

  try {
    const { buildWorkItemContextScope, resolveWorkItemOutputDir, resolveWorkItemWorkDir } =
      await import('./work-item-context');
    const contextRoot = resolveWorkItemWorkDir(item);
    const workDir = resolveWorkItemOutputDir(item) ?? contextRoot;
    const { scope, auditFilePaths, basePath } = buildWorkItemContextScope(item, contextRoot, {
      includeDiffs: true,
    });
    const filesBefore = snapshotWorkDirFiles(workDir);
    const { executeOutboundPipeline } = await import('./outbound-pipeline');
    const pipeline = await executeOutboundPipeline({
      agentType,
      prompt: buildWorkItemAgentPrompt(item, criteria, workDir),
      contextScope: scope,
      capability: item.type === 'bug' ? 'analysis' : 'implementation',
      agentId: item.assignedAgentId,
      workflowId: item.workflowId,
      task: `${item.key}/${item.title}`,
      workItemId: id,
      workspaceId: item.workspaceId,
      basePath,
      outputDir: workDir,
      filePaths: auditFilePaths,
    });

    const { created: filesCreated, updated: filesUpdated } = diffWorkDirFiles(
      filesBefore,
      snapshotWorkDirFiles(workDir)
    );
    const wantsFiles = /file|\.txt|\.md|create|write|generate/i.test(
      `${item.title} ${item.description || ''}`
    );
    const hasFileArtifacts = filesCreated.length > 0 || filesUpdated.length > 0;
    const fileWarning =
      wantsFiles && workDir && !hasFileArtifacts
        ? `\n\n⚠️ No new files were detected in ${workDir}. The agent may have only replied with text. ` +
          'Re-run the agent; implementation tasks grant CLI write access to the work directory. ' +
          `If it still fails, verify the agent CLI can write to ${workDir} (Grok: bypassPermissions, Copilot: --allow-all-paths).`
        : '';

    const fileOutcome =
      filesCreated.length > 0
        ? `\n\nFiles created: ${filesCreated.join(', ')}`
        : filesUpdated.length > 0
          ? `\n\nFiles updated: ${filesUpdated.join(', ')}`
          : '';

    const resultContent = pipeline.content + fileWarning + fileOutcome;

    updateWorkItem(id, { status: 'in_review' });

    const fileSummary =
      filesCreated.length > 0
        ? `created ${filesCreated.join(', ')}`
        : filesUpdated.length > 0
          ? `updated ${filesUpdated.join(', ')}`
          : null;

    const completedSummary = pipeline.fallbackFrom
      ? `Agent ${pipeline.fallbackFrom} unavailable — mock completed ${item.key} instead`
      : fileSummary
        ? `Agent ${pipeline.agentType} completed ${item.key} — ${fileSummary}`
        : `Agent ${pipeline.agentType} completed work on ${item.key}`;

    logWorkItemActivity({
      workItemId: id,
      activityType: 'agent_completed',
      summary: completedSummary,
      agentType: pipeline.fallbackFrom ?? pipeline.agentType,
      agentId: item.assignedAgentId,
      auditId: pipeline.auditId,
      metadata: {
        tokenCount: pipeline.tokenCount,
        content: resultContent,
        agentType: pipeline.agentType,
        requestedAgentType: pipeline.requestedAgentType,
        fallbackFrom: pipeline.fallbackFrom,
        workDir: workDir ?? null,
        filesCreated,
        filesUpdated,
        fileWarning: fileWarning.trim() || undefined,
      },
    });

    return {
      item: getWorkItem(id)!,
      result: {
        content: resultContent,
        agentType: pipeline.agentType,
        auditId: pipeline.auditId,
      },
    };
  } catch (err) {
    logWorkItemActivity({
      workItemId: id,
      activityType: 'agent_failed',
      summary: `Agent failed on ${item.key}: ${(err as Error).message}`,
      agentType,
      agentId: item.assignedAgentId,
      metadata: { error: (err as Error).message },
    });
    updateWorkItem(id, { status: 'todo' });
    throw err;
  }
}

/** Seed demo Agile data when empty. */
export function seedDemoWorkItems(): void {
  const count = getDatabase().prepare('SELECT COUNT(*) as c FROM work_item').get() as { c: number };
  if (count.c > 0) return;

  const sprint = createSprint('Sprint 1', {
    goal: 'AgentHub Agile board MVP',
    status: 'active',
    startDate: now().slice(0, 10),
  });

  const epic = createWorkItem({
    type: 'epic',
    title: 'Agent visibility & orchestration',
    description: 'Give humans Jira-like visibility into agent work.',
    sprintId: sprint.id,
    storyPoints: 13,
    priority: 'high',
    status: 'in_progress',
  });

  createWorkItem({
    type: 'story',
    title: 'As a user I can see a Scrum board of agent work',
    description: 'Kanban columns: backlog → done with drag-friendly statuses.',
    sprintId: sprint.id,
    parentId: epic.id,
    storyPoints: 5,
    assignedAgentType: 'mock',
    status: 'in_review',
    acceptanceCriteria: ['Board shows all columns', 'Each card shows assigned agent', 'Activity feed per item'],
  });

  createWorkItem({
    type: 'story',
    title: 'As a user I can run an agent on a story',
    description: 'Trigger mock or real agent; activity logged to audit.',
    sprintId: sprint.id,
    parentId: epic.id,
    storyPoints: 3,
    assignedAgentType: 'mock',
    status: 'todo',
    acceptanceCriteria: ['Run agent button works', 'Status moves to in_review', 'Audit entry linked'],
  });

  createWorkItem({
    type: 'task',
    title: 'Wire work item activity to audit logger',
    sprintId: sprint.id,
    parentId: epic.id,
    storyPoints: 2,
    assignedAgentType: 'mock',
    status: 'backlog',
  });

  createWorkItem({
    type: 'bug',
    title: 'Workflow failure should surface on board',
    sprintId: sprint.id,
    storyPoints: 1,
    priority: 'critical',
    assignedAgentType: 'mock',
    status: 'backlog',
  });
}