import fs from 'fs';
import os from 'os';
import path from 'path';
import { createSprint, createWorkItem, listWorkItems } from '../modules/work-items';
import { hireNewAgent } from '../modules/agent-employment';
import { setSprintTeam } from '../modules/sprint-team';
import {
  bootstrapEmptySprint,
  startSprintQueue,
} from '../modules/sprint-bootstrap';
import { resolveStoryQueueItems } from '../modules/story-queue';
import { getActiveJobForWorkItem } from '../modules/job-queue';

const ALWAYS_ON_SHIFT = [{ dow: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59' }];

describe('sprint-bootstrap', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agenthub-sprint-boot-'));
    process.env.AGENTHUB_WORK_DIR = tmpRoot;
  });

  afterEach(() => {
    delete process.env.AGENTHUB_WORK_DIR;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function staffBaPm(sprintId: string) {
    const ba = hireNewAgent({
      name: `BA ${Date.now()}`,
      type: 'mock',
      role: 'business_analyst',
      workingHours: ALWAYS_ON_SHIFT,
      timezone: 'UTC',
    });
    const pm = hireNewAgent({
      name: `PM ${Date.now()}`,
      type: 'mock',
      role: 'project_manager',
      workingHours: ALWAYS_ON_SHIFT,
      timezone: 'UTC',
    });
    setSprintTeam(sprintId, [
      { agentId: ba.id, role: 'business_analyst' },
      { agentId: pm.id, role: 'project_manager' },
    ]);
  }

  it('creates epic + seed story when sprint is empty', () => {
    const sprint = createSprint(`Empty ${Date.now()}`, {
      status: 'active',
      goal: 'Ship export CSV',
    });

    expect(resolveStoryQueueItems({ sprintId: sprint.id })).toHaveLength(0);

    const result = bootstrapEmptySprint(sprint.id);
    expect(result.bootstrapped).toBe(true);
    expect(result.epic?.type).toBe('epic');
    expect(result.seedStory?.type).toBe('story');
    expect(result.seedStory?.parentId).toBe(result.epic?.id);
    expect(result.items).toHaveLength(1);
    expect(result.epic?.title).toMatch(/Ship export CSV|Epic:/);

    const second = bootstrapEmptySprint(sprint.id);
    expect(second.bootstrapped).toBe(false);
    expect(second.items).toHaveLength(1);
  });

  it('reuses existing open epic when bootstrapping', () => {
    const sprint = createSprint(`Epic only ${Date.now()}`, { status: 'active' });
    const epic = createWorkItem({
      type: 'epic',
      title: 'Existing epic',
      sprintId: sprint.id,
      status: 'todo',
    });

    const result = bootstrapEmptySprint(sprint.id);
    expect(result.bootstrapped).toBe(true);
    expect(result.epic?.id).toBe(epic.id);
    expect(listWorkItems({ sprintId: sprint.id }).filter((i) => i.type === 'story')).toHaveLength(1);
  });

  it('starts full lifecycle when BA/PM are staffed on empty sprint', () => {
    const sprint = createSprint(`Lifecycle boot ${Date.now()}`, {
      status: 'active',
      goal: 'Improve board UX',
    });
    staffBaPm(sprint.id);

    const started = startSprintQueue(sprint.id, { maxIterations: 2 });
    expect(started.bootstrapped).toBe(true);
    expect(started.mode).toBe('full_lifecycle');
    expect(started.lifecycle?.step).toBe('ba');
    expect(started.seedStory).toBeTruthy();
    expect(getActiveJobForWorkItem(started.seedStory!.id)?.jobType).toBe('story_ba');
  });

  it('falls back to story queue when BA is not staffed', () => {
    const sprint = createSprint(`Queue fallback ${Date.now()}`, { status: 'active' });

    const started = startSprintQueue(sprint.id, { maxIterations: 1 });
    expect(started.bootstrapped).toBe(true);
    expect(started.mode).toBe('story_queue');
    expect(started.queue?.status).toBe('running');
    expect(started.queue?.workItemIds.length).toBe(1);
  });

  it('queues existing items without bootstrapping', () => {
    const sprint = createSprint(`Has work ${Date.now()}`, { status: 'active' });
    createWorkItem({
      type: 'task',
      title: 'Already there',
      sprintId: sprint.id,
      status: 'todo',
    });

    const started = startSprintQueue(sprint.id);
    expect(started.bootstrapped).toBe(false);
    expect(started.mode).toBe('story_queue');
    expect(started.queue?.workItemIds).toHaveLength(1);
  });
});
