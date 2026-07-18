import fs from 'fs';
import os from 'os';
import path from 'path';

export type ProviderAgentType = 'grok' | 'copilot';

export interface ProviderTokenSnapshot {
  agentType: ProviderAgentType;
  totalTokens: number;
  sessionCount: number;
  source: 'grok_session_signals' | 'copilot_session_shutdown';
  scannedAt: string;
  since?: string;
}

interface GrokSessionSignals {
  contextTokensUsed?: number;
  contextWindowUsage?: number;
  contextWindowTokens?: number;
}

function grokSessionsRoot(): string {
  const home = process.env.GROK_HOME || path.join(os.homedir(), '.grok');
  return path.join(home, 'sessions');
}

/**
 * Scan Grok CLI session signals for activity volume.
 *
 * IMPORTANT: `contextTokensUsed` is the **per-session context window size**, not
 * cumulative monthly billable usage on grok.com. Summing it across sessions will
 * massively over-count vs the dashboard. We still expose a lightweight activity
 * signal (max context + session count) for diagnostics, but budget enforcement
 * must NOT treat this sum as monthly tokens.
 */
export function getGrokProviderTokenUsage(since?: Date): ProviderTokenSnapshot | null {
  const root = grokSessionsRoot();
  if (!fs.existsSync(root)) return null;

  const sinceMs = since?.getTime() ?? 0;
  let maxContextTokens = 0;
  let sessionCount = 0;

  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.name !== 'signals.json') continue;

      try {
        const stat = fs.statSync(full);
        if (sinceMs > 0 && stat.mtimeMs < sinceMs) continue;

        const raw = fs.readFileSync(full, 'utf-8');
        const signals = JSON.parse(raw) as GrokSessionSignals;
        const used = signals.contextTokensUsed;
        if (typeof used === 'number' && used > 0) {
          maxContextTokens = Math.max(maxContextTokens, used);
          sessionCount += 1;
        }
      } catch {
        /* skip corrupt session files */
      }
    }
  };

  walk(root);

  if (sessionCount === 0) return null;

  return {
    agentType: 'grok',
    // Max context size seen (diagnostic only — not monthly billable tokens)
    totalTokens: maxContextTokens,
    sessionCount,
    source: 'grok_session_signals',
    scannedAt: new Date().toISOString(),
    since: since?.toISOString(),
  };
}

interface CopilotTokenDetails {
  input?: { tokenCount?: number };
  cache_read?: { tokenCount?: number };
  cache_write?: { tokenCount?: number };
  output?: { tokenCount?: number };
}

interface CopilotModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

interface CopilotShutdownEvent {
  type?: string;
  timestamp?: string;
  data?: {
    modelMetrics?: Record<string, { usage?: CopilotModelUsage }>;
    tokenDetails?: CopilotTokenDetails;
  };
}

function copilotHomeRoot(): string {
  const home = process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot');
  return path.join(home, 'session-state');
}

function sumCopilotShutdownTokens(data: CopilotShutdownEvent['data']): number {
  if (!data) return 0;

  const modelMetrics = data.modelMetrics;
  if (modelMetrics && Object.keys(modelMetrics).length > 0) {
    let total = 0;
    for (const metrics of Object.values(modelMetrics)) {
      const usage = metrics.usage;
      if (!usage) continue;
      total +=
        (usage.inputTokens ?? 0) +
        (usage.outputTokens ?? 0) +
        (usage.cacheReadTokens ?? 0) +
        (usage.cacheWriteTokens ?? 0);
    }
    if (total > 0) return total;
  }

  const tokenDetails = data.tokenDetails;
  if (!tokenDetails) return 0;

  return (
    (tokenDetails.input?.tokenCount ?? 0) +
    (tokenDetails.cache_read?.tokenCount ?? 0) +
    (tokenDetails.cache_write?.tokenCount ?? 0) +
    (tokenDetails.output?.tokenCount ?? 0)
  );
}

/** Sum tokens from Copilot CLI session.shutdown events (matches copilot /usage far better than audit estimates). */
export function getCopilotProviderTokenUsage(since?: Date): ProviderTokenSnapshot | null {
  const root = copilotHomeRoot();
  if (!fs.existsSync(root)) return null;

  const sinceMs = since?.getTime() ?? 0;
  let totalTokens = 0;
  let sessionCount = 0;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const eventsPath = path.join(root, entry.name, 'events.jsonl');
    if (!fs.existsSync(eventsPath)) continue;

    let sessionTokens = 0;
    let sessionCounted = false;

    try {
      const raw = fs.readFileSync(eventsPath, 'utf-8');
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let event: CopilotShutdownEvent;
        try {
          event = JSON.parse(trimmed) as CopilotShutdownEvent;
        } catch {
          continue;
        }

        if (event.type !== 'session.shutdown') continue;

        if (sinceMs > 0 && event.timestamp) {
          const eventMs = Date.parse(event.timestamp);
          if (!Number.isNaN(eventMs) && eventMs < sinceMs) continue;
        }

        const tokens = sumCopilotShutdownTokens(event.data);
        if (tokens > 0) {
          sessionTokens += tokens;
          sessionCounted = true;
        }
      }
    } catch {
      continue;
    }

    if (sessionCounted && sessionTokens > 0) {
      totalTokens += sessionTokens;
      sessionCount += 1;
    }
  }

  if (sessionCount === 0) return null;

  return {
    agentType: 'copilot',
    totalTokens,
    sessionCount,
    source: 'copilot_session_shutdown',
    scannedAt: new Date().toISOString(),
    since: since?.toISOString(),
  };
}

/** Start of current UTC month — aligns provider scan with typical billing periods. */
export function startOfCurrentMonthUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}