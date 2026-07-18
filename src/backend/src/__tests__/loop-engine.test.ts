import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AdapterInput, AdapterOutput } from '../adapters/base';
import { getAdapter } from '../adapters';
import { createWorkItem, getWorkItem } from '../modules/work-items';
import { resolveWorkItemOutputDir } from '../modules/work-item-context';
import { runAgentLoop } from '../modules/loop-engine';
import { requestLoopCancel, clearLoopCancel } from '../modules/loop-cancel';
import { createWorkflow } from '../modules/workflow-engine';
import type { WorkflowDefinition } from '../types';

function seedEvalWorkDir(dir: string): void {
  fs.writeFileSync(
    path.join(dir, 'improvements.md'),
    '# Improvements\n- Recommendation one\n- Recommendation two\n- Recommendation three\n'
  );
}

describe('Loop Engine (AH-39)', () => {
  let reviewCallCount = 0;

  beforeEach(() => {
    reviewCallCount = 0;
    jest.spyOn(getAdapter('mock'), 'execute').mockImplementation(async (input: AdapterInput): Promise<AdapterOutput> => {
      const capability = (input.config?.capability as string) || '';
      if (capability === 'review') {
        reviewCallCount++;
        const content =
          reviewCallCount < 2
            ? 'CHANGES_REQUESTED\nAdd error handling.'
            : 'APPROVED\nLooks good.';
        return { content, tokenCount: 50, metadata: { adapter: 'mock', capability } };
      }
      return {
        content: `## Implementation\n${input.prompt.slice(0, 60)}`,
        tokenCount: 40,
        metadata: { adapter: 'mock', capability },
      };
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should run N-step loop (plan → implement → review) per iteration', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-nstep-'));
    process.env.AGENTHUB_WORK_DIR = tmp;

    const item = createWorkItem({
      type: 'task',
      title: 'N-step loop',
      assignedAgentType: 'mock',
      status: 'todo',
      acceptanceCriteria: ['improvements.md created in work directory', 'At least 3 actionable recommendations'],
    });
    seedEvalWorkDir(resolveWorkItemOutputDir(item)!);

    const definition: WorkflowDefinition = {
      name: 'Plan implement review',
      steps: [],
      loops: [
        {
          id: 'three-step',
          until: 'eval_pass',
          maxIterations: 2,
          onExhausted: 'escalate',
          steps: [
            { name: 'plan', agent: 'mock', capability: 'planning', config: { prompt: 'Plan the work.' } },
            { name: 'implement', agent: 'mock', capability: 'implementation', config: { prompt: 'Implement.' } },
            { name: 'review', agent: 'mock', capability: 'review', config: { prompt: 'Review output.' } },
          ],
          evals: [
            { id: 'verdict', type: 'verdict_parse', config: { required: 'approved' } },
            { id: 'acceptance', type: 'acceptance_criteria' },
          ],
        },
      ],
    };

    const workflow = createWorkflow('N-step test', definition);
    const result = await runAgentLoop({
      loop: definition.loops![0],
      workflowId: workflow.id,
      workItemId: item.id,
      options: { maxIterations: 2 },
    });

    expect(result.iterations).toBe(2);
    expect(result.steps).toHaveLength(6);
    expect(result.steps.filter((s) => s.stepName === 'plan')).toHaveLength(2);
    expect(result.loopStatus).toBe('approved');

    delete process.env.AGENTHUB_WORK_DIR;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('should treat markdown-wrapped unknown verdict as changes_requested by default', async () => {
    jest.spyOn(getAdapter('mock'), 'execute').mockImplementation(async (input: AdapterInput): Promise<AdapterOutput> => {
      const capability = (input.config?.capability as string) || '';
      if (capability === 'review') {
        return {
          content: '## Review\n- needs more tests',
          tokenCount: 30,
          metadata: { adapter: 'mock' },
        };
      }
      return { content: '## Implementation', tokenCount: 20, metadata: { adapter: 'mock' } };
    });

    const item = createWorkItem({ type: 'task', title: 'Unknown verdict', assignedAgentType: 'mock', status: 'todo' });

    const definition: WorkflowDefinition = {
      name: 'Verdict test',
      steps: [],
      loops: [
        {
          id: 'v',
          until: 'verdict_approved',
          maxIterations: 1,
          onExhausted: 'escalate',
          steps: [
            { name: 'implement', agent: 'mock', capability: 'implementation' },
            { name: 'review', agent: 'mock', capability: 'review' },
          ],
        },
      ],
    };

    const workflow = createWorkflow('Verdict loop', definition);
    const result = await runAgentLoop({
      loop: definition.loops![0],
      workflowId: workflow.id,
      workItemId: item.id,
      options: { maxIterations: 1, autoLoop: true },
    });

    expect(result.reviewVerdict).toBe('changes_requested');
    expect(result.loopStatus).toBe('escalated');
  });

  it('should escalate when token budget is exceeded', async () => {
    jest.spyOn(getAdapter('mock'), 'execute').mockImplementation(async (): Promise<AdapterOutput> => ({
      content: 'x'.repeat(100),
      tokenCount: 500,
      metadata: { adapter: 'mock' },
    }));

    const item = createWorkItem({ type: 'task', title: 'Token budget', assignedAgentType: 'mock', status: 'todo' });

    const definition: WorkflowDefinition = {
      name: 'Budget test',
      steps: [],
      loops: [
        {
          id: 'budget',
          until: 'verdict_approved',
          maxIterations: 3,
          onExhausted: 'escalate',
          maxTokensPerLoop: 100,
          steps: [
            { name: 'implement', agent: 'mock', capability: 'implementation' },
            { name: 'review', agent: 'mock', capability: 'review' },
          ],
        },
      ],
    };

    const workflow = createWorkflow('Budget loop', definition);
    const result = await runAgentLoop({
      loop: definition.loops![0],
      workflowId: workflow.id,
      workItemId: item.id,
      options: { maxIterations: 3 },
    });

    expect(result.loopStatus).toBe('escalated');
    expect(result.iterations).toBeGreaterThanOrEqual(1);
    expect(result.iterations).toBeLessThanOrEqual(2);
    expect(getWorkItem(item.id)?.status).toBe('in_review');
  });

  it('should honour loop cancel signal between steps in the same iteration', async () => {
    const item = createWorkItem({
      type: 'task',
      title: 'Mid-step cancel',
      assignedAgentType: 'mock',
      status: 'todo',
    });

    jest.spyOn(getAdapter('mock'), 'execute').mockImplementation(async (input: AdapterInput): Promise<AdapterOutput> => {
      const capability = (input.config?.capability as string) || '';
      if (capability !== 'review') {
        requestLoopCancel(item.id);
        return {
          content: '## Implementation complete',
          tokenCount: 20,
          metadata: { adapter: 'mock', capability },
        };
      }
      return {
        content: 'APPROVED',
        tokenCount: 10,
        metadata: { adapter: 'mock', capability },
      };
    });

    const definition: WorkflowDefinition = {
      name: 'Mid-step cancel test',
      steps: [],
      loops: [
        {
          id: 'mid-cancel',
          until: 'verdict_approved',
          maxIterations: 3,
          onExhausted: 'escalate',
          steps: [
            { name: 'implement', agent: 'mock', capability: 'implementation' },
            { name: 'review', agent: 'mock', capability: 'review' },
          ],
        },
      ],
    };

    const workflow = createWorkflow('Mid-step cancel loop', definition);
    const result = await runAgentLoop({
      loop: definition.loops![0],
      workflowId: workflow.id,
      workItemId: item.id,
      options: { maxIterations: 3 },
    });

    expect(result.loopStatus).toBe('cancelled');
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].stepName).toBe('implement');
    expect(getWorkItem(item.id)?.loopStatus).toBe('cancelled');
    clearLoopCancel(item.id);
  });

  it('includes work-dir excerpts in fix prompt on iteration > 1', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-fix-prompt-'));
    process.env.AGENTHUB_WORK_DIR = tmp;

    const item = createWorkItem({
      type: 'task',
      title: 'Fix prompt excerpts',
      assignedAgentType: 'mock',
      status: 'todo',
    });
    const workDir = resolveWorkItemOutputDir(item)!;
    fs.writeFileSync(path.join(workDir, 'fix-me.ts'), 'export const x = 1;\n'.repeat(200));

    let capturedFixPrompt = '';
    let reviewCount = 0;

    jest.spyOn(getAdapter('mock'), 'execute').mockImplementation(async (input: AdapterInput): Promise<AdapterOutput> => {
      const capability = (input.config?.capability as string) || '';
      if (capability === 'review') {
        reviewCount++;
        const content =
          reviewCount < 2
            ? 'CHANGES_REQUESTED\nAdd error handling.'
            : 'APPROVED\nLooks good.';
        return { content, tokenCount: 30, metadata: { adapter: 'mock', capability } };
      }
      if (input.prompt.includes('iteration 2')) {
        capturedFixPrompt = input.prompt;
      }
      return {
        content: '## Implementation',
        tokenCount: 20,
        metadata: { adapter: 'mock', capability },
      };
    });

    const definition: WorkflowDefinition = {
      name: 'Fix prompt test',
      steps: [],
      loops: [
        {
          id: 'fix-prompt',
          until: 'verdict_approved',
          maxIterations: 2,
          onExhausted: 'escalate',
          steps: [
            { name: 'implement', agent: 'mock', capability: 'implementation' },
            { name: 'review', agent: 'mock', capability: 'review' },
          ],
        },
      ],
    };

    const workflow = createWorkflow('Fix prompt loop', definition);
    const result = await runAgentLoop({
      loop: definition.loops![0],
      workflowId: workflow.id,
      workItemId: item.id,
      options: { maxIterations: 2, autoLoop: true },
    });

    expect(result.loopStatus).toBe('approved');
    expect(capturedFixPrompt).toContain('fix-me.ts');
    expect(capturedFixPrompt).toContain('truncated');

    delete process.env.AGENTHUB_WORK_DIR;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('should honour loop cancel signal before iteration starts', async () => {
    const item = createWorkItem({ type: 'task', title: 'Cancel test', assignedAgentType: 'mock', status: 'todo' });
    requestLoopCancel(item.id);

    const definition: WorkflowDefinition = {
      name: 'Cancel test',
      steps: [],
      loops: [
        {
          id: 'cancel',
          until: 'verdict_approved',
          maxIterations: 3,
          onExhausted: 'escalate',
          steps: [
            { name: 'implement', agent: 'mock', capability: 'implementation' },
            { name: 'review', agent: 'mock', capability: 'review' },
          ],
        },
      ],
    };

    const workflow = createWorkflow('Cancel loop', definition);
    const result = await runAgentLoop({
      loop: definition.loops![0],
      workflowId: workflow.id,
      workItemId: item.id,
      options: { maxIterations: 3 },
    });

    expect(result.loopStatus).toBe('cancelled');
    expect(result.steps).toHaveLength(0);
    expect(getWorkItem(item.id)?.loopStatus).toBe('cancelled');
    clearLoopCancel(item.id);
  });
});