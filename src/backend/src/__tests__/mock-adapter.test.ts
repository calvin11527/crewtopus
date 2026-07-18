import { MockAdapter } from '../adapters/mock';
import type { ContextScope } from '../types';

const cleanScope: ContextScope = {
  files: ['// safe.ts\nexport function ok() {}'],
  diffs: [],
  symbols: ['ok'],
  maxTokens: 8000,
  sensitivityLevel: 0,
};

describe('Mock Adapter', () => {
  const adapter = new MockAdapter();

  it('should always be available', async () => {
    expect(await adapter.isAvailable()).toBe(true);
  });

  it('should return deterministic planning response', async () => {
    const output = await adapter.execute({
      prompt: 'Create a plan for the feature',
      contextScope: cleanScope,
      config: { capability: 'planning' },
    });

    expect(output.content).toContain('## Plan');
    expect(output.metadata.deterministic).toBe(true);
    expect(output.metadata.adapter).toBe('mock');
    expect(output.tokenCount).toBeGreaterThan(0);
  });

  it('should return capability-specific responses', async () => {
    const review = await adapter.execute({
      prompt: 'Review the code',
      contextScope: cleanScope,
      config: { capability: 'review' },
    });
    expect(review.content).toContain('## Review');

    const tests = await adapter.execute({
      prompt: 'Write tests',
      contextScope: cleanScope,
      config: { capability: 'testing' },
    });
    expect(tests.content).toContain('describe');
  });

  it('should shutdown without error', () => {
    expect(() => adapter.shutdown()).not.toThrow();
  });
});