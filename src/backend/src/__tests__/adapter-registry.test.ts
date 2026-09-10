import type { AdapterInput, AdapterOutput, AgentAdapter } from '../adapters/base';
import {
  getAdapter,
  hasAdapter,
  listAdapterTypes,
  registerAdapter,
  unregisterAdapter,
} from '../adapters';

class PluginAdapter implements AgentAdapter {
  readonly type = 'plugin-cli';
  async isAvailable(): Promise<boolean> {
    return true;
  }
  async execute(input: AdapterInput): Promise<AdapterOutput> {
    return { content: `plugin:${input.prompt}`, tokenCount: 1, metadata: { adapter: this.type } };
  }
  shutdown(): void {
    /* no-op */
  }
}

describe('adapter plugin registry', () => {
  afterEach(() => {
    unregisterAdapter('plugin-cli');
  });

  it('ships built-in adapters', () => {
    expect(listAdapterTypes()).toEqual(
      expect.arrayContaining(['mock', 'grok', 'copilot', 'claude', 'ollama', 'antigravity'])
    );
    expect(hasAdapter('mock')).toBe(true);
  });

  it('registers a plugin adapter that getAdapter can run', async () => {
    registerAdapter(new PluginAdapter());
    expect(hasAdapter('plugin-cli')).toBe(true);
    const out = await getAdapter('plugin-cli').execute({
      prompt: 'hello',
      contextScope: { files: [], diffs: [], symbols: [], maxTokens: 100, sensitivityLevel: 0 },
    });
    expect(out.content).toBe('plugin:hello');
  });

  it('rejects duplicate registration unless replace is set', () => {
    registerAdapter(new PluginAdapter());
    expect(() => registerAdapter(new PluginAdapter())).toThrow(/already registered/);
    registerAdapter(new PluginAdapter(), { replace: true });
    expect(hasAdapter('plugin-cli')).toBe(true);
  });
});
