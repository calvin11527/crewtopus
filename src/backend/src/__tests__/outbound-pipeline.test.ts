import type { ContextScope } from '../types';
import { getAdapter } from '../adapters';
import {
  executeOutboundPipeline,
  PrivacyBlockedError,
} from '../modules/outbound-pipeline';
import { listAuditEntries } from '../modules/audit-logger';

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

  it('should fall back to mock adapter when external CLI is unavailable', async () => {
    const scope = makeScope({
      files: ['// safe.ts\nexport const ok = true;'],
    });

    jest.spyOn(getAdapter('claude'), 'isAvailable').mockResolvedValue(false);

    const result = await executeOutboundPipeline({
      agentType: 'claude',
      prompt: 'Summarize the module',
      contextScope: scope,
      capability: 'analysis',
    });

    expect(result.agentType).toBe('mock');
    expect(result.content).toContain('## Analysis');
  });
});