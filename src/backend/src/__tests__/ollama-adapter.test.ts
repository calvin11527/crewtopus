import { OllamaAdapter } from '../adapters/ollama';

describe('OllamaAdapter', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('uses chat API when available', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: 'function add(a, b) { return a + b; }' }, eval_count: 12 }),
    }) as unknown as typeof fetch;

    const adapter = new OllamaAdapter();
    const result = await adapter.execute({
      prompt: 'Write a TypeScript add function',
      contextScope: { files: [], diffs: [], symbols: [], maxTokens: 8192, sensitivityLevel: 0 },
    });

    expect(result.content).toContain('add');
    expect(result.metadata.api).toBe('chat');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/chat'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('falls back to generate API when chat fails', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, text: async () => 'chat unsupported' })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ response: 'legacy response', eval_count: 8 }),
      }) as unknown as typeof fetch;

    const adapter = new OllamaAdapter();
    const result = await adapter.execute({
      prompt: 'Say hello',
      contextScope: { files: [], diffs: [], symbols: [], maxTokens: 8192, sensitivityLevel: 0 },
    });

    expect(result.content).toBe('legacy response');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('reports availability from /api/tags', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
    await expect(new OllamaAdapter().isAvailable()).resolves.toBe(true);
  });
});