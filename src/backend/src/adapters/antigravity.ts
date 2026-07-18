import type { AgentAdapter, AdapterInput, AdapterOutput } from './base';
import { buildFullPrompt, commandExists, estimateTokens, resolveCliStreamOptions, spawnCli } from './base';
import { endCliStream, type CliStreamContext } from '../modules/cli-stream';

/** Adapter for Antigravity CLI. */
export class AntigravityAdapter implements AgentAdapter {
  readonly type = 'antigravity' as const;
  private command = 'antigravity';

  async isAvailable(): Promise<boolean> {
    return commandExists(this.command);
  }

  async execute(input: AdapterInput): Promise<AdapterOutput> {
    const prompt = buildFullPrompt(input);
    const args = ['-p', prompt];
    const model = input.config?.model as string | undefined;
    if (model && model !== 'default') args.push('--model', model);
    const streamCtx = input.config?.cliStream as CliStreamContext | undefined;
    const streamOpts = resolveCliStreamOptions(input, 'antigravity');

    try {
      const result = await spawnCli(this.command, args, undefined, 180_000, streamOpts);

      if (result.exitCode !== 0) {
        throw new Error(`Antigravity CLI failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
      }

      const content = result.stdout.trim();
      return {
        content,
        tokenCount: estimateTokens(prompt) + estimateTokens(content),
        metadata: { adapter: 'antigravity', exitCode: result.exitCode, model: model ?? null },
      };
    } finally {
      if (streamCtx?.workItemId) {
        endCliStream(streamCtx.workItemId, {
          agentType: 'antigravity',
          phase: streamCtx.phase,
          loopIteration: streamCtx.loopIteration,
        });
      }
    }
  }

  shutdown(): void {
    /* no-op */
  }
}