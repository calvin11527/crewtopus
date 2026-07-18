import { spawn, ChildProcess } from 'child_process';
import type { AgentType } from '../types';
import type { ContextScope } from '../types';
import {
  createCliStreamHandlers,
  type CliStreamContext,
  type SpawnCliOptions,
} from '../modules/cli-stream';
import {
  registerCliProcess,
  deregisterCliProcess,
} from '../modules/cli-process-registry';

export type { SpawnCliOptions };

/** Input passed to an agent adapter. */
export interface AdapterInput {
  prompt: string;
  contextScope: ContextScope;
  config?: Record<string, unknown>;
}

/** Output returned by an agent adapter. */
export interface AdapterOutput {
  content: string;
  tokenCount: number;
  metadata: Record<string, unknown>;
}

/** Contract all agent adapters must implement. */
export interface AgentAdapter {
  readonly type: AgentType;
  execute(input: AdapterInput): Promise<AdapterOutput>;
  isAvailable(): Promise<boolean>;
  shutdown(): void;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const TASK_BOUNDARY = '---AGENTHUB_TASK_BOUNDARY---';
const INJECTION_PATTERN = /^##\s*Task\b/m;

const DEFAULT_MAX_OUTPUT_BYTES =
  Number(process.env.AGENTHUB_CLI_MAX_OUTPUT_BYTES) || 10 * 1024 * 1024;

/** Lightweight token estimator (chars / 4). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Sanitize file content to reduce prompt-injection risk at boundaries. */
function sanitizeFileBlock(content: string): string {
  return content.replace(INJECTION_PATTERN, '## FileContent');
}

/** Format context scope into a prompt prefix. */
export function formatContextForPrompt(scope: ContextScope): string {
  const parts: string[] = [];

  if (scope.files.length > 0) {
    parts.push('## Files\n' + scope.files.map(sanitizeFileBlock).join('\n---\n'));
  }
  if (scope.diffs.length > 0) {
    parts.push('## Diffs\n' + scope.diffs.map(sanitizeFileBlock).join('\n---\n'));
  }
  if (scope.symbols.length > 0) {
    parts.push('## Symbols\n' + scope.symbols.join('\n'));
  }

  return parts.join('\n\n');
}

/** Detect if file content contains prompt-boundary injection patterns. */
export function detectContextInjectionRisk(scope: ContextScope): boolean {
  for (const file of scope.files) {
    if (INJECTION_PATTERN.test(file)) return true;
  }
  return false;
}

/** Read optional CLI stream context from adapter config (set by outbound pipeline). */
export function resolveCliStreamOptions(
  input: AdapterInput,
  agentType: AgentType
): SpawnCliOptions | undefined {
  const stream = input.config?.cliStream as CliStreamContext | undefined;
  const maxOutputBytes = input.config?.maxOutputBytes as number | undefined;
  const base: SpawnCliOptions = {};
  if (typeof maxOutputBytes === 'number') base.maxOutputBytes = maxOutputBytes;

  if (!stream?.workItemId) return Object.keys(base).length > 0 ? base : undefined;

  return {
    ...createCliStreamHandlers({ ...stream, agentType }),
    ...base,
    registry: {
      workItemId: stream.workItemId,
      loopIteration: stream.loopIteration,
      agentType,
    },
  };
}

export interface SpawnCliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  outputTruncated?: boolean;
}

const KILL_GRACE_MS = 3000;

function killProcessTree(proc: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (!proc.pid) return;
  if (process.platform !== 'win32') {
    try {
      process.kill(-proc.pid, signal);
      return;
    } catch {
      /* fall through to direct kill */
    }
  }
  proc.kill(signal);
}

/** Spawn a CLI process and collect stdout. */
export function spawnCli(
  command: string,
  args: string[],
  input?: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  options?: SpawnCliOptions
): Promise<SpawnCliResult> {
  return new Promise((resolve, reject) => {
    const proc: ChildProcess = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let outputTruncated = false;
    let killGraceTimer: ReturnType<typeof setTimeout> | null = null;
    const maxBytes = options?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

    const appendOutput = (target: 'stdout' | 'stderr', text: string) => {
      const current = target === 'stdout' ? stdout : stderr;
      const combined = current.length + text.length;
      if (combined > maxBytes) {
        outputTruncated = true;
        const remaining = maxBytes - current.length;
        if (remaining > 0) {
          const slice = text.slice(0, remaining);
          if (target === 'stdout') stdout += slice;
          else stderr += slice;
        }
        return;
      }
      if (target === 'stdout') stdout += text;
      else stderr += text;
    };

    const releaseProcess = () => {
      if (killGraceTimer) {
        clearTimeout(killGraceTimer);
        killGraceTimer = null;
      }
      proc.stdout?.removeAllListeners('data');
      proc.stderr?.removeAllListeners('data');
      proc.stdout?.destroy();
      proc.stderr?.destroy();
      proc.stdin?.destroy();
      if (proc.pid) deregisterCliProcess(proc.pid);
    };

    const finish = (handler: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      releaseProcess();
      handler();
    };

    if (proc.pid && options?.registry) {
      registerCliProcess({
        workItemId: options.registry.workItemId,
        loopIteration: options.registry.loopIteration,
        pid: proc.pid,
        command,
        agentType: options.registry.agentType,
        startedAt: new Date().toISOString(),
      });
    }

    const timer = setTimeout(() => {
      killProcessTree(proc, 'SIGTERM');
      killGraceTimer = setTimeout(() => killProcessTree(proc, 'SIGKILL'), KILL_GRACE_MS);
      finish(() => reject(new Error(`Process timed out after ${timeoutMs}ms`)));
    }, timeoutMs);

    proc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      appendOutput('stdout', text);
      options?.onStdout?.(text);
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      appendOutput('stderr', text);
      options?.onStderr?.(text);
    });

    proc.on('error', (err) => {
      finish(() => reject(new Error(`Failed to spawn "${command}": ${err.message}`)));
    });

    proc.on('close', (code) => {
      finish(() => {
        resolve({ stdout, stderr, exitCode: code ?? 1, outputTruncated });
      });
    });

    if (input && proc.stdin) {
      proc.stdin.write(input);
      proc.stdin.end();
    }
  });
}

/** Check if a CLI command exists on PATH. */
export async function commandExists(command: string): Promise<boolean> {
  try {
    const checkCmd = process.platform === 'win32' ? 'where' : 'which';
    const result = await spawnCli(checkCmd, [command], undefined, 5000);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/** Strip null bytes so CLI argv/env payloads stay valid. */
export function sanitizeCliText(text: string): string {
  return text.replace(/\0/g, '');
}

/** Build a full prompt with context scope prepended. */
export function buildFullPrompt(input: AdapterInput): string {
  const context = formatContextForPrompt(input.contextScope);
  const prompt = sanitizeCliText(input.prompt);
  if (!context) return prompt;
  return sanitizeCliText(`${context}\n\n${TASK_BOUNDARY}\n${prompt}`);
}