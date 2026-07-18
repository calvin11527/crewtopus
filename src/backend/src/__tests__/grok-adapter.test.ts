import {
  GrokAdapter,
  normalizeGrokPermissionMode,
  parseGrokOutput,
  parseGrokStreamingStdout,
  resolveGrokOutputFormat,
  formatGrokStreamEvent,
} from '../adapters/grok';
import type { SpawnCliOptions } from '../adapters/base';
import * as base from '../adapters/base';

describe('GrokAdapter', () => {
  const adapter = new GrokAdapter();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('normalizeGrokPermissionMode', () => {
    it('maps legacy readOnly to plan', () => {
      expect(normalizeGrokPermissionMode('readOnly')).toBe('plan');
    });

    it('passes through valid Grok CLI modes', () => {
      expect(normalizeGrokPermissionMode('bypassPermissions')).toBe('bypassPermissions');
    });
  });

  describe('parseGrokOutput', () => {
    it('extracts text from JSON output', () => {
      expect(parseGrokOutput('{"text":"Hello from Grok","stopReason":"EndTurn"}')).toBe('Hello from Grok');
    });

    it('extracts text from streaming-json NDJSON', () => {
      const stdout = [
        '{"type":"thought","data":"Thinking"}',
        '{"type":"text","data":"Hello"}',
        '{"type":"text","data":" world"}',
        '{"type":"end","stopReason":"EndTurn"}',
      ].join('\n');
      expect(parseGrokStreamingStdout(stdout)).toBe('Hello world');
      expect(parseGrokOutput(stdout)).toBe('Hello world');
    });

    it('returns plain stdout when not JSON', () => {
      expect(parseGrokOutput('plain response')).toBe('plain response');
    });
  });

  describe('streaming console', () => {
    it('formats thought and text events', () => {
      expect(formatGrokStreamEvent({ type: 'thought', data: 'Planning' })).toContain('Planning');
      expect(formatGrokStreamEvent({ type: 'text', data: 'Done' })).toBe('Done');
    });

    it('prefers streaming-json when cli stream handlers are attached', () => {
      const opts: SpawnCliOptions = { onStdout: () => {} };
      expect(resolveGrokOutputFormat(opts)).toBe('streaming-json');
      expect(resolveGrokOutputFormat(undefined)).toBe('json');
    });
  });

  it('should pass --model when configured on the agent', async () => {
    jest.spyOn(base, 'spawnCli').mockResolvedValue({
      stdout: '{"text":"Done","stopReason":"EndTurn"}',
      stderr: '',
      exitCode: 0,
    });

    await adapter.execute({
      prompt: 'Hello',
      contextScope: { files: [], diffs: [], symbols: [], maxTokens: 8000, sensitivityLevel: 0 },
      config: { model: 'grok-build' },
    });

    expect(base.spawnCli).toHaveBeenCalledWith(
      'grok',
      expect.arrayContaining(['--model', 'grok-build']),
      undefined,
      180_000,
      undefined
    );
  });

  it('should use bypassPermissions for implementation tasks with cwd', async () => {
    jest.spyOn(base, 'spawnCli').mockResolvedValue({
      stdout: '{"text":"Done","stopReason":"EndTurn"}',
      stderr: '',
      exitCode: 0,
    });

    await adapter.execute({
      prompt: 'Create hello.txt',
      contextScope: { files: [], diffs: [], symbols: [], maxTokens: 8000, sensitivityLevel: 0 },
      config: { cwd: '/tmp/grok-test', capability: 'implementation' },
    });

    expect(base.spawnCli).toHaveBeenCalledWith(
      'grok',
      expect.arrayContaining(['--permission-mode', 'bypassPermissions']),
      undefined,
      180_000,
      undefined
    );
  });

  it('should use streaming-json when cli stream is enabled', async () => {
    jest.spyOn(base, 'spawnCli').mockResolvedValue({
      stdout: '{"type":"text","data":"Done"}\n{"type":"end","stopReason":"EndTurn"}',
      stderr: '',
      exitCode: 0,
    });

    await adapter.execute({
      prompt: 'Create hello.txt',
      contextScope: { files: [], diffs: [], symbols: [], maxTokens: 8000, sensitivityLevel: 0 },
      config: {
        cwd: '/tmp/grok-test',
        cliStream: { workItemId: 'wi-1', agentType: 'grok', phase: 'implementation' },
      },
    });

    expect(base.spawnCli).toHaveBeenCalledWith(
      'grok',
      expect.arrayContaining(['--output-format', 'streaming-json']),
      undefined,
      180_000,
      expect.objectContaining({ onStdout: expect.any(Function) })
    );
  });

  it('should invoke grok with headless flags', async () => {
    jest.spyOn(base, 'spawnCli').mockResolvedValue({
      stdout: '{"text":"Done","stopReason":"EndTurn"}',
      stderr: '',
      exitCode: 0,
    });

    const output = await adapter.execute({
      prompt: 'Create hello.txt',
      contextScope: { files: [], diffs: [], symbols: [], maxTokens: 8000, sensitivityLevel: 0 },
      config: { cwd: '/tmp/grok-test' },
    });

    expect(output.content).toBe('Done');
    expect(output.metadata.adapter).toBe('grok');
    expect(base.spawnCli).toHaveBeenCalledWith(
      'grok',
      expect.arrayContaining(['-p', 'Create hello.txt', '--output-format', 'json', '--cwd', '/tmp/grok-test']),
      undefined,
      180_000,
      undefined
    );
  });

  it('should strip null bytes from prompt passed to grok CLI', async () => {
    jest.spyOn(base, 'spawnCli').mockResolvedValue({
      stdout: '{"text":"Done","stopReason":"EndTurn"}',
      stderr: '',
      exitCode: 0,
    });

    await adapter.execute({
      prompt: 'Improve AgentHub',
      contextScope: {
        files: ['// .DS_Store\n\x00\x00\x01Bud1'],
        diffs: [],
        symbols: [],
        maxTokens: 8000,
        sensitivityLevel: 0,
      },
    });

    const args = (base.spawnCli as jest.Mock).mock.calls[0][1] as string[];
    const promptArg = args[args.indexOf('-p') + 1];
    expect(promptArg).not.toMatch(/\0/);
    expect(promptArg).toContain('Improve AgentHub');
  });

  it('should use bypassPermissions for implementation even when GROK_PERMISSION_MODE=acceptEdits', async () => {
    const previous = process.env.GROK_PERMISSION_MODE;
    process.env.GROK_PERMISSION_MODE = 'acceptEdits';

    jest.spyOn(base, 'spawnCli').mockResolvedValue({
      stdout: '{"text":"Done","stopReason":"EndTurn"}',
      stderr: '',
      exitCode: 0,
    });

    await adapter.execute({
      prompt: 'Write improvements.md',
      contextScope: { files: [], diffs: [], symbols: [], maxTokens: 8000, sensitivityLevel: 0 },
      config: { cwd: '/tmp/grok-test', capability: 'implementation' },
    });

    expect(base.spawnCli).toHaveBeenCalledWith(
      'grok',
      expect.arrayContaining(['--permission-mode', 'bypassPermissions']),
      undefined,
      180_000,
      undefined
    );

    if (previous === undefined) delete process.env.GROK_PERMISSION_MODE;
    else process.env.GROK_PERMISSION_MODE = previous;
  });

  it('should map readOnly permissionMode to plan for review', async () => {
    jest.spyOn(base, 'spawnCli').mockResolvedValue({
      stdout: '{"text":"APPROVED","stopReason":"EndTurn"}',
      stderr: '',
      exitCode: 0,
    });

    await adapter.execute({
      prompt: 'Review the code',
      contextScope: { files: [], diffs: [], symbols: [], maxTokens: 8000, sensitivityLevel: 0 },
      config: { capability: 'review', permissionMode: 'readOnly' },
    });

    expect(base.spawnCli).toHaveBeenCalledWith(
      'grok',
      expect.arrayContaining(['--permission-mode', 'plan']),
      undefined,
      180_000,
      undefined
    );
  });

  it('should throw when grok returns empty output', async () => {
    jest.spyOn(base, 'spawnCli').mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
    });

    await expect(
      adapter.execute({
        prompt: 'noop',
        contextScope: { files: [], diffs: [], symbols: [], maxTokens: 8000, sensitivityLevel: 0 },
      })
    ).rejects.toThrow('empty output');
  });
});