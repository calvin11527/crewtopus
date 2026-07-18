import { CopilotAdapter } from '../adapters/copilot';
import * as base from '../adapters/base';

describe('CopilotAdapter', () => {
  const adapter = new CopilotAdapter();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('passes cwd and path permissions for implementation tasks', async () => {
    jest.spyOn(base, 'spawnCli').mockResolvedValue({
      stdout: 'Done',
      stderr: '',
      exitCode: 0,
    });

    await adapter.execute({
      prompt: 'Create README.md',
      contextScope: { files: [], diffs: [], symbols: [], maxTokens: 8000, sensitivityLevel: 0 },
      config: { cwd: '/tmp/agenthub-work/AH-58', capability: 'implementation' },
    });

    expect(base.spawnCli).toHaveBeenCalledWith(
      'copilot',
      expect.arrayContaining([
        '-C',
        '/tmp/agenthub-work/AH-58',
        '--allow-all-tools',
        '--allow-all-paths',
        '--model',
        'auto',
      ]),
      undefined,
      600_000,
      undefined
    );
  });

  it('uses 10-minute timeout and write flags for BA analysis', async () => {
    jest.spyOn(base, 'spawnCli').mockResolvedValue({
      stdout: 'Requirements ready',
      stderr: '',
      exitCode: 0,
    });

    await adapter.execute({
      prompt: 'Write requirements.md',
      contextScope: { files: [], diffs: [], symbols: [], maxTokens: 8000, sensitivityLevel: 0 },
      config: {
        cwd: '/tmp/agenthub-work/AH-69',
        capability: 'analysis',
        pipelinePhase: 'planning',
      },
    });

    expect(base.spawnCli).toHaveBeenCalledWith(
      'copilot',
      expect.arrayContaining([
        '-C',
        '/tmp/agenthub-work/AH-69',
        '--allow-all-tools',
        '--allow-all-paths',
        '--model',
        'auto',
      ]),
      undefined,
      600_000,
      undefined
    );
  });

  it('retries with auto when requested model is not available', async () => {
    const spawn = jest.spyOn(base, 'spawnCli');
    spawn
      .mockResolvedValueOnce({
        stdout: '',
        stderr: 'Error: Model "gpt-5.4" from --model flag is not available.',
        exitCode: 1,
      })
      .mockResolvedValueOnce({
        stdout: 'Done with auto',
        stderr: '',
        exitCode: 0,
      });

    const out = await adapter.execute({
      prompt: 'Analyze story',
      contextScope: { files: [], diffs: [], symbols: [], maxTokens: 8000, sensitivityLevel: 0 },
      config: { model: 'gpt-5.4', capability: 'analysis' },
    });

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn.mock.calls[0][1]).toEqual(expect.arrayContaining(['--model', 'gpt-5.4']));
    expect(spawn.mock.calls[1][1]).toEqual(expect.arrayContaining(['--model', 'auto']));
    expect(out.content).toBe('Done with auto');
    expect(out.metadata.model).toBe('auto');
    expect(out.metadata.requestedModel).toBe('gpt-5.4');
  });
});