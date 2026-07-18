import type { AdapterInput, AdapterOutput } from '../adapters/base';
import { getAdapter } from '../adapters';
import { createWorkItem, getWorkItem, updateWorkItem } from '../modules/work-items';
import { ensureGrokCopilotWorkflow } from '../modules/work-item-pipeline';
import { getDatabase } from '../database';
import {
  enqueueWorkItemPipeline,
  enqueueWorkItemAgent,
  getLoopJob,
  claimNextPendingJob,
  completeLoopJob,
  recoverStaleLoopJobs,
  recoverOrphanedWorkItemLoops,
  recoverOrphanedInProgressWorkItems,
} from '../modules/job-queue';
import { runWorkItemAgent } from '../modules/work-items';
import { getLoopRun } from '../modules/loop-run';
import { runWorkItemPipeline } from '../modules/work-item-pipeline';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('Job Queue (M4)', () => {
  beforeEach(() => {
    jest.spyOn(getAdapter('grok'), 'isAvailable').mockResolvedValue(false);
    jest.spyOn(getAdapter('copilot'), 'isAvailable').mockResolvedValue(false);
    jest.spyOn(getAdapter('mock'), 'execute').mockImplementation(async (input: AdapterInput): Promise<AdapterOutput> => {
      const capability = (input.config?.capability as string) || '';
      if (capability === 'review') {
        return { content: 'APPROVED\nLooks good.', tokenCount: 20, metadata: { adapter: 'mock' } };
      }
      return { content: '## Implementation', tokenCount: 15, metadata: { adapter: 'mock' } };
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.AGENTHUB_WORK_DIR;
  });

  it('should enqueue and process a pipeline job', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'job-q-'));
    process.env.AGENTHUB_WORK_DIR = tmp;
    fs.writeFileSync(path.join(tmp, 'improvements.md'), '# Improvements\n- a\n- b\n- c\n');

    const item = createWorkItem({
      type: 'task',
      title: 'Queue test',
      assignedAgentType: 'mock',
      status: 'todo',
      acceptanceCriteria: ['improvements.md created in work directory', 'At least 3 actionable recommendations'],
    });

    const workflowId = ensureGrokCopilotWorkflow();
    const job = enqueueWorkItemPipeline(item.id, workflowId, { maxIterations: 1, autoLoop: false });

    expect(job.status).toBe('pending');
    expect(getLoopJob(job.id)?.id).toBe(job.id);

    const claimed = claimNextPendingJob();
    expect(claimed?.id).toBe(job.id);

    const result = await runWorkItemPipeline(item.id, { maxIterations: 1, autoLoop: false, jobId: job.id });
    completeLoopJob(job.id, result as unknown as Record<string, unknown>, result.loopRunId);

    const completed = getLoopJob(job.id);
    expect(completed?.status).toBe('completed');
    expect(completed?.loopRunId).toBeDefined();

    const run = getLoopRun(result.loopRunId!);
    expect(run?.status).toBe('completed');

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('should enqueue and complete a single-agent job', async () => {
    const item = createWorkItem({
      type: 'task',
      title: 'Agent queue test',
      assignedAgentType: 'mock',
      status: 'todo',
    });

    const job = enqueueWorkItemAgent(item.id);
    expect(job.status).toBe('pending');
    expect(job.jobType).toBe('work_item_agent');

    const claimed = claimNextPendingJob();
    expect(claimed?.id).toBe(job.id);

    const result = await runWorkItemAgent(item.id);
    completeLoopJob(job.id, result as unknown as Record<string, unknown>);

    expect(getLoopJob(job.id)?.status).toBe('completed');
  });

  it('should recover stale running jobs on restart', () => {
    const item = createWorkItem({ type: 'task', title: 'Stale job', assignedAgentType: 'mock' });
    const workflowId = ensureGrokCopilotWorkflow();
    const job = enqueueWorkItemPipeline(item.id, workflowId);
    const claimed = claimNextPendingJob();
    expect(claimed?.status).toBe('running');

    getDatabase().prepare('UPDATE loop_job SET worker_pid = ? WHERE id = ?').run(999_999, job.id);

    const recovered = recoverStaleLoopJobs();
    expect(recovered).toBeGreaterThanOrEqual(1);
    expect(getLoopJob(job.id)?.status).toBe('failed');
  });

  it('should recover work items stuck in running loop with no active job', () => {
    const item = createWorkItem({ type: 'task', title: 'Orphan loop', assignedAgentType: 'mock' });
    updateWorkItem(item.id, { status: 'in_progress', loopStatus: 'running' });

    const recovered = recoverOrphanedWorkItemLoops();
    expect(recovered).toBeGreaterThanOrEqual(1);

    const updated = getWorkItem(item.id)!;
    expect(updated.loopStatus).toBe('failed');
    expect(updated.status).toBe('todo');
  });

  it('should recover work items stuck in in_progress with no active job', () => {
    const item = createWorkItem({ type: 'task', title: 'Orphan in progress', assignedAgentType: 'mock' });
    updateWorkItem(item.id, { status: 'in_progress', loopStatus: 'idle' });

    const recovered = recoverOrphanedInProgressWorkItems();
    expect(recovered).toBeGreaterThanOrEqual(1);

    const updated = getWorkItem(item.id)!;
    expect(updated.status).toBe('todo');
    expect(updated.loopStatus).toBe('idle');
  });
});