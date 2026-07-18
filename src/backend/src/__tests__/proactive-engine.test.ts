import fs from 'fs';
import os from 'os';
import path from 'path';
import { createWorkItem, updateWorkItem } from '../modules/work-items';
import { ensureGrokCopilotWorkflow } from '../modules/work-item-pipeline';
import { getLoopJob, hasActiveLoopJobForWorkItem } from '../modules/job-queue';
import {
  proactiveEngine,
  registerWorkItemPipelineTrigger,
  recordEvent,
} from '../modules/proactive-engine';
import { resolveWorkItemOutputDir } from '../modules/work-item-context';
import { listWorkItemActivity } from '../modules/work-item-activity';

describe('Proactive Engine — work-item pipeline triggers (AH-41)', () => {
  let tmpDir: string;

  beforeEach(() => {
    proactiveEngine.shutdown();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proactive-'));
    process.env.AGENTHUB_WORK_DIR = tmpDir;
  });

  afterEach(() => {
    proactiveEngine.shutdown();
    delete process.env.AGENTHUB_WORK_DIR;
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should register a work-item pipeline trigger watching the output dir', () => {
    const item = createWorkItem({
      type: 'task',
      title: 'Proactive loop test',
      status: 'todo',
      assignedAgentType: 'mock',
    });

    const trigger = registerWorkItemPipelineTrigger(item.id, { debounceMs: 100 });
    const outputDir = resolveWorkItemOutputDir(item);

    expect(trigger.config.workItemId).toBe(item.id);
    expect(trigger.config.action).toBe('enqueue_pipeline');
    expect(outputDir).toBeDefined();
    expect(fs.existsSync(outputDir!)).toBe(true);
  });

  it('should enqueue pipeline when trigger fires with enqueue_pipeline action', async () => {
    const item = createWorkItem({
      type: 'task',
      title: 'Auto-loop on save',
      status: 'todo',
      assignedAgentType: 'mock',
    });
    const workflowId = ensureGrokCopilotWorkflow();

    const trigger = registerWorkItemPipelineTrigger(item.id, {
      maxIterations: 1,
      autoLoop: false,
    });

    await proactiveEngine.fireTrigger(
      'file_changed',
      { filePath: path.join(resolveWorkItemOutputDir(item)!, 'draft.md'), action: 'added' },
      trigger.workflowId,
      trigger
    );

    const activity = listWorkItemActivity(item.id);
    const enqueued = activity.find((a) => a.metadata?.event === 'proactive_pipeline_enqueued');
    expect(enqueued).toBeDefined();
    expect(enqueued?.metadata?.jobId).toBeDefined();
    expect(hasActiveLoopJobForWorkItem(item.id)).toBe(true);

    const job = getLoopJob(enqueued!.metadata!.jobId as string);
    expect(job?.workItemId).toBe(item.id);
    expect(job?.workflowId).toBe(workflowId);
    expect(job?.status).toBe('pending');
  });

  it('should skip enqueue when loop is already running', async () => {
    const item = createWorkItem({
      type: 'task',
      title: 'Skip duplicate',
      status: 'in_progress',
      assignedAgentType: 'mock',
    });
    updateWorkItem(item.id, { loopStatus: 'running' });

    const trigger = registerWorkItemPipelineTrigger(item.id);
    await proactiveEngine.fireTrigger(
      'file_changed',
      { filePath: '/tmp/test.md' },
      trigger.workflowId,
      trigger
    );

    expect(hasActiveLoopJobForWorkItem(item.id)).toBe(false);

    const skipped = proactiveEngine
      .listEvents(10)
      .find((e) => e.eventType === 'proactive_pipeline_skipped');
    expect(skipped?.payload.reason).toBe('already_running');
  });

  it('should coalesce rapid file changes via debounce', async () => {
    const item = createWorkItem({
      type: 'task',
      title: 'Debounce test',
      status: 'todo',
      assignedAgentType: 'mock',
    });

    registerWorkItemPipelineTrigger(item.id, { debounceMs: 300 });
    const outputDir = resolveWorkItemOutputDir(item)!;

    // Allow chokidar to attach before writing files
    await new Promise((r) => setTimeout(r, 300));

    fs.writeFileSync(path.join(outputDir, 'a.md'), 'a');
    await new Promise((r) => setTimeout(r, 100));
    fs.writeFileSync(path.join(outputDir, 'b.md'), 'b');
    await new Promise((r) => setTimeout(r, 100));
    fs.writeFileSync(path.join(outputDir, 'c.md'), 'c');
    await new Promise((r) => setTimeout(r, 800));

    const activity = listWorkItemActivity(item.id).filter(
      (a) => a.metadata?.event === 'proactive_pipeline_enqueued'
    );
    expect(activity.length).toBe(1);
  }, 15000);

  it('should record events for audit trail', () => {
    const event = recordEvent('file_changed', { filePath: '/tmp/x.md', test: true });
    expect(event.eventType).toBe('file_changed');
    expect(event.payload.filePath).toBe('/tmp/x.md');

    const listed = proactiveEngine.listEvents(5);
    expect(listed.some((e) => e.id === event.id)).toBe(true);
  });
});