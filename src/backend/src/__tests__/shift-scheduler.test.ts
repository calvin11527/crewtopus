import fs from 'fs';
import os from 'os';
import path from 'path';
import { createWorkItem, updateWorkItem } from '../modules/work-items';
import { createSprint } from '../modules/work-items';
import { hireNewAgent } from '../modules/agent-employment';
import { setSprintTeam, setSprintAutomationMode } from '../modules/sprint-team';
import { getDatabase } from '../database';
import { runShiftTick } from '../modules/shift-scheduler';
import { runStoryBaPhase, runStoryPmPhase } from '../modules/story-lifecycle';

const ALWAYS_ON_SHIFT = [{ dow: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59' }];

function cancelPendingJobs(workItemId: string): void {
  getDatabase()
    .prepare(
      `UPDATE loop_job SET status = 'cancelled'
       WHERE work_item_id = ? AND status IN ('pending', 'running')`
    )
    .run(workItemId);
}

describe('shift-scheduler', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agenthub-shift-'));
    process.env.AGENTHUB_WORK_DIR = tmpRoot;
  });

  afterEach(() => {
    delete process.env.AGENTHUB_WORK_DIR;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });
  it('auto-retries failed stories when developer is on shift', async () => {
    const sprint = createSprint(`Shift test ${Date.now()}`, { status: 'active' });
    const dev = hireNewAgent({
      name: `Dev ${Date.now()}`,
      type: 'mock',
      role: 'developer',
      workingHours: ALWAYS_ON_SHIFT,
      timezone: 'UTC',
    });
    const sm = hireNewAgent({
      name: `SM ${Date.now()}`,
      type: 'mock',
      role: 'scrum_master',
      workingHours: ALWAYS_ON_SHIFT,
      timezone: 'UTC',
    });

    setSprintTeam(sprint.id, [
      { agentId: dev.id, role: 'developer' },
      { agentId: sm.id, role: 'scrum_master' },
    ]);
    setSprintAutomationMode(sprint.id, 'autonomous');

    const item = createWorkItem({
      type: 'story',
      title: 'Failed story',
      sprintId: sprint.id,
      status: 'todo',
    });
    updateWorkItem(item.id, { loopStatus: 'failed' });

    await runShiftTick(new Date('2026-06-27T12:00:00Z'));

    const job = getDatabase()
      .prepare(
        `SELECT job_type, payload FROM loop_job WHERE work_item_id = ? ORDER BY created_at DESC LIMIT 1`
      )
      .get(item.id) as { job_type: string; payload: string };
    expect(job.job_type).toBe('work_item_pipeline');
    expect(JSON.parse(job.payload).retryMode).toBe('full');
  });

  it('auto re-reviews escalated stories when reviewer is on shift', async () => {
    const sprint = createSprint(`Escalated shift ${Date.now()}`, { status: 'active' });
    const reviewer = hireNewAgent({
      name: `Reviewer ${Date.now()}`,
      type: 'mock',
      role: 'reviewer',
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

    setSprintTeam(sprint.id, [
      { agentId: reviewer.id, role: 'reviewer' },
      { agentId: dev.id, role: 'developer' },
    ]);
    setSprintAutomationMode(sprint.id, 'autonomous');

    const item = createWorkItem({
      type: 'task',
      title: 'Escalated task',
      sprintId: sprint.id,
      status: 'in_review',
    });
    updateWorkItem(item.id, { loopStatus: 'escalated', loopIteration: 3 });

    await runShiftTick(new Date('2026-06-27T12:00:00Z'));

    const job = getDatabase()
      .prepare(
        `SELECT job_type, payload FROM loop_job WHERE work_item_id = ? ORDER BY created_at DESC LIMIT 1`
      )
      .get(item.id) as { job_type: string; payload: string };
    expect(job.job_type).toBe('work_item_pipeline');
    expect(JSON.parse(job.payload).retryMode).toBe('review_only');
  });

  it('pauses autonomous mode when escalated stories lack an on-shift reviewer', async () => {
    const sprint = createSprint(`Blocked shift ${Date.now()}`, { status: 'active' });
    const dev = hireNewAgent({
      name: `Dev ${Date.now()}`,
      type: 'mock',
      role: 'developer',
      workingHours: ALWAYS_ON_SHIFT,
      timezone: 'UTC',
    });

    setSprintTeam(sprint.id, [{ agentId: dev.id, role: 'developer' }]);
    setSprintAutomationMode(sprint.id, 'autonomous');

    const item = createWorkItem({
      type: 'story',
      title: 'Escalated without reviewer',
      sprintId: sprint.id,
      status: 'in_review',
    });
    updateWorkItem(item.id, { loopStatus: 'escalated' });

    await runShiftTick(new Date('2026-06-27T12:00:00Z'));

    const jobs = (
      getDatabase()
        .prepare(`SELECT COUNT(*) AS c FROM loop_job WHERE work_item_id = ?`)
        .get(item.id) as { c: number }
    ).c;
    expect(jobs).toBe(0);

    const automation = getDatabase()
      .prepare('SELECT paused_reason FROM sprint_automation WHERE sprint_id = ?')
      .get(sprint.id) as { paused_reason: string | null };
    expect(automation.paused_reason).toBe('blocked_failures');
  });

  it('queues BA before PM and developer pipeline for new stories', async () => {
    const sprint = createSprint(`Lifecycle shift ${Date.now()}`, { status: 'active' });
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
    const sm = hireNewAgent({
      name: 'SM',
      type: 'mock',
      role: 'scrum_master',
      workingHours: ALWAYS_ON_SHIFT,
      timezone: 'UTC',
    });

    setSprintTeam(sprint.id, [
      { agentId: ba.id, role: 'business_analyst' },
      { agentId: pm.id, role: 'project_manager' },
      { agentId: dev.id, role: 'developer' },
      { agentId: sm.id, role: 'scrum_master' },
    ]);
    setSprintAutomationMode(sprint.id, 'autonomous');

    const story = createWorkItem({
      type: 'story',
      title: 'Lifecycle story',
      sprintId: sprint.id,
      status: 'todo',
    });

    await runShiftTick(new Date('2026-06-27T12:00:00Z'));

    const baJob = getDatabase()
      .prepare(`SELECT job_type FROM loop_job WHERE work_item_id = ? ORDER BY created_at DESC LIMIT 1`)
      .get(story.id) as { job_type: string };
    expect(baJob.job_type).toBe('story_ba');

    cancelPendingJobs(story.id);
    updateWorkItem(story.id, { status: 'todo' });
    await runStoryBaPhase(story.id, sprint.id);
    await runShiftTick(new Date('2026-06-27T12:01:00Z'));

    const pmJob = getDatabase()
      .prepare(`SELECT job_type FROM loop_job WHERE work_item_id = ? ORDER BY created_at DESC LIMIT 1`)
      .get(story.id) as { job_type: string };
    expect(pmJob.job_type).toBe('story_pm');

    cancelPendingJobs(story.id);
    updateWorkItem(story.id, { status: 'todo' });
    await runStoryPmPhase(story.id, sprint.id);
    await runShiftTick(new Date('2026-06-27T12:02:00Z'));

    const child = getDatabase()
      .prepare(`SELECT id FROM work_item WHERE parent_id = ? AND type = 'task' LIMIT 1`)
      .get(story.id) as { id: string };

    const devJob = getDatabase()
      .prepare(`SELECT job_type FROM loop_job WHERE work_item_id = ? ORDER BY created_at DESC LIMIT 1`)
      .get(child.id) as { job_type: string };
    expect(devJob.job_type).toBe('work_item_pipeline');
  });
});