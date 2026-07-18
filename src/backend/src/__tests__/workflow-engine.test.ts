import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AdapterInput, AdapterOutput } from '../adapters/base';
import { getAdapter } from '../adapters';
import { executeWorkflow, createWorkflow, getExecution } from '../modules/workflow-engine';
import { listAuditEntries } from '../modules/audit-logger';
import { ensureGrokCopilotWorkflow } from '../modules/work-item-pipeline';

async function waitForExecution(
  executionId: string,
  status: string,
  timeoutMs = 10_000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const execution = getExecution(executionId);
    if (execution?.status === status) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  const final = getExecution(executionId);
  throw new Error(`Expected status "${status}" but got "${final?.status ?? 'missing'}"`);
}

describe('Workflow Engine Integration', () => {
  it('should execute workflow steps in correct order with mock agents', async () => {
    const workflow = createWorkflow('CI Pipeline', {
      name: 'CI Pipeline',
      steps: [
        { name: 'Planner', agent: 'mock', capability: 'planning' },
        { name: 'Implementer', agent: 'mock', capability: 'implementation' },
        { name: 'Reviewer', agent: 'mock', capability: 'review' },
        { name: 'Tester', agent: 'mock', capability: 'testing' },
      ],
    });

    const execution = await executeWorkflow(workflow.id);
    await waitForExecution(execution.id, 'completed');

    const completed = getExecution(execution.id);
    expect(completed?.status).toBe('completed');
    expect(completed?.result).toContain('## Plan');
    expect(completed?.result).toContain('## Implementation');
    expect(completed?.result).toContain('## Review');
    expect(completed?.result).toContain('describe');

    const audits = listAuditEntries({ workflowId: workflow.id, limit: 20 });
    expect(audits.length).toBeGreaterThanOrEqual(4);
  });

  it('should fail workflow when privacy guard blocks outbound context', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenthub-wf-'));
    const secretFile = path.join(tmpDir, 'leak.ts');
    fs.writeFileSync(secretFile, 'const apiKey = "sk-abcdefghijklmnopqrstuvwxyz123456";');

    const workflow = createWorkflow('Blocked Pipeline', {
      name: 'Blocked Pipeline',
      steps: [{ name: 'Process', agent: 'mock', capability: 'implementation' }],
    });

    const execution = await executeWorkflow(workflow.id, {
      filePaths: ['leak.ts'],
      basePath: tmpDir,
    });

    await waitForExecution(execution.id, 'failed');

    const failed = getExecution(execution.id);
    expect(failed?.status).toBe('failed');
    expect(failed?.result).toContain('privacy guard');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should execute workflow loop until approved verdict', async () => {
    let reviewCallCount = 0;
    jest.spyOn(getAdapter('grok'), 'isAvailable').mockResolvedValue(false);
    jest.spyOn(getAdapter('copilot'), 'isAvailable').mockResolvedValue(false);
    jest.spyOn(getAdapter('mock'), 'execute').mockImplementation(async (input: AdapterInput): Promise<AdapterOutput> => {
      const capability = (input.config?.capability as string) || '';
      if (capability === 'review') {
        reviewCallCount++;
        const content =
          reviewCallCount < 2
            ? 'CHANGES_REQUESTED\nFix tests.'
            : 'APPROVED\nShip it.';
        return { content, tokenCount: 20, metadata: { adapter: 'mock' } };
      }
      if (capability === 'testing') {
        return { content: 'PASS\nChecks ok.', tokenCount: 10, metadata: { adapter: 'mock' } };
      }
      return { content: '## Implementation\nDone.', tokenCount: 15, metadata: { adapter: 'mock' } };
    });

    const workflowId = ensureGrokCopilotWorkflow();
    const execution = await executeWorkflow(workflowId, { autoLoop: true, maxLoopIterations: 3 });
    await waitForExecution(execution.id, 'completed');

    const completed = getExecution(execution.id);
    expect(completed?.status).toBe('completed');
    expect(completed?.loopResults?.[0].iterations).toBe(2);
    expect(completed?.loopResults?.[0].loopStatus).toBe('approved');
    expect(completed?.loopResults?.[0].stepCount).toBe(6);

    jest.restoreAllMocks();
  });
});