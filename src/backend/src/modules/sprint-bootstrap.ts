import type { Sprint, WorkItem } from '../types';
import { createWorkItem, getSprint, listWorkItems, updateSprint, updateWorkItem } from './work-items';
import { logWorkItemActivity } from './work-item-activity';
import { resolveStoryQueueItems } from './story-queue';
import { startFullLifecycle, type FullLifecycleStartResult } from './full-lifecycle';
import { startStoryQueueAsync, type StoryQueueOptions, type StoryQueueResult } from './story-queue';
import { listWorkspaces, getPrimaryRepository } from './workspace';

/** Prefer sprint workspace, then name match, then any workspace with a primary repo. */
export function resolveBootstrapWorkspaceId(sprint: Sprint): string | undefined {
  if (sprint.workspaceId) return sprint.workspaceId;

  const workspaces = listWorkspaces();
  if (workspaces.length === 0) return undefined;

  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const sprintKey = normalize(sprint.name);

  const byName = workspaces.find((w) => {
    const n = normalize(w.name);
    return n.length >= 4 && (sprintKey.includes(n) || n.includes(sprintKey.slice(0, 16)));
  });
  if (byName) return byName.id;

  for (const w of workspaces) {
    if (getPrimaryRepository(w.id)) return w.id;
  }
  return workspaces[0]?.id;
}

export interface SprintBootstrapResult {
  bootstrapped: boolean;
  epic?: WorkItem;
  seedStory?: WorkItem;
  items: WorkItem[];
}

export interface SprintQueueStartResult {
  mode: 'story_queue' | 'full_lifecycle';
  bootstrapped: boolean;
  message: string;
  /** Present when mode is story_queue (poll via /work-items/queue/:queueId). */
  queue?: StoryQueueResult;
  /** Present when mode is full_lifecycle (poll via /work-items/jobs/:jobId). */
  lifecycle?: FullLifecycleStartResult & { message: string };
  epic?: WorkItem;
  seedStory?: WorkItem;
}

/** Short title from a possibly multi-line sprint goal (never put full docs in work-item title). */
export function shortTitleFromText(text: string, maxLen = 90): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let head = '';
  for (const line of lines) {
    const cleaned = line
      .trim()
      .replace(/^\>\s*/, '')
      .replace(/\*\*/g, '')
      .replace(/^#+\s*/, '')
      .replace(/^(Epic|Story|Task|Plan and deliver):\s*#+\s*/i, '$1: ')
      .replace(/\s+#+\s*/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (cleaned) {
      head = cleaned;
      break;
    }
  }
  if (!head) head = text.trim().slice(0, maxLen) || 'Untitled';
  if (head.length <= maxLen) return head;
  return `${head.slice(0, maxLen - 1)}…`;
}

function buildSeedStoryDescription(sprint: Sprint): string {
  const goal = sprint.goal?.trim();
  return (
    `AGENTHUB_SPRINT_BOOTSTRAP\n\n` +
    `This story was auto-created because "Run sprint queue" was started on an empty sprint.\n\n` +
    `Sprint: ${sprint.name}\n` +
    (goal ? `Sprint goal:\n\n${goal}\n` : 'Sprint goal: (not set — propose a focused delivery goal)\n') +
    `\nRole hand-off for staffed agents:\n` +
    `1. Business analyst — elicit requirements, write requirements.md + plan.md, define acceptance criteria.\n` +
    `2. Project manager — decide if work is atomic or decompose into developer tasks with clear outcomes.\n` +
    `3. Developer / tester / reviewer — implement, validate, and review until approved.\n\n` +
    `Scope: improve or deliver outcomes for the linked workspace / product. Prefer concrete files and ` +
    `testable criteria over vague planning. If the sprint has no goal, invent a small, high-value MVP ` +
    `slice appropriate for a single sprint iteration.`
  );
}

/**
 * When a sprint has no runnable stories/tasks, create an epic + seed story so
 * BA → PM → developer agents have something to plan and execute.
 */
export function bootstrapEmptySprint(sprintId: string): SprintBootstrapResult {
  const existing = resolveStoryQueueItems({ sprintId });
  if (existing.length > 0) {
    return { bootstrapped: false, items: existing };
  }

  let sprint = getSprint(sprintId);
  if (!sprint) throw new Error('Sprint not found');

  const workspaceId = resolveBootstrapWorkspaceId(sprint);
  if (workspaceId && !sprint.workspaceId) {
    sprint = updateSprint(sprint.id, { workspaceId }) ?? sprint;
  }

  const allItems = listWorkItems({ sprintId });
  let epic = allItems.find((item) => item.type === 'epic' && item.status !== 'done');

  if (!epic) {
    const goal = sprint.goal?.trim();
    const epicTitle = goal
      ? `Epic: ${shortTitleFromText(goal, 80)}`
      : `Sprint delivery — ${shortTitleFromText(sprint.name, 60)}`;
    epic = createWorkItem({
      type: 'epic',
      title: epicTitle,
      description:
        `Auto-created when the sprint queue ran with no epic/story/task.\n\n` +
        `Sprint: ${sprint.name}\n\n` +
        (goal
          ? `## Sprint goal\n\n${goal}\n\n`
          : '## Sprint goal\n\n(not set — propose a focused delivery goal)\n\n') +
        `Staffed agents (BA, PM, developer, tester, reviewer) should plan and deliver under this epic.`,
      sprintId: sprint.id,
      workspaceId: workspaceId ?? sprint.workspaceId,
      status: 'in_progress',
      priority: 'high',
      labels: ['sprint-bootstrap', 'automation'],
      acceptanceCriteria: [
        'Child stories/tasks created via BA/PM planning',
        'At least one child reaches review or done',
        'Sprint goal (or proposed MVP) has a clear delivery path',
      ],
    });

    logWorkItemActivity({
      workItemId: epic.id,
      activityType: 'comment',
      summary: `Sprint bootstrap created epic ${epic.key} for empty sprint "${sprint.name}"`,
      metadata: {
        event: 'sprint_bootstrap_epic',
        sprintId: sprint.id,
        sprintName: sprint.name,
      },
    });
  }

  const seedStory = createWorkItem({
    type: 'story',
    title: sprint.goal?.trim()
      ? `Plan and deliver: ${shortTitleFromText(sprint.goal, 70)}`
      : `Define and deliver outcomes for ${shortTitleFromText(sprint.name, 50)}`,
    description: buildSeedStoryDescription(sprint),
    parentId: epic.id,
    sprintId: sprint.id,
    workspaceId: workspaceId ?? sprint.workspaceId ?? epic.workspaceId,
    status: 'todo',
    priority: 'high',
    labels: ['sprint-bootstrap', 'lifecycle'],
    acceptanceCriteria: [
      'BA produces requirements.md and plan.md (or equivalent) in the work directory',
      'PM marks the story atomic or creates developer tasks',
      'Developer pipeline implements deliverables and review passes or escalates with feedback',
    ],
  });

  logWorkItemActivity({
    workItemId: seedStory.id,
    activityType: 'comment',
    summary: `Sprint bootstrap created seed story ${seedStory.key} — agents will plan and execute`,
    metadata: {
      event: 'sprint_bootstrap_story',
      sprintId: sprint.id,
      epicId: epic.id,
      epicKey: epic.key,
    },
  });

  logWorkItemActivity({
    workItemId: epic.id,
    activityType: 'comment',
    summary: `Seed story ${seedStory.key} added under epic for agent planning`,
    metadata: {
      event: 'sprint_bootstrap_story_linked',
      storyId: seedStory.id,
      storyKey: seedStory.key,
    },
  });

  return {
    bootstrapped: true,
    epic,
    seedStory,
    items: [seedStory],
  };
}

/**
 * Start sprint queue: bootstrap empty sprints, prefer BA→PM→pipeline on seed story,
 * otherwise run the serial story/task queue.
 */
export function startSprintQueue(
  sprintId: string,
  options: StoryQueueOptions = {}
): SprintQueueStartResult {
  const sprint = getSprint(sprintId);
  if (!sprint) throw new Error('Sprint not found');

  const ensured = bootstrapEmptySprint(sprintId);

  if (ensured.bootstrapped && ensured.seedStory) {
    try {
      const lifecycle = startFullLifecycle(ensured.seedStory.id, {
        maxIterations: options.maxIterations ?? 3,
        autoLoop: options.autoLoop !== false,
        orchestrator: 'sprint_queue_bootstrap',
      });

      return {
        mode: 'full_lifecycle',
        bootstrapped: true,
        message:
          `Sprint was empty — created ${ensured.epic?.key ?? 'epic'} / ${ensured.seedStory.key} ` +
          `and started full lifecycle (${lifecycle.step}: ${lifecycle.message})`,
        lifecycle: {
          ...lifecycle,
          message:
            `Sprint was empty — created ${ensured.epic?.key ?? 'epic'} / ${ensured.seedStory.key} ` +
            `and started full lifecycle (${lifecycle.step})`,
        },
        epic: ensured.epic,
        seedStory: ensured.seedStory,
      };
    } catch (err) {
      // No BA/PM staffed or lifecycle not runnable — fall back to developer pipeline queue
      const queue = startStoryQueueAsync(ensured.items, options);
      return {
        mode: 'story_queue',
        bootstrapped: true,
        message:
          `Sprint was empty — created seed work, then queued developer pipeline ` +
          `(full lifecycle unavailable: ${(err as Error).message})`,
        queue,
        epic: ensured.epic,
        seedStory: ensured.seedStory,
      };
    }
  }

  if (ensured.items.length === 0) {
    throw new Error('No runnable stories/tasks in this sprint');
  }

  const queue = startStoryQueueAsync(ensured.items, options);
  return {
    mode: 'story_queue',
    bootstrapped: false,
    message: `Queued ${ensured.items.length} story/task item(s)`,
    queue,
  };
}

/** Synchronous path for tests: bootstrap only (no agent run). */
export function ensureSprintRunnableItems(sprintId: string): SprintBootstrapResult {
  return bootstrapEmptySprint(sprintId);
}
