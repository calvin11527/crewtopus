import type { WorkItemActivity, WSMessage, LoopStatus } from '../types';

const MAX_CONSOLE_LINES = 300;

export type ConsoleLogSeverity = 'info' | 'warn' | 'error';

export interface ConsoleLogEntry {
  id: string;
  timestamp: string;
  severity: ConsoleLogSeverity;
  message: string;
  stream?: 'stdout' | 'stderr';
  /** True while a CLI stream chunk has not yet ended with a newline. */
  partial?: boolean;
}

export interface CliStreamState {
  stdoutPartial: string;
  stderrPartial: string;
}

export const INITIAL_CLI_STREAM_STATE: CliStreamState = {
  stdoutPartial: '',
  stderrPartial: '',
};

let entrySeq = 0;

export function createConsoleEntry(
  timestamp: string,
  severity: ConsoleLogSeverity,
  message: string,
  stream?: 'stdout' | 'stderr'
): ConsoleLogEntry {
  entrySeq += 1;
  return {
    id: `log-${timestamp}-${entrySeq}`,
    timestamp,
    severity,
    message,
    stream,
  };
}

/** Compact HH:MM:SS label for console rows. */
export function formatConsoleTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

const SEVERITY_EXPORT_LABEL: Record<ConsoleLogSeverity, string> = {
  info: 'INFO',
  warn: 'WARN',
  error: 'ERR',
};

export type ConsoleSeverityFilter = ConsoleLogSeverity | 'all';
export type ConsoleStreamFilter = 'stdout' | 'stderr' | 'all';

export interface ConsoleFilterOptions {
  severity?: ConsoleSeverityFilter;
  text?: string;
  stream?: ConsoleStreamFilter;
}

/** Filter console entries by severity, stream, and message substring. */
export function filterConsoleEntries(
  entries: ConsoleLogEntry[],
  options: ConsoleFilterOptions = {}
): ConsoleLogEntry[] {
  const severity = options.severity ?? 'all';
  const stream = options.stream ?? 'all';
  const text = options.text?.trim().toLowerCase();

  return entries.filter((entry) => {
    if (severity !== 'all' && entry.severity !== severity) return false;
    if (stream !== 'all' && entry.stream !== stream) return false;
    if (text && !entry.message.toLowerCase().includes(text)) return false;
    return true;
  });
}

/** Format console entries as plain text for clipboard or file export. */
export function formatConsoleExport(entries: ConsoleLogEntry[]): string {
  return entries
    .map(
      (entry) =>
        `[${formatConsoleTimestamp(entry.timestamp)}] ${SEVERITY_EXPORT_LABEL[entry.severity]} ${entry.message}`
    )
    .join('\n');
}

/** Remove ANSI escape codes for compact card previews. */
export function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\r/g, '');
}

export interface AgentConsoleStatus {
  isLive: boolean;
  phase?: string;
  agentType?: string;
  loopIteration?: number;
  maxLoopIterations?: number;
  loopStatus?: LoopStatus;
  lastEventAt?: string;
}

function payloadWorkItemId(payload: Record<string, unknown>): string | null {
  if (typeof payload.workItemId === 'string') return payload.workItemId;
  if (typeof payload.id === 'string') return payload.id;
  const activity = payload.activity;
  if (activity && typeof activity === 'object' && 'workItemId' in activity) {
    return String((activity as { workItemId: string }).workItemId);
  }
  return null;
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString();
}

function phaseLabel(phase: unknown): string {
  return typeof phase === 'string' ? phase : 'step';
}

function agentLabel(agent: unknown): string {
  return typeof agent === 'string' ? agent : 'agent';
}

export function formatWorkItemConsoleEntry(msg: WSMessage): ConsoleLogEntry | null {
  const p = msg.payload;

  switch (msg.type) {
    case 'work_item:pipeline_step': {
      const phase = phaseLabel(p.phase);
      const agent = agentLabel(p.agentType);
      const iter = typeof p.loopIteration === 'number' ? ` iter ${p.loopIteration}` : '';
      const status = String(p.status ?? 'update');
      if (status === 'started') {
        return createConsoleEntry(
          msg.timestamp,
          'info',
          `▶ ${phase}${iter} — ${agent} running...`
        );
      }
      if (status === 'completed') {
        const audit =
          typeof p.auditId === 'string' ? ` (audit ${p.auditId.slice(0, 8)}…)` : '';
        return createConsoleEntry(
          msg.timestamp,
          'info',
          `✓ ${phase}${iter} — ${agent} done${audit}`
        );
      }
      return createConsoleEntry(msg.timestamp, 'info', `${phase}${iter} · ${agent} · ${status}`);
    }
    case 'work_item:loop_update': {
      const iter = p.loopIteration ?? '?';
      const max = p.maxLoopIterations ?? '?';
      const status = String(p.loopStatus ?? 'update');
      const severity: ConsoleLogSeverity =
        status === 'failed' ? 'error' : status === 'escalated' ? 'warn' : 'info';
      return createConsoleEntry(
        msg.timestamp,
        severity,
        `⟳ Loop ${iter}/${max} — ${status}`
      );
    }
    case 'work_item:activity': {
      const activity = p.activity as WorkItemActivity | undefined;
      if (!activity) return null;
      if (activity.metadata?.event === 'shift_standup') return null;
      const phase =
        typeof activity.metadata?.pipelinePhase === 'string'
          ? `${activity.metadata.pipelinePhase} · `
          : '';
      const agent = activity.agentType ? ` (${activity.agentType})` : '';
      const isQueued =
        activity.activityType === 'comment' && activity.metadata?.event === 'agent_queued';
      const severity: ConsoleLogSeverity =
        activity.activityType === 'agent_failed'
          ? 'error'
          : isQueued
            ? 'warn'
            : 'info';
      const prefix =
        activity.activityType === 'agent_started'
          ? '●'
          : activity.activityType === 'agent_completed'
            ? '●'
            : activity.activityType === 'agent_failed'
              ? '●'
              : isQueued
                ? '◷'
                : '●';
      return createConsoleEntry(
        msg.timestamp,
        severity,
        `${prefix} ${phase}${activity.summary}${agent}`
      );
    }
    case 'loop:job': {
      const status = String(p.status ?? 'update');
      const job = typeof p.jobId === 'string' ? p.jobId.slice(0, 8) : 'job';
      if (status === 'running') {
        return createConsoleEntry(msg.timestamp, 'info', `⚡ Queue job ${job} started`);
      }
      if (status === 'completed') {
        const loopStatus = typeof p.loopStatus === 'string' ? ` → ${p.loopStatus}` : '';
        return createConsoleEntry(msg.timestamp, 'info', `✓ Queue job ${job} finished${loopStatus}`);
      }
      if (status === 'failed') {
        const err = typeof p.error === 'string' ? `: ${p.error}` : '';
        return createConsoleEntry(msg.timestamp, 'error', `✗ Queue job ${job} failed${err}`);
      }
      return createConsoleEntry(msg.timestamp, 'info', `job ${job} · ${status}`);
    }
    case 'work_item:update': {
      if (p.deleted) return null;
      const key = typeof p.key === 'string' ? p.key : 'item';
      const status = typeof p.status === 'string' ? p.status : 'updated';
      return createConsoleEntry(msg.timestamp, 'info', `◆ ${key} moved to ${status}`);
    }
    case 'work_item:cli_output':
      return null;
    default:
      return null;
  }
}

/** Turn a raw CLI output WebSocket chunk into structured log entries (no coalescing). */
export function formatCliOutputEntries(msg: WSMessage): ConsoleLogEntry[] {
  const { entries } = integrateCliOutput([], msg, INITIAL_CLI_STREAM_STATE);
  return entries;
}

function coalesceCliEntry(
  entries: ConsoleLogEntry[],
  timestamp: string,
  severity: ConsoleLogSeverity,
  message: string,
  stream: 'stdout' | 'stderr',
  partial: boolean
): ConsoleLogEntry[] {
  const last = entries[entries.length - 1];
  if (last?.partial && last.stream === stream) {
    return [
      ...entries.slice(0, -1),
      { ...last, message, timestamp, partial },
    ];
  }
  const entry = createConsoleEntry(timestamp, severity, message, stream);
  return [...entries, { ...entry, partial }];
}

/**
 * Append CLI WebSocket chunks to the console, coalescing partial lines per stream
 * so token-by-token agent output updates in place instead of fragmenting.
 */
export function integrateCliOutput(
  entries: ConsoleLogEntry[],
  msg: WSMessage,
  state: CliStreamState
): { entries: ConsoleLogEntry[]; state: CliStreamState } {
  if (msg.type !== 'work_item:cli_output') {
    return { entries, state };
  }

  const chunk = typeof msg.payload.chunk === 'string' ? msg.payload.chunk : '';
  if (!chunk) return { entries, state };

  const stream = msg.payload.stream === 'stderr' ? 'stderr' : 'stdout';
  const severity: ConsoleLogSeverity = stream === 'stderr' ? 'error' : 'info';
  const tag = stream === 'stderr' ? '[stderr] ' : '';
  const partialKey = stream === 'stderr' ? 'stderrPartial' : 'stdoutPartial';

  const combined = state[partialKey] + chunk;
  const normalized = combined.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const parts = normalized.split('\n');
  const endsWithNewline = normalized.endsWith('\n');
  const remainder = endsWithNewline ? '' : (parts.pop() ?? '');

  let nextEntries = entries;
  for (const part of parts) {
    const cleaned = stripAnsi(part);
    if (!cleaned) continue;
    nextEntries = coalesceCliEntry(
      nextEntries,
      msg.timestamp,
      severity,
      `${tag}${cleaned}`,
      stream,
      false
    );
  }

  const cleanedRemainder = stripAnsi(remainder);
  if (cleanedRemainder) {
    nextEntries = coalesceCliEntry(
      nextEntries,
      msg.timestamp,
      severity,
      `${tag}${cleanedRemainder}`,
      stream,
      true
    );
  } else if (remainder && nextEntries.length > 0) {
    const last = nextEntries[nextEntries.length - 1];
    if (last.partial && last.stream === stream) {
      nextEntries = [...nextEntries.slice(0, -1), { ...last, partial: false }];
    }
  }

  return {
    entries: nextEntries.slice(-MAX_CONSOLE_LINES),
    state: { ...state, [partialKey]: remainder },
  };
}

export function consoleWelcomeEntry(key: string, loopStatus: LoopStatus): ConsoleLogEntry {
  const ts = new Date().toISOString();
  return createConsoleEntry(
    ts,
    'info',
    `AgentHub agent console — ${key} · ${loopStatus}. Live CLI output and pipeline events appear below.`
  );
}

export function seedConsoleEntriesFromActivity(activity: WorkItemActivity[]): ConsoleLogEntry[] {
  const ordered = [...activity].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  const entries: ConsoleLogEntry[] = [];
  for (const row of ordered) {
    if (row.metadata?.event === 'shift_standup') continue;
    const msg: WSMessage = {
      type: 'work_item:activity',
      payload: { workItemId: row.workItemId, activity: row },
      timestamp: row.createdAt,
    };
    const entry = formatWorkItemConsoleEntry(msg);
    if (entry) entries.push(entry);
  }
  return entries.slice(-MAX_CONSOLE_LINES);
}

export function appendConsoleEntry(entries: ConsoleLogEntry[], entry: ConsoleLogEntry): ConsoleLogEntry[] {
  return [...entries, entry].slice(-MAX_CONSOLE_LINES);
}

export function appendConsoleEntries(
  entries: ConsoleLogEntry[],
  newEntries: ConsoleLogEntry[]
): ConsoleLogEntry[] {
  if (newEntries.length === 0) return entries;
  return [...entries, ...newEntries].slice(-MAX_CONSOLE_LINES);
}

export function formatWorkItemConsoleLine(msg: WSMessage): string | null {
  const p = msg.payload;
  const ts = timeLabel(msg.timestamp);

  switch (msg.type) {
    case 'work_item:pipeline_step': {
      const phase = phaseLabel(p.phase);
      const agent = agentLabel(p.agentType);
      const iter = typeof p.loopIteration === 'number' ? ` iter ${p.loopIteration}` : '';
      const status = String(p.status ?? 'update');
      if (status === 'started') {
        return `\x1b[90m[${ts}]\x1b[0m \x1b[36m▶\x1b[0m \x1b[1m${phase}\x1b[0m${iter} — \x1b[33m${agent}\x1b[0m running...`;
      }
      if (status === 'completed') {
        const audit =
          typeof p.auditId === 'string' ? ` \x1b[90m(audit ${p.auditId.slice(0, 8)}…)\x1b[0m` : '';
        return `\x1b[90m[${ts}]\x1b[0m \x1b[32m✓\x1b[0m \x1b[1m${phase}\x1b[0m${iter} — \x1b[33m${agent}\x1b[0m done${audit}`;
      }
      return `\x1b[90m[${ts}]\x1b[0m ${phase}${iter} · ${agent} · ${status}`;
    }
    case 'work_item:loop_update': {
      const iter = p.loopIteration ?? '?';
      const max = p.maxLoopIterations ?? '?';
      const status = String(p.loopStatus ?? 'update');
      const color =
        status === 'running' ? '\x1b[33m' : status === 'approved' ? '\x1b[32m' : status === 'escalated' ? '\x1b[35m' : '\x1b[36m';
      return `\x1b[90m[${ts}]\x1b[0m \x1b[35m⟳\x1b[0m Loop ${iter}/${max} — ${color}${status}\x1b[0m`;
    }
    case 'work_item:activity': {
      const activity = p.activity as WorkItemActivity | undefined;
      if (!activity) return null;
      if (activity.metadata?.event === 'shift_standup') return null;
      const phase =
        typeof activity.metadata?.pipelinePhase === 'string'
          ? ` \x1b[36m${activity.metadata.pipelinePhase}\x1b[0m ·`
          : '';
      const agent = activity.agentType ? ` \x1b[33m${activity.agentType}\x1b[0m` : '';
      const isQueued =
        activity.activityType === 'comment' && activity.metadata?.event === 'agent_queued';
      const icon =
        activity.activityType === 'agent_started'
          ? '\x1b[36m●\x1b[0m'
          : activity.activityType === 'agent_completed'
            ? '\x1b[32m●\x1b[0m'
            : activity.activityType === 'agent_failed'
              ? '\x1b[31m●\x1b[0m'
              : isQueued
                ? '\x1b[33m◷\x1b[0m'
                : '\x1b[90m●\x1b[0m';
      return `\x1b[90m[${ts}]\x1b[0m ${icon}${phase} ${activity.summary}${agent}`;
    }
    case 'loop:job': {
      const status = String(p.status ?? 'update');
      const job = typeof p.jobId === 'string' ? p.jobId.slice(0, 8) : 'job';
      if (status === 'running') {
        return `\x1b[90m[${ts}]\x1b[0m \x1b[36m⚡\x1b[0m Queue job \x1b[1m${job}\x1b[0m started`;
      }
      if (status === 'completed') {
        const loopStatus = typeof p.loopStatus === 'string' ? ` → ${p.loopStatus}` : '';
        return `\x1b[90m[${ts}]\x1b[0m \x1b[32m✓\x1b[0m Queue job \x1b[1m${job}\x1b[0m finished${loopStatus}`;
      }
      if (status === 'failed') {
        const err = typeof p.error === 'string' ? `: ${p.error}` : '';
        return `\x1b[90m[${ts}]\x1b[0m \x1b[31m✗\x1b[0m Queue job \x1b[1m${job}\x1b[0m failed${err}`;
      }
      return `\x1b[90m[${ts}]\x1b[0m job ${job} · ${status}`;
    }
    case 'work_item:update': {
      if (p.deleted) return null;
      const key = typeof p.key === 'string' ? p.key : 'item';
      const status = typeof p.status === 'string' ? p.status : 'updated';
      return `\x1b[90m[${ts}]\x1b[0m \x1b[90m◆\x1b[0m ${key} moved to \x1b[1m${status}\x1b[0m`;
    }
    case 'work_item:cli_output':
      return null;
    default:
      return null;
  }
}

/** Turn a raw CLI output WebSocket chunk into terminal lines. */
export function formatCliOutputLines(msg: WSMessage): string[] {
  if (msg.type !== 'work_item:cli_output') return [];

  const chunk = typeof msg.payload.chunk === 'string' ? msg.payload.chunk : '';
  if (!chunk) return [];

  const stream = msg.payload.stream === 'stderr' ? 'stderr' : 'stdout';
  const style = stream === 'stderr' ? '\x1b[31m' : '\x1b[37m';
  const tag = stream === 'stderr' ? '[stderr] ' : '';

  const normalized = chunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const parts = normalized.split('\n');

  if (parts.length === 1) {
    return [`${style}${tag}${parts[0]}\x1b[0m`];
  }

  const lines: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i === parts.length - 1 && !normalized.endsWith('\n')) {
      if (part) lines.push(`${style}${tag}${part}\x1b[0m`);
      break;
    }
    lines.push(`${style}${tag}${part}\x1b[0m`);
  }
  return lines;
}

export function deriveConsoleStatus(
  workItemId: string | null,
  loopStatus: LoopStatus | undefined,
  workItemStatus: string | undefined,
  _entries: ConsoleLogEntry[],
  lastWsAt: string | null
): AgentConsoleStatus {
  const recentlyActive =
    lastWsAt != null && Date.now() - new Date(lastWsAt).getTime() < 30_000;
  const isLive =
    loopStatus === 'running' || workItemStatus === 'in_progress' || recentlyActive;

  return {
    isLive,
    loopStatus,
    lastEventAt: lastWsAt ?? undefined,
  };
}

export function updateStatusFromMessage(
  status: AgentConsoleStatus,
  msg: WSMessage
): AgentConsoleStatus {
  const p = msg.payload;
  const next: AgentConsoleStatus = {
    ...status,
    lastEventAt: msg.timestamp,
    isLive: true,
  };

  if (msg.type === 'work_item:loop_update') {
    if (typeof p.loopIteration === 'number') next.loopIteration = p.loopIteration;
    if (typeof p.maxLoopIterations === 'number') next.maxLoopIterations = p.maxLoopIterations;
    if (typeof p.loopStatus === 'string') next.loopStatus = p.loopStatus as LoopStatus;
  }

  if (msg.type === 'work_item:pipeline_step') {
    if (typeof p.phase === 'string') next.phase = p.phase;
    if (typeof p.agentType === 'string') next.agentType = p.agentType;
    if (typeof p.loopIteration === 'number') next.loopIteration = p.loopIteration;
    if (p.status === 'started') next.isLive = true;
  }

  if (msg.type === 'work_item:activity') {
    const activity = p.activity as WorkItemActivity | undefined;
    if (activity?.agentType) next.agentType = activity.agentType;
    if (typeof activity?.metadata?.pipelinePhase === 'string') {
      next.phase = activity.metadata.pipelinePhase;
    }
    if (typeof activity?.metadata?.loopIteration === 'number') {
      next.loopIteration = activity.metadata.loopIteration;
    }
  }

  return next;
}

export function seedConsoleFromActivity(activity: WorkItemActivity[]): string[] {
  const ordered = [...activity].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  const lines: string[] = [];
  for (const entry of ordered) {
    if (entry.metadata?.event === 'shift_standup') continue;
    const msg: WSMessage = {
      type: 'work_item:activity',
      payload: { workItemId: entry.workItemId, activity: entry },
      timestamp: entry.createdAt,
    };
    const line = formatWorkItemConsoleLine(msg);
    if (line) lines.push(line);
  }
  return lines.slice(-MAX_CONSOLE_LINES);
}

export function matchesWorkItemConsole(msg: WSMessage, workItemId: string): boolean {
  const id = payloadWorkItemId(msg.payload);
  return id === workItemId;
}

export function appendConsoleLine(lines: string[], line: string): string[] {
  return [...lines, line].slice(-MAX_CONSOLE_LINES);
}

export function appendConsoleLines(lines: string[], newLines: string[]): string[] {
  if (newLines.length === 0) return lines;
  return [...lines, ...newLines].slice(-MAX_CONSOLE_LINES);
}

export function consoleWelcomeLine(key: string, loopStatus: LoopStatus): string {
  const statusColor =
    loopStatus === 'running'
      ? '\x1b[33m'
      : loopStatus === 'approved'
        ? '\x1b[32m'
        : '\x1b[36m';
  return (
    `\x1b[1mAgentHub\x1b[0m agent console — \x1b[1m${key}\x1b[0m · ${statusColor}${loopStatus}\x1b[0m\r\n` +
    '\x1b[90mLive CLI output (Grok thoughts/tools when streaming) and pipeline events appear here.\x1b[0m\r\n'
  );
}