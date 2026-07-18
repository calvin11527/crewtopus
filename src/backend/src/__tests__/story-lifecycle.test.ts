import fs from 'fs';
import os from 'os';
import path from 'path';
import { createSprint, createWorkItem, updateWorkItem } from '../modules/work-items';
import { hireNewAgent } from '../modules/agent-employment';
import { setSprintTeam } from '../modules/sprint-team';
import {
  getStoryLifecyclePhase,
  LIFECYCLE_LABEL_BA_DONE,
  LIFECYCLE_LABEL_PM_DONE,
  listStoryChildren,
  nextRunnableDevItem,
  nextStoryNeedingBa,
  nextStoryNeedingPm,
  parsePmDecomposition,
  recoverStuckStory,
  runStoryBaPhase,
  runStoryPmPhase,
} from '../modules/story-lifecycle';
import { resolveWorkItemOutputDir } from '../modules/work-item-context';

const ALWAYS_ON_SHIFT = [{ dow: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59' }];

describe('story-lifecycle', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agenthub-lifecycle-'));
    process.env.AGENTHUB_WORK_DIR = tmpRoot;
  });

  afterEach(() => {
    delete process.env.AGENTHUB_WORK_DIR;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function staffLifecycleTeam(sprintId: string) {
    const ba = hireNewAgent({
      name: 'BA',
      type: 'mock',
      role: 'business_analyst',
      workingHours: ALWAYS_ON_SHIFT,
      timezone: 'UTC',
    });
    const pm = hireNewAgent({
      name: 'PM',
      type: 'mock',
      role: 'project_manager',
      workingHours: ALWAYS_ON_SHIFT,
      timezone: 'UTC',
    });
    const dev = hireNewAgent({
      name: 'Dev',
      type: 'mock',
      role: 'developer',
      workingHours: ALWAYS_ON_SHIFT,
      timezone: 'UTC',
    });
    setSprintTeam(sprintId, [
      { agentId: ba.id, role: 'business_analyst' },
      { agentId: pm.id, role: 'project_manager' },
      { agentId: dev.id, role: 'developer' },
    ]);
    return { ba, pm, dev };
  }

  it('detects ba_pending and advances through pm to child tasks', async () => {
    const sprint = createSprint('Lifecycle sprint', { status: 'active' });
    staffLifecycleTeam(sprint.id);

    const story = createWorkItem({
      type: 'story',
      title: 'User can export board data',
      description: 'Export sprint board to CSV.',
      sprintId: sprint.id,
      status: 'todo',
    });

    expect(getStoryLifecyclePhase(story)).toBe('ba_pending');
    expect(nextStoryNeedingBa(sprint.id)?.id).toBe(story.id);

    const baResult = await runStoryBaPhase(story.id, sprint.id);
    expect(baResult.item.labels).toContain(LIFECYCLE_LABEL_BA_DONE);
    expect(getStoryLifecyclePhase(baResult.item)).toBe('pm_pending');
    expect(nextStoryNeedingPm(sprint.id)?.id).toBe(story.id);

    const pmResult = await runStoryPmPhase(story.id, sprint.id);
    expect(pmResult.item.labels).toContain(LIFECYCLE_LABEL_PM_DONE);
    expect(pmResult.children.length).toBe(2);
    expect(getStoryLifecyclePhase(pmResult.item)).toBe('tracking');

    const nextDev = nextRunnableDevItem(sprint.id);
    expect(nextDev?.type).toBe('task');
    expect(nextDev?.parentId).toBe(story.id);
  });

  it('recovers in_review stories that already have plan.md', () => {
    const sprint = createSprint('Recover sprint');
    const story = createWorkItem({
      type: 'story',
      title: 'Stuck story',
      sprintId: sprint.id,
      status: 'in_review',
    });

    const workDir = resolveWorkItemOutputDir(story)!;
    fs.writeFileSync(path.join(workDir, 'plan.md'), '# Plan\nDo the thing.');

    const recovered = recoverStuckStory(story);
    expect(recovered?.labels).toContain(LIFECYCLE_LABEL_BA_DONE);
    expect(recovered?.status).toBe('todo');
    expect(getStoryLifecyclePhase(recovered!)).toBe('pm_pending');
  });

  it('parses PM JSON decomposition', () => {
    const parsed = parsePmDecomposition(
      'Split work as follows.\n```json\n{"atomic":false,"tasks":[{"title":"Build API","storyPoints":3}]}\n```'
    );
    expect(parsed?.atomic).toBe(false);
    expect(parsed?.tasks).toHaveLength(1);
    expect(parsed?.tasks[0].title).toBe('Build API');
  });

  it('rolls parent story to in_review when all child tasks are done', async () => {
    const sprint = createSprint('Rollup sprint');
    staffLifecycleTeam(sprint.id);

    const story = createWorkItem({
      type: 'story',
      title: 'Parent story',
      sprintId: sprint.id,
      status: 'in_progress',
      labels: [LIFECYCLE_LABEL_BA_DONE, LIFECYCLE_LABEL_PM_DONE],
    });

    const child = createWorkItem({
      type: 'task',
      title: 'Child task',
      sprintId: sprint.id,
      parentId: story.id,
      status: 'done',
    });

    expect(listStoryChildren(story.id)).toHaveLength(1);
    updateWorkItem(child.id, { status: 'done' });

    const { checkParentStoryRollup } = await import('../modules/story-lifecycle');
    const parent = checkParentStoryRollup(story.id);
    expect(parent?.status).toBe('in_review');
  });
});