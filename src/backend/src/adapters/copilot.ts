import type { AgentAdapter, AdapterInput, AdapterOutput } from './base';
import { buildFullPrompt, commandExists, estimateTokens, resolveCliStreamOptions, spawnCli } from './base';
import { appendCopilotPermissionArgs } from './cli-permissions';
import { endCliStream, type CliStreamContext } from '../modules/cli-stream';

function isModelUnavailableError(text: string): boolean {
  return /Model ".*" from --model flag is not available/i.test(text);
}

/** BA/PM planning needs longer than a quick implement turn. */
function resolveCopilotTimeoutMs(input: AdapterInput): number {
  const fromEnv = Number(process.env.COPILOT_TIMEOUT_MS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;

  const capability = input.config?.capability as string | undefined;
  const phase = input.config?.pipelinePhase as string | undefined;
  if (
    capability === 'analysis' ||
    capability === 'planning' ||
    phase === 'planning' ||
    capability === 'implementation' ||
    phase === 'implementation'
  ) {
    return 600_000; // 10 minutes
  }
  return 300_000; // 5 minutes default
}

/** Adapter for GitHub Copilot CLI. */
export class CopilotAdapter implements AgentAdapter {
  readonly type = 'copilot' as const;
  private command = 'copilot';

  async isAvailable(): Promise<boolean> {
    return commandExists(this.command);
  }

  async execute(input: AdapterInput): Promise<AdapterOutput> {
    const prompt = buildFullPrompt(input);
    const requestedModel = (input.config?.model as string | undefined)?.trim() || 'auto';
    // Prefer explicit model; many plans only allow `auto`.
    let model = requestedModel;
    const cwd = input.config?.cwd as string | undefined;
    const streamCtx = input.config?.cliStream as CliStreamContext | undefined;
    const streamOpts = resolveCliStreamOptions(input, 'copilot');

    const timeoutMs = resolveCopilotTimeoutMs(input);

    const runOnce = async (modelId: string) => {
      const args = appendCopilotPermissionArgs(['-p', prompt], input);
      if (modelId) args.push('--model', modelId);
      return spawnCli(this.command, args, undefined, timeoutMs, streamOpts);
    };

    try {
      let result = await runOnce(model);

      if (
        result.exitCode !== 0 &&
        model !== 'auto' &&
        isModelUnavailableError(`${result.stderr}\n${result.stdout}`)
      ) {
        // Plan entitlement mismatch — retry with auto so BA/PM/review can proceed.
        model = 'auto';
        result = await runOnce(model);
      }

      if (result.exitCode !== 0) {
        throw new Error(`Copilot CLI failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
      }

      const content = result.stdout.trim();
      return {
        content,
        tokenCount: estimateTokens(prompt) + estimateTokens(content),
        metadata: {
          adapter: 'copilot',
          exitCode: result.exitCode,
          model,
          requestedModel: requestedModel !== model ? requestedModel : null,
          cwd: cwd ?? null,
        },
      };
    } finally {
      if (streamCtx?.workItemId) {
        endCliStream(streamCtx.workItemId, {
          agentType: 'copilot',
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