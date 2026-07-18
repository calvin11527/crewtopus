import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AdapterInput, AdapterOutput } from '../adapters/base';
import { getAdapter } from '../adapters';
import { listAuditEntries } from '../modules/audit-logger';
import { createWorkItem, getWorkItem } from '../modules/work-items';
import { resolveWorkItemOutputDir } from '../modules/work-item-context';
import {
  runWorkItemPipeline,
  ensureGrokCopilotWorkflow,
  getWorkItemLoopHistory,
  parseReviewVerdict,
} from '../modules/work-item-pipeline';
import { listWorkItemActivity } from '../modules/work-item-activity';
import { listWorkflows, executeWorkflow, getExecution } from '../modules/workflow-engine';

function seedEvalWorkDir(dir: string): void {
  fs.writeFileSync(
    path.join(dir, 'improvements.md'),
    '# Improvements\n- Recommendation one\n- Recommendation two\n- Recommendation three\n'
  );
}

describe('Work Item Pipeline (Grok → Copilot)', () => {
  let reviewCallCount = 0;

  beforeEach(() => {
    reviewCallCount = 0;
    jest.spyOn(getAdapter('grok'), 'isAvailable').mockResolvedValue(false);
    jest.spyOn(getAdapter('copilot'), 'isAvailable').mockResolvedValue(false);

    jest.spyOn(getAdapter('mock'), 'execute').mockImplementation(async (input: AdapterInput): Promise<AdapterOutput> => {
      const capability = (input.config?.capability as string) || '';
      if (capability === 'review') {
        reviewCallCount++;
        const content =
          reviewCallCount < 2
            ? 'CHANGES_REQUESTED\nAdd error handling and tests.'
            : 'APPROVED\nImplementation meets acceptance criteria.';
        return { content, tokenCount: 50, metadata: { adapter: 'mock', capability } };
      }
      if (capability === 'testing') {
        return {
          content: 'PASS\nAutomated checks completed.',
          tokenCount: 25,
          metadata: { adapter: 'mock', capability },
        };
      }
      return {
        content: `## Implementation (iter)\n${input.prompt.slice(0, 80)}`,
        tokenCount: 40,
        metadata: { adapter: 'mock', capability },
      };
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should seed grok-copilot workflow template with loop primitive', () => {
    const id = ensureGrokCopilotWorkflow();
    const workflows = listWorkflows();
    const wf = workflows.find((w) => w.id === id);
    expect(wf?.definition.loops?.length).toBe(1);
    expect(wf?.definition.loops?.[0].steps.length).toBe(3);
    expect(wf?.definition.loops?.[0].steps[0].agent).toBe('grok');
    expect(wf?.definition.loops?.[0].steps[1].capability).toBe('testing');
    expect(wf?.definition.loops?.[0].steps[2].agent).toBe('copilot');
    expect(wf?.definition.loops?.[0].until).toBe('eval_pass');
    expect(wf?.definition.loops?.[0].evals?.length).toBeGreaterThanOrEqual(2);
  });

  it('should parse review verdicts', () => {
    expect(parseReviewVerdict('APPROVED\nLooks good')).toBe('approved');
    expect(parseReviewVerdict('CHANGES_REQUESTED\nFix tests')).toBe('changes_requested');
    expect(parseReviewVerdict('## Review\n- ok')).toBe('changes_requested');
    expect(parseReviewVerdict('## Review\n- ok', { onUnknownVerdict: 'escalate' })).toBe('unknown');
    expect(
      parseReviewVerdict('## Review\n```json\n{"verdict":"APPROVED"}\n```', { parser: 'json_block' })
    ).toBe('approved');
  });

  it('should run grok then copilot automatically on a work item', async () => {
    reviewCallCount = 99;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-1-'));
    process.env.AGENTHUB_WORK_DIR = tmp;

    const item = createWorkItem({
      type: 'task',
      title: 'Pipeline test',
      description: 'Test multi-agent pipeline',
      assignedAgentType: 'mock',
      status: 'todo',
      acceptanceCriteria: ['improvements.md created in work directory', 'At least 3 actionable recommendations'],
    });
    seedEvalWorkDir(resolveWorkItemOutputDir(item)!);

    const result = await runWorkItemPipeline(item.id, { autoLoop: false });

    expect(result.steps).toHaveLength(3);
    expect(result.steps[0].phase).toBe('implementation');
    expect(result.steps[1].phase).toBe('testing');
    expect(result.steps[2].phase).toBe('review');
    expect(result.steps[0].loopIteration).toBe(1);
    expect(result.iterations).toBe(1);

    const activity = listWorkItemActivity(item.id);
    expect(activity.filter((a) => a.activityType === 'agent_started').length).toBeGreaterThanOrEqual(3);
    expect(activity.some((a) => a.summary.includes('auto-triggered'))).toBe(true);
    delete process.env.AGENTHUB_WORK_DIR;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('should loop on CHANGES_REQUESTED then finish on APPROVED', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-2-'));
    process.env.AGENTHUB_WORK_DIR = tmp;

    const item = createWorkItem({
      type: 'task',
      title: 'Loop test',
      description: 'Test closed loop',
      assignedAgentType: 'mock',
      status: 'todo',
      acceptanceCriteria: ['improvements.md created in work directory', 'At least 3 actionable recommendations'],
    });
    seedEvalWorkDir(resolveWorkItemOutputDir(item)!);

    const result = await runWorkItemPipeline(item.id, { maxIterations: 3 });

    expect(result.iterations).toBe(2);
    expect(result.steps).toHaveLength(6);
    expect(result.reviewVerdict).toBe('approved');
    expect(result.loopStatus).toBe('approved');
    expect(result.item.status).toBe('done');

    const updated = getWorkItem(item.id);
    expect(updated?.loopIteration).toBe(2);
    expect(updated?.loopStatus).toBe('approved');

    const history = getWorkItemLoopHistory(item.id);
    expect(history.iterations).toHaveLength(2);
    expect(history.iterations[0].verdict).toBe('changes_requested');
    expect(history.iterations[1].verdict).toBe('approved');
    delete process.env.AGENTHUB_WORK_DIR;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('should escalate when max iterations exhausted', async () => {
    jest.spyOn(getAdapter('mock'), 'execute').mockImplementation(async (input: AdapterInput): Promise<AdapterOutput> => {
      const capability = (input.config?.capability as string) || '';
      if (capability === 'review') {
        return {
          content: 'CHANGES_REQUESTED\nStill needs work.',
          tokenCount: 30,
          metadata: { adapter: 'mock' },
        };
      }
      if (capability === 'testing') {
        return { content: 'PASS', tokenCount: 10, metadata: { adapter: 'mock' } };
      }
      return { content: '## Implementation', tokenCount: 20, metadata: { adapter: 'mock' } };
    });

    const item = createWorkItem({
      type: 'task',
      title: 'Escalation test',
      assignedAgentType: 'mock',
      status: 'todo',
    });

    const result = await runWorkItemPipeline(item.id, { maxIterations: 2 });

    expect(result.iterations).toBe(2);
    expect(result.steps).toHaveLength(6);
    expect(result.loopStatus).toBe('escalated');
    expect(result.item.status).toBe('in_review');

    const updated = getWorkItem(item.id);
    expect(updated?.loopStatus).toBe('escalated');
  });

  it('should include work directory files in outbound audit context', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenthub-pipe-'));
    process.env.AGENTHUB_WORK_DIR = tmpDir;

    reviewCallCount = 99;
    const item = createWorkItem({
      type: 'task',
      title: 'Audit files test',
      assignedAgentType: 'mock',
      status: 'todo',
    });
    fs.writeFileSync(path.join(tmpDir, 'output.md'), '# output');
    seedEvalWorkDir(resolveWorkItemOutputDir(item)!);

    await runWorkItemPipeline(item.id, { autoLoop: false });

    const audits = listAuditEntries({ limit: 20 });
    const withFiles = audits.find((a) => a.files.includes('output.md'));
    expect(withFiles).toBeDefined();

    delete process.env.AGENTHUB_WORK_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should produce same iteration count via workflow engine loop', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-parity-'));
    process.env.AGENTHUB_WORK_DIR = tmp;

    const item = createWorkItem({
      type: 'task',
      title: 'Parity test',
      assignedAgentType: 'mock',
      status: 'todo',
      acceptanceCriteria: ['improvements.md created in work directory', 'At least 3 actionable recommendations'],
    });
    seedEvalWorkDir(resolveWorkItemOutputDir(item)!);

    const pipelineResult = await runWorkItemPipeline(item.id, { maxIterations: 3 });
    const workflowId = ensureGrokCopilotWorkflow();

    reviewCallCount = 0;
    const wfExecution = await executeWorkflow(workflowId, {
      workItemId: item.id,
      maxLoopIterations: 3,
      autoLoop: true,
    });

    const start = Date.now();
    while (Date.now() - start < 10_000) {
      const ex = getExecution(wfExecution.id);
      if (ex?.status === 'completed' || ex?.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 50));
    }

    const completed = getExecution(wfExecution.id);
    expect(completed?.loopResults?.[0].iterations).toBe(pipelineResult.iterations);
    expect(completed?.loopResults?.[0].stepCount).toBe(pipelineResult.steps.length);
    delete process.env.AGENTHUB_WORK_DIR;
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});