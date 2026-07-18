import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AdapterInput, AdapterOutput } from '../adapters/base';
import { getAdapter } from '../adapters';
import { createWorkItem, updateWorkItem } from '../modules/work-items';
import {
  createImprovementEpic,
  getEpicChildren,
  rollupEpicStatus,
  runEpicOrchestration,
  summarizeEpic,
  resolveEpicChildWorkDir,
  IMPROVEMENT_EPIC_CHILDREN,
} from '../modules/epic-orchestration';

describe('Epic orchestration', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agenthub-epic-'));
    process.env.AGENTHUB_WORK_DIR = tmpRoot;
    jest.spyOn(getAdapter('grok'), 'isAvailable').mockResolvedValue(false);
    jest.spyOn(getAdapter('copilot'), 'isAvailable').mockResolvedValue(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.AGENTHUB_WORK_DIR;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('should create improvement epic with child stories', () => {
    const bundle = createImprovementEpic();
    expect(bundle.epic.type).toBe('epic');
    expect(bundle.children).toHaveLength(IMPROVEMENT_EPIC_CHILDREN.length);
    expect(bundle.workflowId).toBeTruthy();
    expect(getEpicChildren(bundle.epic.id).every((c) => c.parentId === bundle.epic.id)).toBe(true);
    expect(bundle.children.every((c) => c.acceptanceCriteria.length > 0)).toBe(true);
  });

  it('should allocate isolated work directories per child', () => {
    const bundle = createImprovementEpic();
    const dirs = bundle.children.map((child) => resolveEpicChildWorkDir(bundle.epic, child));
    expect(new Set(dirs).size).toBe(bundle.children.length);
    for (const dir of dirs) expect(dir.startsWith(tmpRoot)).toBe(true);
  });

  it('should run pipeline on each child and roll up epic to done', async () => {
    const bundle = createImprovementEpic();
    const result = await runEpicOrchestration(bundle.epic.id, { maxIterations: 2 });

    expect(result.childResults).toHaveLength(bundle.children.length);
    expect(result.childResults.every((r) => r.pipeline?.loopStatus === 'approved')).toBe(true);
    expect(result.childResults.every((r) => !r.error)).toBe(true);
    expect(result.summary.totals.done).toBe(bundle.children.length);
    expect(result.epic.status).toBe('done');

    for (let i = 0; i < result.childResults.length; i++) {
      const outputFile = IMPROVEMENT_EPIC_CHILDREN[i].outputFile;
      expect(fs.existsSync(path.join(result.childResults[i].workDir, outputFile))).toBe(true);
    }
  });

  it('should skip completed children on rerun', async () => {
    const bundle = createImprovementEpic();
    await runEpicOrchestration(bundle.epic.id, { maxIterations: 2 });

    const second = await runEpicOrchestration(bundle.epic.id, { maxIterations: 2 });
    expect(second.childResults.every((r) => r.skipped)).toBe(true);
    expect(second.epic.status).toBe('done');
  });

  it('should summarize epic progress and roll up status', () => {
    const bundle = createImprovementEpic();
    updateWorkItem(bundle.children[0].id, { status: 'done' });

    const summary = summarizeEpic(bundle.epic.id);
    expect(summary.totals.done).toBe(1);
    expect(summary.totals.children).toBe(bundle.children.length);

    const rolled = rollupEpicStatus(bundle.epic.id);
    expect(rolled.status).toBe('in_progress');
  });

  it('should stop on failure when configured', async () => {
    jest.spyOn(getAdapter('mock'), 'execute').mockImplementation(async (input: AdapterInput): Promise<AdapterOutput> => {
      const capability = (input.config?.capability as string) || '';
      if (capability === 'review') {
        return {
          content: 'CHANGES_REQUESTED\nNeeds more work.',
          tokenCount: 20,
          metadata: { adapter: 'mock' },
        };
      }
      return { content: '## Implementation', tokenCount: 20, metadata: { adapter: 'mock' } };
    });

    const bundle = createImprovementEpic();
    const result = await runEpicOrchestration(bundle.epic.id, {
      maxIterations: 1,
      stopOnFailure: true,
    });

    expect(result.childResults.length).toBe(1);
    expect(result.childResults[0].pipeline?.loopStatus).toBe('escalated');
    expect(result.epic.status).not.toBe('done');
  });
});