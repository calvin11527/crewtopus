import fs from 'fs';
import os from 'os';
import path from 'path';
import { createSprint, createWorkItem, updateWorkItem, getWorkItem } from '../modules/work-items';
import { hireNewAgent } from '../modules/agent-employment';
import { setSprintTeam } from '../modules/sprint-team';
import { getActiveJobForWorkItem } from '../modules/job-queue';
import {
  continueFullLifecycleChain,
  resolveFullLifecyclePipelineTarget,
  startFullLifecycle,
  runFullLifecycleSync,
} from '../modules/full-lifecycle';
import {
  getStoryLifecyclePhase,
  LIFECYCLE_LABEL_BA_DONE,
  LIFECYCLE_LABEL_PM_DONE,
  runStoryBaPhase,
  runStoryPmPhase,
} from '../modules/story-lifecycle';
import { listWorkItemActivity } from '../modules/work-item-activity';
import { getAdapter } from '../adapters';
import { getDatabase } from '../database';

const ALWAYS_ON_SHIFT = [{ dow: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59' }];

function cancelPendingJobs(workItemId: string): void {
  getDatabase()
    .prepare(
      `UPDATE loop_job SET status = 'cancelled'
       WHERE work_item_id = ? AND status IN ('pending', 'running')`
    )
    .run(workItemId);
}

describe('full-lifecycle', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agenthub-full-lifecycle-'));
    process.env.AGENTHUB_WORK_DIR = tmpRoot;
    jest.spyOn(getAdapter('mock'), 'isAvailable').mockResolvedValue(true);
  });

  afterEach(() => {
    delete process.env.AGENTHUB_WORK_DIR;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  function staffTeam(sprintId: string) {
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
    const dev = hireNewAgent({
      name: `Dev ${Date.now()}`,
      type: 'mock',
      role: 'developer',
      workingHours: ALWAYS_ON_SHIFT,
      timezone: 'UTC',
    });
    const tester = hireNewAgent({
      name: `Tester ${Date.now()}`,
      type: 'mock',
      role: 'tester',
      workingHours: ALWAYS_ON_SHIFT,
      timezone: 'UTC',
    });
    const reviewer = hireNewAgent({
      name: `Reviewer ${Date.now()}`,
      type: 'mock',
      role: 'reviewer',
      workingHours: ALWAYS_ON_SHIFT,
      timezone: 'UTC',
    });
    setSprintTeam(sprintId, [
      { agentId: ba.id, role: 'business_analyst' },
      { agentId: pm.id, role: 'project_manager' },
      { agentId: dev.id, role: 'developer' },
      { agentId: tester.id, role: 'tester' },
      { agentId: reviewer.id, role: 'reviewer' },
    ]);
    return { ba, pm, dev, tester, reviewer };
  }

  it('queues BA first for a new story and chains PM then pipeline', async () => {
    const sprint = createSprint(`Full LC ${Date.now()}`, { status: 'active' });
    staffTeam(sprint.id);
    const story = createWorkItem({
      type: 'story',
      title: 'Export board CSV',
      description: 'Users export the sprint board.',
      sprintId: sprint.id,
      status: 'todo',
    });

    const started = startFullLifecycle(story.id, { orchestrator: 'test' });
    expect(started.step).toBe('ba');
    expect(started.job.jobType).toBe('story_ba');
    expect(started.job.payload.chainFullLifecycle).toBe(true);
    expect(getActiveJobForWorkItem(story.id)?.id).toBe(started.job.id);

    const activity = listWorkItemActivity(story.id, 20);
    expect(activity.some((a) => a.metadata?.event === 'full_lifecycle_start')).toBe(true);

    // Simulate worker completing BA then chaining
    cancelPendingJobs(story.id);
    updateWorkItem(story.id, { status: 'todo' });
    await runStoryBaPhase(story.id, sprint.id);

    const afterBa = continueFullLifecycleChain({
      id: started.job.id,
      workItemId: story.id,
      jobType: 'story_ba',
      status: 'completed',
      payload: {
        sprintId: sprint.id,
        storyId: story.id,
        chainFullLifecycle: true,
        orchestrator: 'test',
      },
      createdAt: new Date().toISOString(),
    });

    expect(afterBa?.jobType).toBe('story_pm');
    expect(afterBa?.payload.chainFullLifecycle).toBe(true);

    cancelPendingJobs(story.id);
    updateWorkItem(story.id, { status: 'todo' });
    await runStoryPmPhase(story.id, sprint.id);

    const storyAfterPm = getWorkItem(story.id)!;
    expect(getStoryLifecyclePhase(storyAfterPm)).not.toBe('pm_pending');

    const targetBefore = resolveFullLifecyclePipelineTarget(getWorkItem(story.id)!);
    expect(targetBefore).toBeTruthy();

    const afterPm = continueFullLifecycleChain({
      id: 'pm-job',
      workItemId: story.id,
      jobType: 'story_pm',
      status: 'completed',
      payload: {
        sprintId: sprint.id,
        storyId: story.id,
        chainFullLifecycle: true,
        orchestrator: 'test',
      },
      createdAt: new Date().toISOString(),
    });

    expect(afterPm?.jobType).toBe('work_item_pipeline');
    expect(afterPm?.workItemId).toBe(targetBefore!.id);
  });

  it('starts at PM when BA is already done', () => {
    const sprint = createSprint(`Full LC PM ${Date.now()}`, { status: 'active' });
    staffTeam(sprint.id);
    const story = createWorkItem({
      type: 'story',
      title: 'BA already done',
      sprintId: sprint.id,
      status: 'todo',
      labels: [LIFECYCLE_LABEL_BA_DONE],
    });

    const started = startFullLifecycle(story.id);
    expect(started.step).toBe('pm');
    expect(started.job.jobType).toBe('story_pm');
  });

  it('starts pipeline when BA and PM are done', () => {
    const sprint = createSprint(`Full LC Dev ${Date.now()}`, { status: 'active' });
    staffTeam(sprint.id);
    const story = createWorkItem({
      type: 'story',
      title: 'Ready for dev',
      sprintId: sprint.id,
      status: 'todo',
      labels: [LIFECYCLE_LABEL_BA_DONE, LIFECYCLE_LABEL_PM_DONE, 'lifecycle:atomic'],
    });

    const started = startFullLifecycle(story.id);
    expect(started.step).toBe('pipeline');
    expect(started.job.jobType).toBe('work_item_pipeline');
    expect(started.workItemId).toBe(story.id);
  });

  it('skips BA/PM for tasks and queues developer pipeline', () => {
    const sprint = createSprint(`Full LC Task ${Date.now()}`, { status: 'active' });
    staffTeam(sprint.id);
    const task = createWorkItem({
      type: 'task',
      title: 'Implement API',
      sprintId: sprint.id,
      status: 'todo',
    });

    const started = startFullLifecycle(task.id);
    expect(started.step).toBe('pipeline');
    expect(started.job.jobType).toBe('work_item_pipeline');
  });

  it('rejects when BA is not staffed for ba_pending story', () => {
    const sprint = createSprint(`Full LC NoBA ${Date.now()}`, { status: 'active' });
    const story = createWorkItem({
      type: 'story',
      title: 'Unstaffed',
      sprintId: sprint.id,
      status: 'todo',
    });

    expect(() => startFullLifecycle(story.id)).toThrow(/business analyst/i);
  });

  it('runs full lifecycle synchronously with mock agents', async () => {
    const sprint = createSprint(`Full LC Sync ${Date.now()}`, { status: 'active' });
    staffTeam(sprint.id);
    const story = createWorkItem({
      type: 'story',
      title: 'Sync lifecycle',
      description: 'End-to-end sync path',
      sprintId: sprint.id,
      status: 'todo',
    });

    // Force atomic PM output so pipeline targets the story (mock already handles BA)
    const realExecute = getAdapter('mock').execute.bind(getAdapter('mock'));
    jest.spyOn(getAdapter('mock'), 'execute').mockImplementation(async (input) => {
      if (String(input.prompt).includes('AGENTHUB_PM_PHASE')) {
        return {
          content: '```json\n{"atomic":true,"tasks":[]}\n```',
          tokenCount: 10,
          metadata: { adapter: 'mock' },
        };
      }
      return realExecute(input);
    });

    const result = await runFullLifecycleSync(story.id, { maxIterations: 1, autoLoop: false });
    expect(result.ba).toBeTruthy();
    expect(result.pm).toBeTruthy();
    expect(result.pipeline).toBeTruthy();
    expect(result.pipelineWorkItemId).toBe(story.id);

    const finalStory = getWorkItem(story.id)!;
    expect(finalStory.labels).toContain(LIFECYCLE_LABEL_BA_DONE);
    expect(finalStory.labels).toContain(LIFECYCLE_LABEL_PM_DONE);
  }, 30_000);

  it('does not chain when chainFullLifecycle is absent', () => {
    const next = continueFullLifecycleChain({
      id: 'j1',
      workItemId: 'x',
      jobType: 'story_ba',
      status: 'completed',
      payload: { sprintId: 's1' },
      createdAt: new Date().toISOString(),
    });
    expect(next).toBeNull();
  });
});
