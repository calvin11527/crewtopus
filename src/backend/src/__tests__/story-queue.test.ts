import fs from 'fs';
import os from 'os';
import path from 'path';
import { getAdapter } from '../adapters';
import { createSprint, createWorkItem } from '../modules/work-items';
import { resolveWorkItemOutputDir } from '../modules/work-item-context';
import { resolveStoryQueueItems, runStoryQueue } from '../modules/story-queue';
import { updateWorkItem } from '../modules/work-items';

describe('Story queue (serial pipeline)', () => {
  let tmpRoot: string;

  beforeEach(() => {
    jest.restoreAllMocks();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agenthub-queue-'));
    process.env.AGENTHUB_WORK_DIR = tmpRoot;
    jest.spyOn(getAdapter('grok'), 'isAvailable').mockResolvedValue(false);
    jest.spyOn(getAdapter('copilot'), 'isAvailable').mockResolvedValue(false);
    jest.spyOn(getAdapter('mock'), 'execute').mockImplementation(async (input) => {
      const capability = (input.config?.capability as string) || '';
      if (capability === 'review') {
        return {
          content: 'APPROVED\nImplementation meets acceptance criteria.',
          tokenCount: 30,
          metadata: { adapter: 'mock', capability },
        };
      }
      if (capability === 'testing') {
        return { content: 'PASS\nAll checks passed.', tokenCount: 10, metadata: { adapter: 'mock', capability } };
      }
      return {
        content: '## Implementation\nDone.',
        tokenCount: 20,
        metadata: { adapter: 'mock', capability },
      };
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.AGENTHUB_WORK_DIR;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('should resolve sprint stories in key order', () => {
    const sprint = createSprint('Queue sprint');
    createWorkItem({ type: 'story', title: 'B story', sprintId: sprint.id, status: 'todo' });
    createWorkItem({ type: 'task', title: 'A task', sprintId: sprint.id, status: 'todo' });

    const items = resolveStoryQueueItems({ sprintId: sprint.id });
    const keys = items.map((i) => i.key);
    expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)));
    expect(keys).toHaveLength(2);
  });

  it('should run stories serially and finish each before starting next', async () => {
    const sprint = createSprint('Serial sprint');

    createWorkItem({
      type: 'story',
      title: 'Document prioritized improvements in improvements.md',
      sprintId: sprint.id,
      status: 'todo',
      acceptanceCriteria: ['improvements.md created in work directory', 'At least 3 actionable recommendations'],
    });
    createWorkItem({
      type: 'task',
      title: 'Publish automation readiness checklist',
      sprintId: sprint.id,
      status: 'todo',
      acceptanceCriteria: ['automation-checklist.md created in work directory', 'Grok→Copilot pipeline configured'],
    });

    const items = resolveStoryQueueItems({ sprintId: sprint.id });
    for (const item of items) {
      const dir = resolveWorkItemOutputDir(item);
      if (!dir) continue;
      fs.mkdirSync(dir, { recursive: true });
      if (item.title.toLowerCase().includes('improvements')) {
        fs.writeFileSync(
          `${dir}/improvements.md`,
          '# Improvements\n- One\n- Two\n- Three\n'
        );
      }
      if (item.title.toLowerCase().includes('checklist')) {
        fs.writeFileSync(
          `${dir}/automation-checklist.md`,
          '# Checklist\n- [x] Grok→Copilot pipeline configured\n'
        );
      }
    }

    const result = await runStoryQueue(items, { demo: true, maxIterations: 2 });

    expect(result.results).toHaveLength(2);
    expect(result.totals.approved).toBe(2);
    expect(result.results[0].pipeline?.loopStatus).toBe('approved');
    expect(result.results[1].pipeline?.loopStatus).toBe('approved');
    expect(result.results[0].durationMs).toBeGreaterThan(0);
    expect(result.results[1].durationMs).toBeGreaterThan(0);
    expect(result.durationMs).toBeLessThan(15_000);
  });

  it('should skip items that already have a running loop', async () => {
    const sprint = createSprint('Busy sprint');
    const busy = createWorkItem({
      type: 'story',
      title: 'Busy story',
      sprintId: sprint.id,
      status: 'in_progress',
    });
    updateWorkItem(busy.id, { loopStatus: 'running' });
    createWorkItem({
      type: 'task',
      title: 'Free task',
      sprintId: sprint.id,
      status: 'todo',
      acceptanceCriteria: ['automation-checklist.md created in work directory'],
    });

    const items = resolveStoryQueueItems({ sprintId: sprint.id });
    const result = await runStoryQueue(items, { demo: true, maxIterations: 1 });

    const busyResult = result.results.find((r) => r.item.id === busy.id);
    expect(busyResult?.skipped).toBe(true);
    expect(busyResult?.skipReason).toContain('pipeline');
  });
});