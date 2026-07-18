import path from 'path';
import { appendClaudePermissionArgs, appendCopilotPermissionArgs, collectWorkItemAllowedDirs } from '../adapters/cli-permissions';
import type { AdapterInput } from '../adapters/base';

function baseInput(overrides: Partial<AdapterInput> = {}): AdapterInput {
  return {
    prompt: 'test',
    contextScope: { files: [], diffs: [], symbols: [], maxTokens: 8000, sensitivityLevel: 0 },
    config: {},
    ...overrides,
  };
}

describe('cli-permissions', () => {
  it('collects work item output dir, .agenthub-work parent, and repo root', () => {
    const cwd = '/repo/.agenthub-work/AH-58';
    const dirs = collectWorkItemAllowedDirs(cwd);
    expect(dirs).toEqual(
      expect.arrayContaining([
        path.resolve('/repo/.agenthub-work/AH-58'),
        path.resolve('/repo/.agenthub-work'),
        path.resolve('/repo'),
      ])
    );
  });

  it('adds copilot cwd and allow-all flags for implementation tasks', () => {
    const cwd = '/tmp/agenthub-work/AH-58';
    const args = appendCopilotPermissionArgs(['-p', 'hello'], baseInput({
      config: { cwd, capability: 'implementation' },
    }));

    expect(args).toEqual(
      expect.arrayContaining([
        '-C',
        cwd,
        '--add-dir',
        path.resolve(cwd),
        '--allow-all-tools',
        '--allow-all-paths',
      ])
    );
  });

  it('adds claude bypassPermissions for implementation tasks', () => {
    const cwd = '/tmp/agenthub-work/AH-58';
    const args = appendClaudePermissionArgs(['-p', 'hello'], baseInput({
      config: { cwd, capability: 'implementation' },
    }));

    expect(args).toEqual(
      expect.arrayContaining([
        '--add-dir',
        path.resolve(cwd),
        '--permission-mode',
        'bypassPermissions',
      ])
    );
  });

  it('uses plan permission mode for copilot review without allow-all-paths', () => {
    const cwd = '/tmp/agenthub-work/AH-58';
    const args = appendCopilotPermissionArgs(['-p', 'review'], baseInput({
      config: { cwd, capability: 'review', permissionMode: 'plan' },
    }));

    expect(args).toContain('-C');
    expect(args).not.toContain('--allow-all-paths');
  });

  it('grants write access for BA analysis and PM planning', () => {
    const cwd = '/tmp/agenthub-work/AH-69';
    for (const capability of ['analysis', 'planning'] as const) {
      const args = appendCopilotPermissionArgs(
        ['-p', 'hello'],
        baseInput({ config: { cwd, capability, pipelinePhase: 'planning' } })
      );
      expect(args).toEqual(
        expect.arrayContaining(['--allow-all-tools', '--allow-all-paths'])
      );
    }
  });
});