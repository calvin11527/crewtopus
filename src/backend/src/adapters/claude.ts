import type { AgentAdapter, AdapterInput, AdapterOutput } from './base';
import { buildFullPrompt, commandExists, estimateTokens, resolveCliStreamOptions, spawnCli } from './base';
import { appendClaudePermissionArgs } from './cli-permissions';
import { endCliStream, type CliStreamContext } from '../modules/cli-stream';

/** Adapter for Claude Code CLI. */
export class ClaudeAdapter implements AgentAdapter {
  readonly type = 'claude' as const;
  private command = 'claude';

  async isAvailable(): Promise<boolean> {
    return commandExists(this.command);
  }

  async execute(input: AdapterInput): Promise<AdapterOutput> {
    const prompt = buildFullPrompt(input);
    const args = appendClaudePermissionArgs(['-p', prompt], input);
    const model = input.config?.model as string | undefined;
    if (model) args.push('--model', model);
    const cwd = input.config?.cwd as string | undefined;
    const streamCtx = input.config?.cliStream as CliStreamContext | undefined;
    const streamOpts = resolveCliStreamOptions(input, 'claude');

    try {
      const result = await spawnCli(this.command, args, undefined, 180_000, streamOpts);

      if (result.exitCode !== 0) {
        throw new Error(`Claude CLI failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
      }

      const content = result.stdout.trim();
      return {
        content,
        tokenCount: estimateTokens(prompt) + estimateTokens(content),
        metadata: { adapter: 'claude', exitCode: result.exitCode, model: model ?? null, cwd: cwd ?? null },
      };
    } finally {
      if (streamCtx?.workItemId) {
        endCliStream(streamCtx.workItemId, {
          agentType: 'claude',
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