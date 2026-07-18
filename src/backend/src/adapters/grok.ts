import fs from 'fs';
import type { AgentAdapter, AdapterInput, AdapterOutput } from './base';
import {
  buildFullPrompt,
  commandExists,
  estimateTokens,
  resolveCliStreamOptions,
  spawnCli,
  type SpawnCliOptions,
} from './base';
import { endCliStream, type CliStreamContext } from '../modules/cli-stream';

function grokCommand(): string {
  return process.env.GROK_CLI_PATH || 'grok';
}

/** Grok CLI --permission-mode values (readOnly was removed; map legacy configs). */
export const GROK_PERMISSION_MODES = [
  'default',
  'acceptEdits',
  'auto',
  'dontAsk',
  'bypassPermissions',
  'plan',
] as const;

export type GrokPermissionMode = (typeof GROK_PERMISSION_MODES)[number];

export type GrokOutputFormat = 'json' | 'streaming-json';

export interface GrokStreamEvent {
  type: string;
  data?: string;
  stopReason?: string;
}

export function normalizeGrokPermissionMode(mode: string): GrokPermissionMode {
  if ((GROK_PERMISSION_MODES as readonly string[]).includes(mode)) {
    return mode as GrokPermissionMode;
  }
  if (mode === 'readOnly') return 'plan';
  return 'acceptEdits';
}

/** Resolve Grok permission mode from harness profile, capability, or env. */
function resolveGrokPermissionMode(
  capability?: string,
  cwd?: string,
  configured?: string
): GrokPermissionMode {
  if (configured) return normalizeGrokPermissionMode(configured);
  const needsFileTools = capability === 'implementation' || Boolean(cwd);
  if (needsFileTools) return 'bypassPermissions';
  return normalizeGrokPermissionMode(process.env.GROK_PERMISSION_MODE || 'acceptEdits');
}

/** Format one NDJSON streaming-json line for the agent console. */
export function formatGrokStreamEvent(ev: GrokStreamEvent): string | null {
  if (ev.type === 'thought' && ev.data) return `\x1b[90m💭 ${ev.data}\x1b[0m`;
  if (ev.type === 'text' && ev.data) return ev.data;
  if (ev.type === 'end') {
    return `\x1b[90m— ${ev.stopReason ?? 'done'} —\x1b[0m`;
  }
  return null;
}

/** Parse a single NDJSON line from Grok streaming-json output. */
export function formatGrokStreamLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return formatGrokStreamEvent(JSON.parse(trimmed) as GrokStreamEvent);
  } catch {
    return trimmed;
  }
}

/** Concatenate final assistant text from Grok streaming-json stdout. */
export function parseGrokStreamingStdout(stdout: string): string {
  const parts: string[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const ev = JSON.parse(trimmed) as GrokStreamEvent;
      if (ev.type === 'text' && typeof ev.data === 'string') parts.push(ev.data);
    } catch {
      /* not NDJSON */
    }
  }
  return parts.join('');
}

/** Parse Grok headless JSON or streaming-json output; fall back to raw stdout. */
export function parseGrokOutput(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) return '';

  const streamed = parseGrokStreamingStdout(trimmed);
  if (streamed) return streamed;

  try {
    const json = JSON.parse(trimmed) as { text?: string; message?: string };
    if (typeof json.text === 'string' && json.text.length > 0) return json.text;
    if (typeof json.message === 'string' && json.message.length > 0) return json.message;
  } catch {
    /* plain text or NDJSON */
  }

  return trimmed;
}

/** Use live NDJSON streaming when piping CLI output to the work-item console. */
export function resolveGrokOutputFormat(streamOpts?: SpawnCliOptions): GrokOutputFormat {
  if (!streamOpts?.onStdout) return 'json';
  if (process.env.AGENTHUB_GROK_STREAM === 'false') return 'json';
  return 'streaming-json';
}

function wrapGrokStreamHandlers(opts: SpawnCliOptions): SpawnCliOptions {
  let pending = '';
  const prevStdout = opts.onStdout;

  return {
    ...opts,
    onStdout: (chunk) => {
      pending += chunk;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        const formatted = formatGrokStreamLine(line);
        if (formatted && prevStdout) prevStdout(formatted);
      }
    },
  };
}

/** Adapter for Grok CLI (headless single-turn mode). */
export class GrokAdapter implements AgentAdapter {
  readonly type = 'grok' as const;

  async isAvailable(): Promise<boolean> {
    const command = grokCommand();
    if (!(await commandExists(command))) return false;

    try {
      const result = await spawnCli(command, ['--version'], undefined, 10_000);
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  async execute(input: AdapterInput): Promise<AdapterOutput> {
    const command = grokCommand();
    const prompt = buildFullPrompt(input);
    const cwd =
      (input.config?.cwd as string | undefined) ||
      process.env.GROK_CWD ||
      process.env.AGENTHUB_WORK_DIR;
    const capability = input.config?.capability as string | undefined;
    const permissionMode =
      input.config?.permissionMode != null
        ? normalizeGrokPermissionMode(String(input.config.permissionMode))
        : resolveGrokPermissionMode(capability, cwd);
    const alwaysApprove = process.env.GROK_ALWAYS_APPROVE !== 'false';
    const timeoutMs = Number(process.env.GROK_TIMEOUT_MS) || 180_000;

    const streamCtx = input.config?.cliStream as CliStreamContext | undefined;
    const streamOpts = resolveCliStreamOptions(input, 'grok');
    const outputFormat = resolveGrokOutputFormat(streamOpts);
    const effectiveStreamOpts =
      outputFormat === 'streaming-json' && streamOpts
        ? wrapGrokStreamHandlers(streamOpts)
        : streamOpts;

    const args = [
      '-p',
      prompt,
      '--output-format',
      outputFormat,
      '--no-alt-screen',
      '--permission-mode',
      permissionMode,
    ];

    if (alwaysApprove) args.push('--always-approve');
    const model = input.config?.model as string | undefined;
    if (model) args.push('--model', model);
    if (cwd) {
      fs.mkdirSync(cwd, { recursive: true });
      args.push('--cwd', cwd);
    }

    try {
      const result = await spawnCli(command, args, undefined, timeoutMs, effectiveStreamOpts);

      if (result.exitCode !== 0) {
        throw new Error(`Grok CLI failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
      }

      const content = parseGrokOutput(result.stdout);
      if (!content) {
        throw new Error('Grok CLI returned empty output');
      }

      const billedOutput =
        outputFormat === 'streaming-json' && result.stdout.length > content.length
          ? result.stdout
          : content;

      return {
        content,
        tokenCount: estimateTokens(prompt) + estimateTokens(billedOutput),
        metadata: {
          adapter: 'grok',
          exitCode: result.exitCode,
          cwd: cwd ?? null,
          permissionMode,
          outputFormat,
          model: model ?? null,
        },
      };
    } finally {
      if (streamCtx?.workItemId) {
        endCliStream(streamCtx.workItemId, {
          agentType: 'grok',
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