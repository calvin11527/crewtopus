import fs from 'fs';
import path from 'path';
import type { AgentType, SprintAutomationPauseReason, WorkItem, WorkItemStatus } from '../types';
import { updateAgentStatus } from './agent-registry';
import { executeOutboundPipeline } from './outbound-pipeline';
import {
  buildWorkItemContextScope,
  resolveWorkItemOutputDir,
  resolveWorkItemWorkDir,
} from './work-item-context';
import { logWorkItemActivity } from './work-item-activity';
import { isSprintRoleOnShift, resolveSprintAgent } from './sprint-team';
import {
  createWorkItem,
  getWorkItem,
  listWorkItems,
  updateWorkItem,
} from './work-items';

export const LIFECYCLE_LABEL_BA_DONE = 'lifecycle:ba_done';
export const LIFECYCLE_LABEL_PM_DONE = 'lifecycle:pm_done';
export const LIFECYCLE_LABEL_ATOMIC = 'lifecycle:atomic';

const BA_ARTIFACTS = ['plan.md', 'requirements.md', 'implementation-guide.md'];
const BLOCKED_LOOP_STATUSES = new Set(['failed', 'escalated']);
const RUNNABLE_DEV_STATUSES: WorkItemStatus[] = ['todo', 'backlog'];

export type StoryLifecyclePhase =
  | 'ba_pending'
  | 'pm_pending'
  | 'dev_ready'
  | 'tracking'
  | 'complete'
  | 'n/a';

export interface PmTaskSpec {
  title: string;
  description?: string;
  acceptanceCriteria?: string[];
  storyPoints?: number;
}

export interface PmDecomposition {
  atomic: boolean;
  tasks: PmTaskSpec[];
}

export function hasLifecycleLabel(item: WorkItem, label: string): boolean {
  return item.labels.includes(label);
}

export function mergeLifecycleLabels(item: WorkItem, ...labels: string[]): string[] {
  const merged = new Set(item.labels);
  for (const label of labels) merged.add(label);
  return Array.from(merged);
}

export function listStoryChildren(storyId: string): WorkItem[] {
  return listWorkItems({ parentId: storyId }).sort((a, b) => a.key.localeCompare(b.key));
}

function storyHasLifecycleLabels(item: WorkItem): boolean {
  return item.labels.some((label) => label.startsWith('lifecycle:'));
}

export function storyHasBaArtifacts(workDir?: string): boolean {
  if (!workDir || !fs.existsSync(workDir)) return false;
  return BA_ARTIFACTS.some((name) => fs.existsSync(path.join(workDir, name)));
}

/** Recover stories stuck in in_review after a manual Run produced BA artifacts. */
export function recoverStuckStory(story: WorkItem): WorkItem | null {
  if (story.type !== 'story') return null;
  if (hasLifecycleLabel(story, LIFECYCLE_LABEL_BA_DONE)) return null;

  const workDir = resolveWorkItemOutputDir(story);
  if (!storyHasBaArtifacts(workDir)) return null;

  const labels = mergeLifecycleLabels(story, LIFECYCLE_LABEL_BA_DONE);
  const status: WorkItemStatus = story.status === 'in_review' ? 'todo' : story.status;
  const updated = updateWorkItem(story.id, { labels, status });

  logWorkItemActivity({
    workItemId: story.id,
    activityType: 'comment',
    summary: `Recovered ${story.key} from review — BA artifacts detected, advancing to PM phase`,
    metadata: { event: 'lifecycle_recover_ba', workDir },
  });

  return updated;
}

export function recoverStuckStoriesInSprint(sprintId: string): number {
  const stories = listWorkItems({ sprintId }).filter((item) => item.type === 'story');
  let recovered = 0;
  for (const story of stories) {
    if (recoverStuckStory(story)) recovered += 1;
  }
  return recovered;
}

export function getStoryLifecyclePhase(story: WorkItem): StoryLifecyclePhase {
  if (story.type !== 'story') return 'n/a';
  if (story.status === 'done') return 'complete';

  const children = listStoryChildren(story.id);
  const workDir = resolveWorkItemOutputDir(story);
  const baDone =
    hasLifecycleLabel(story, LIFECYCLE_LABEL_BA_DONE) || storyHasBaArtifacts(workDir);
  const pmDone = hasLifecycleLabel(story, LIFECYCLE_LABEL_PM_DONE);

  if (!baDone) return 'ba_pending';
  if (!pmDone && children.length === 0) return 'pm_pending';

  const openChildren = children.filter((c) => c.status !== 'done');
  if (children.length > 0 && openChildren.length > 0) return 'tracking';
  if (pmDone || hasLifecycleLabel(story, LIFECYCLE_LABEL_ATOMIC)) return 'dev_ready';
  if (!storyHasLifecycleLabels(story)) return 'dev_ready';

  return 'tracking';
}

function isDevRunnable(item: WorkItem): boolean {
  if (BLOCKED_LOOP_STATUSES.has(item.loopStatus)) return false;
  if (!RUNNABLE_DEV_STATUSES.includes(item.status)) return false;

  if (item.type === 'task' || item.type === 'bug') {
    if (!item.parentId) return true;
    const parent = getWorkItem(item.parentId);
    if (!parent || parent.type !== 'story') return true;
    return hasLifecycleLabel(parent, LIFECYCLE_LABEL_PM_DONE);
  }

  if (item.type !== 'story') return false;

  const phase = getStoryLifecyclePhase(item);
  if (phase === 'ba_pending' || phase === 'pm_pending') return false;
  if (phase === 'tracking') return false;
  if (phase === 'dev_ready') return true;

  return !storyHasLifecycleLabels(item);
}

export function nextStoryNeedingBa(sprintId: string): WorkItem | null {
  const stories = listWorkItems({ sprintId, type: 'story' })
    .filter((item) => RUNNABLE_DEV_STATUSES.includes(item.status) || item.status === 'in_review')
    .sort((a, b) => a.key.localeCompare(b.key));

  for (const story of stories) {
    if (getStoryLifecyclePhase(story) === 'ba_pending') return story;
  }
  return null;
}

export function nextStoryNeedingPm(sprintId: string): WorkItem | null {
  const stories = listWorkItems({ sprintId, type: 'story' })
    .filter((item) => ['todo', 'in_review', 'in_progress'].includes(item.status))
    .sort((a, b) => a.key.localeCompare(b.key));

  for (const story of stories) {
    if (getStoryLifecyclePhase(story) === 'pm_pending') return story;
  }
  return null;
}

/** Next work item ready for the developer Grok→Copilot pipeline. */
export function nextRunnableDevItem(sprintId: string): WorkItem | null {
  const items = listWorkItems({ sprintId })
    .filter((item) => item.type === 'story' || item.type === 'task' || item.type === 'bug')
    .filter((item) => RUNNABLE_DEV_STATUSES.includes(item.status))
    .sort((a, b) => a.key.localeCompare(b.key));

  const childTasks = items.filter(
    (item) => item.type === 'task' && item.parentId && isDevRunnable(item)
  );
  if (childTasks.length > 0) return childTasks[0];

  const runnable = items.filter((item) => isDevRunnable(item));
  return runnable[0] ?? null;
}

export function sprintLifecyclePauseReason(sprintId: string, at: Date): SprintAutomationPauseReason | null {
  if (nextStoryNeedingBa(sprintId) && !isSprintRoleOnShift(sprintId, 'business_analyst', at)) {
    return 'awaiting_ba';
  }
  if (nextStoryNeedingPm(sprintId) && !isSprintRoleOnShift(sprintId, 'project_manager', at)) {
    return 'awaiting_pm';
  }
  return null;
}

export function parseBaAcceptanceCriteria(content: string): string[] {
  const criteria: string[] = [];
  const section = content.match(/(?:acceptance criteria|definition of done)[:\s]*\n([\s\S]*?)(?:\n#{1,3}\s|\n```|$)/i);
  if (section) {
    for (const line of section[1].split('\n')) {
      const trimmed = line.replace(/^[-*•\d.)]+\s*/, '').trim();
      if (trimmed.length > 3) criteria.push(trimmed);
    }
  }
  if (criteria.length === 0) {
    const bullets = content.match(/^[-*•]\s+(.+)$/gm);
    if (bullets) {
      for (const match of bullets.slice(0, 8)) {
        const trimmed = match.replace(/^[-*•]\s+/, '').trim();
        if (trimmed.length > 3) criteria.push(trimmed);
      }
    }
  }
  return criteria.slice(0, 12);
}

export function parsePmDecomposition(content: string): PmDecomposition | null {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], content].filter(Boolean) as string[];

  for (const raw of candidates) {
    const jsonStart = raw.indexOf('{');
    const jsonEnd = raw.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd <= jsonStart) continue;
    try {
      const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as {
        atomic?: boolean;
        tasks?: PmTaskSpec[];
      };
      const tasks = Array.isArray(parsed.tasks)
        ? parsed.tasks.filter((t) => t && typeof t.title === 'string' && t.title.trim())
        : [];
      return { atomic: Boolean(parsed.atomic), tasks };
    } catch {
      /* try next candidate */
    }
  }

  const taskLines = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^(\d+\.|[-*•])\s+/.test(line))
    .map((line) => line.replace(/^(\d+\.|[-*•])\s+/, '').trim())
    .filter((line) => line.length > 3);

  if (taskLines.length >= 2) {
    return {
      atomic: false,
      tasks: taskLines.map((title) => ({ title })),
    };
  }

  return null;
}

function writeBaArtifacts(workDir: string, content: string, story: WorkItem): void {
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(path.join(workDir, 'plan.md'), content, 'utf-8');
  if (!fs.existsSync(path.join(workDir, 'requirements.md'))) {
    const requirements =
      `# Requirements — ${story.key}\n\n` +
      `## Story\n${story.title}\n\n` +
      (story.description ? `## Description\n${story.description}\n\n` : '') +
      `## Analysis\n${content}\n`;
    fs.writeFileSync(path.join(workDir, 'requirements.md'), requirements, 'utf-8');
  }
}

/** Keep agent prompts bounded when story descriptions contain full sprint docs. */
function clipForPrompt(text: string, maxChars = 6_000): string {
  const t = text.trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars)}\n\n[…truncated for agent prompt; full text remains on the work item…]`;
}

function buildBaPrompt(story: WorkItem, criteria: string, workDir: string): string {
  const body = clipForPrompt(story.description || '');
  return (
    `AGENTHUB_BA_PHASE\n\n` +
    `You are the business analyst for sprint delivery. Analyze this user story and produce implementation-ready requirements.\n\n` +
    `Work item ${story.key}: ${story.title}\n\n${body}${criteria}\n\n` +
    `Working directory (you have write access): ${workDir}\n\n` +
    `Deliverables — write these files into that working directory with file tools:\n` +
    `- requirements.md — problem statement, scope, constraints, and user flows\n` +
    `- plan.md — implementation guide with phased steps and risks\n\n` +
    `Also include a section titled "Acceptance criteria" with testable Given/When/Then bullets.\n` +
    `Prefer concise docs. If file tools fail, still return the full markdown in your final response ` +
    `so the harness can save it.`
  );
}

function buildPmPrompt(story: WorkItem, criteria: string, workDir: string, childCount: number): string {
  const body = clipForPrompt(story.description || '', 4_000);
  return (
    `AGENTHUB_PM_PHASE\n\n` +
    `You are the project manager decomposing a story into developer tasks.\n\n` +
    `Story ${story.key}: ${story.title}\n\n${body}${criteria}\n\n` +
    `Working directory (read BA artifacts here; you have write access): ${workDir}\n` +
    (childCount > 0 ? `Note: ${childCount} child task(s) already exist — do not duplicate.\n` : '') +
    `\nDecide whether the story is atomic (one developer can implement as-is) or should be split.\n` +
    `End your response with a fenced JSON block in exactly this shape:\n` +
    '```json\n' +
    '{\n' +
    '  "atomic": false,\n' +
    '  "tasks": [\n' +
    '    {\n' +
    '      "title": "Short task title",\n' +
    '      "description": "What to implement",\n' +
    '      "acceptanceCriteria": ["Testable outcome"],\n' +
    '      "storyPoints": 2\n' +
    '    }\n' +
    '  ]\n' +
    '}\n' +
    '```\n' +
    `Set "atomic": true and "tasks": [] if the story should not be split.\n` +
    `Create 2–6 concrete developer tasks when splitting — these become board work items automatically.`
  );
}

async function runLifecycleAgent(input: {
  story: WorkItem;
  sprintId: string;
  role: 'business_analyst' | 'project_manager';
  capability: 'analysis' | 'planning';
  prompt: string;
  workDir: string;
}): Promise<{ content: string; agentType: AgentType; auditId: string }> {
  const agent = resolveSprintAgent(input.sprintId, input.role);
  if (!agent) throw new Error(`No ${input.role.replace('_', ' ')} staffed for sprint`);

  const contextRoot = resolveWorkItemWorkDir(input.story);
  const { scope, auditFilePaths, basePath } = buildWorkItemContextScope(input.story, contextRoot, {
    includeDiffs: true,
  });

  updateAgentStatus(agent.id, 'running');
  try {
    const pipeline = await executeOutboundPipeline({
      agentType: agent.type,
      agentId: agent.id,
      prompt: input.prompt,
      contextScope: scope,
      capability: input.capability,
      pipelinePhase: 'planning',
      workflowId: input.story.workflowId,
      task: `${input.story.key}/${input.role}`,
      workItemId: input.story.id,
      workspaceId: input.story.workspaceId,
      basePath,
      outputDir: input.workDir,
      filePaths: auditFilePaths,
    });
    return { content: pipeline.content, agentType: pipeline.agentType, auditId: pipeline.auditId };
  } finally {
    updateAgentStatus(agent.id, 'idle');
  }
}

export async function runStoryBaPhase(
  workItemId: string,
  sprintId: string
): Promise<{ item: WorkItem; content: string; agentType: AgentType; auditId: string }> {
  const story = getWorkItem(workItemId);
  if (!story || story.type !== 'story') throw new Error('Story work item not found');

  const workDir = resolveWorkItemOutputDir(story);

  const criteria =
    story.acceptanceCriteria.length > 0
      ? `\n\nExisting acceptance criteria:\n${story.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}`
      : '';

  const ba = resolveSprintAgent(sprintId, 'business_analyst');
  updateWorkItem(workItemId, {
    status: 'in_progress',
    assignedAgentId: ba?.id,
    assignedAgentType: ba?.type,
  });

  const result = await runLifecycleAgent({
    story,
    sprintId,
    role: 'business_analyst',
    capability: 'analysis',
    prompt: buildBaPrompt(story, criteria, workDir),
    workDir,
  });

  writeBaArtifacts(workDir, result.content, story);
  const parsedCriteria = parseBaAcceptanceCriteria(result.content);
  const acceptanceCriteria =
    parsedCriteria.length > 0
      ? Array.from(new Set([...story.acceptanceCriteria, ...parsedCriteria]))
      : story.acceptanceCriteria;

  const item = updateWorkItem(workItemId, {
    status: 'todo',
    labels: mergeLifecycleLabels(story, LIFECYCLE_LABEL_BA_DONE),
    acceptanceCriteria,
  })!;

  logWorkItemActivity({
    workItemId,
    activityType: 'agent_completed',
    summary: `Business analyst completed requirements for ${story.key}`,
    agentType: result.agentType,
    agentId: ba?.id,
    auditId: result.auditId,
    metadata: {
      event: 'lifecycle_ba_complete',
      sprintId,
      workDir,
      acceptanceCriteriaAdded: parsedCriteria.length,
    },
  });

  return { item, content: result.content, agentType: result.agentType, auditId: result.auditId };
}

export async function runStoryPmPhase(
  workItemId: string,
  sprintId: string
): Promise<{ item: WorkItem; children: WorkItem[]; content: string; agentType: AgentType; auditId: string }> {
  const story = getWorkItem(workItemId);
  if (!story || story.type !== 'story') throw new Error('Story work item not found');

  const workDir = resolveWorkItemOutputDir(story);

  const existingChildren = listStoryChildren(story.id);
  const criteria =
    story.acceptanceCriteria.length > 0
      ? `\n\nAcceptance criteria:\n${story.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}`
      : '';

  const pm = resolveSprintAgent(sprintId, 'project_manager');
  updateWorkItem(workItemId, {
    status: 'in_progress',
    assignedAgentId: pm?.id,
    assignedAgentType: pm?.type,
  });

  const result = await runLifecycleAgent({
    story,
    sprintId,
    role: 'project_manager',
    capability: 'planning',
    prompt: buildPmPrompt(story, criteria, workDir, existingChildren.length),
    workDir,
  });

  const decomposition = parsePmDecomposition(result.content);
  const developer = resolveSprintAgent(sprintId, 'developer');
  const children: WorkItem[] = [...existingChildren];

  let labels = mergeLifecycleLabels(story, LIFECYCLE_LABEL_PM_DONE);
  let status: WorkItemStatus = 'in_progress';

  if (decomposition?.atomic || !decomposition || decomposition.tasks.length === 0) {
    labels = [...labels, LIFECYCLE_LABEL_ATOMIC];
    status = 'todo';
  } else if (existingChildren.length === 0) {
    for (const spec of decomposition.tasks) {
      const child = createWorkItem({
        type: 'task',
        title: spec.title.trim(),
        description: spec.description,
        parentId: story.id,
        sprintId: story.sprintId,
        workspaceId: story.workspaceId,
        status: 'todo',
        storyPoints: spec.storyPoints,
        assignedAgentId: developer?.id,
        assignedAgentType: developer?.type ?? story.assignedAgentType,
        acceptanceCriteria: spec.acceptanceCriteria ?? [],
        labels: ['lifecycle:pm_child'],
      });
      children.push(child);
    }
    status = 'todo';
  } else {
    status = children.every((c) => c.status === 'done') ? 'in_review' : 'todo';
  }

  const item = updateWorkItem(workItemId, { labels, status })!;

  logWorkItemActivity({
    workItemId,
    activityType: 'agent_completed',
    summary:
      children.length > existingChildren.length
        ? `Project manager decomposed ${story.key} into ${children.length - existingChildren.length} task(s)`
        : decomposition?.atomic
          ? `Project manager marked ${story.key} as atomic — ready for developer pipeline`
          : `Project manager completed planning for ${story.key}`,
    agentType: result.agentType,
    agentId: pm?.id,
    auditId: result.auditId,
    metadata: {
      event: 'lifecycle_pm_complete',
      sprintId,
      atomic: decomposition?.atomic ?? false,
      childTaskIds: children.map((c) => c.id),
      childTaskKeys: children.map((c) => c.key),
    },
  });

  return {
    item,
    children,
    content: result.content,
    agentType: result.agentType,
    auditId: result.auditId,
  };
}

/** Roll parent story forward when all child tasks finish. */
export function checkParentStoryRollup(parentId: string): WorkItem | null {
  const parent = getWorkItem(parentId);
  if (!parent || parent.type !== 'story') return null;

  const children = listStoryChildren(parentId);
  if (children.length === 0) return null;

  const allDone = children.every((c) => c.status === 'done');
  const anyActive = children.some((c) => c.status === 'in_progress' || c.loopStatus === 'running');

  if (allDone && parent.status !== 'done' && parent.status !== 'in_review') {
    return updateWorkItem(parentId, { status: 'in_review' });
  }
  if (anyActive && (parent.status === 'todo' || parent.status === 'backlog')) {
    return updateWorkItem(parentId, { status: 'in_progress' });
  }
  if (!anyActive && !allDone && parent.status === 'in_progress') {
    return updateWorkItem(parentId, { status: 'todo' });
  }
  return parent;
}