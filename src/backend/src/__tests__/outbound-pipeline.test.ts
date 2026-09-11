import type { ContextScope } from '../types';
import { getAdapter } from '../adapters';
import {
  executeOutboundPipeline,
  PrivacyBlockedError,
  AgentUnavailableError,
} from '../modules/outbound-pipeline';
import { listAuditEntries } from '../modules/audit-logger';
import { ApprovalRequiredError, approveRequest } from '../modules/approval-gate';
import { createWorkItem } from '../modules/work-items';

function makeScope(overrides: Partial<ContextScope> = {}): ContextScope {
  return {
    files: [],
    diffs: [],
    symbols: [],
    maxTokens: 8000,
    sensitivityLevel: 0,
    ...overrides,
  };
}

describe('Outbound Pipeline Integration', () => {
  it('should execute Task → Privacy → Agent → Audit for clean context', async () => {
    const scope = makeScope({
      files: ['// module.ts\nexport function run() { return true; }'],
      symbols: ['run'],
    });

    const result = await executeOutboundPipeline({
      agentType: 'mock',
      prompt: 'Implement the run function',
      contextScope: scope,
      capability: 'implementation',
      task: 'integration/clean',
    });

    expect(result.agentType).toBe('mock');
    expect(result.content).toContain('Implementation');
    expect(result.auditId).toBeTruthy();
    expect(result.tokenCount).toBeGreaterThan(0);

    const audits = listAuditEntries({ limit: 10 });
    expect(audits.some((a) => a.id === result.auditId)).toBe(true);
  });

  it('should block secrets and write rejection audit entry', async () => {
    const scope = makeScope({
      files: ['const token = "sk-abcdefghijklmnopqrstuvwxyz123456"'],
    });

    await expect(
      executeOutboundPipeline({
        agentType: 'mock',
        prompt: 'Process sensitive data',
        contextScope: scope,
        task: 'integration/blocked',
      })
    ).rejects.toBeInstanceOf(PrivacyBlockedError);

    const audits = listAuditEntries({ limit: 10 });
    expect(audits.some((a) => a.approvalStatus === 'rejected')).toBe(true);
  });

  it('should block JWT tokens in outbound payloads', async () => {
    const scope = makeScope({
      diffs: [
        'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
      ],
    });

    await expect(
      executeOutboundPipeline({
        agentType: 'mock',
        prompt: 'Ship changes',
        contextScope: scope,
      })
    ).rejects.toBeInstanceOf(PrivacyBlockedError);
  });

  it('fails closed when the real adapter is unavailable', async () => {
    const scope = makeScope({
      files: ['// safe.ts\nexport const ok = true;'],
    });

    jest.spyOn(getAdapter('claude'), 'isAvailable').mockResolvedValue(false);

    await expect(
      executeOutboundPipeline({
        agentType: 'claude',
        prompt: 'Summarize the module',
        contextScope: scope,
        capability: 'analysis',
      })
    ).rejects.toBeInstanceOf(AgentUnavailableError);
  });

  it('falls back to mock only when demo flag is set', async () => {
    const scope = makeScope({
      files: ['// safe.ts\nexport const ok = true;'],
    });

    jest.spyOn(getAdapter('claude'), 'isAvailable').mockResolvedValue(false);

    const result = await executeOutboundPipeline({
      agentType: 'claude',
      prompt: 'Summarize the module',
      contextScope: scope,
      capability: 'analysis',
      demo: true,
    });

    expect(result.agentType).toBe('mock');
    expect(result.degraded).toBe(true);
    expect(result.content).toContain('## Analysis');
  });

  it('pauses on sensitivity 2 and continues after the request is approved', async () => {
    const item = createWorkItem({ type: 'task', title: 'Sensitive outbound', assignedAgentType: 'mock' });
    const scope = makeScope({
      files: ['// notes.md\nno secrets here'],
      sensitivityLevel: 2,
    });

    let thrown: ApprovalRequiredError | undefined;
    try {
      await executeOutboundPipeline({
        agentType: 'mock',
        prompt: 'Summarize',
        contextScope: scope,
        workItemId: item.id,
        task: `${item.key}/analysis`,
      });
    } catch (err) {
      thrown = err as ApprovalRequiredError;
    }

    expect(thrown).toBeInstanceOf(ApprovalRequiredError);
    expect(thrown?.approvalRequest.id).toBeTruthy();

    approveRequest(thrown!.approvalRequest.id);

    const result = await executeOutboundPipeline({
      agentType: 'mock',
      prompt: 'Summarize',
      contextScope: scope,
      workItemId: item.id,
      task: `${item.key}/analysis`,
      approvalId: thrown!.approvalRequest.id,
    });
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.approvalStatus).toBe('approved');
  });

  it('auto-consumes a matching approved request without an explicit approvalId', async () => {
    const item = createWorkItem({ type: 'task', title: 'Auto consume', assignedAgentType: 'mock' });
    const scope = makeScope({
      files: ['// notes.md\nsafe'],
      sensitivityLevel: 2,
    });

    await expect(
      executeOutboundPipeline({
        agentType: 'mock',
        prompt: 'Go',
        contextScope: scope,
        workItemId: item.id,
      })
    ).rejects.toBeInstanceOf(ApprovalRequiredError);

    const { listApprovalRequests } = await import('../modules/approval-gate');
    const pending = listApprovalRequests('pending').find((r) => r.workItemId === item.id);
    expect(pending).toBeTruthy();
    approveRequest(pending!.id);

    const result = await executeOutboundPipeline({
      agentType: 'mock',
      prompt: 'Go',
      contextScope: scope,
      workItemId: item.id,
    });
    expect(result.approvalStatus).toBe('approved');
  });
});
