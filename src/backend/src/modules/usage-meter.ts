/**
 * Real-time-ish usage metering for Crewtopus.
 *
 * Providers rarely expose live billing APIs for CLI subscriptions. We combine:
 * 1) AgentHub audit tokens after every run (immediate)
 * 2) Debounced local provider session scans (Copilot/Grok CLI files)
 * 3) Throttle signals from rate-limit / quota errors
 * 4) Optional user dashboard % calibration (existing)
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { broadcast } from '../websocket';
import { now } from '../utils/helpers';
import type { AgentType } from '../types';
import {
  getCopilotProviderTokenUsage,
  getGrokProviderTokenUsage,
  startOfCurrentMonthUtc,
} from './provider-usage';

export type TokenSource = 'estimate' | 'adapter' | 'provider_session' | 'audit' | 'none';
export type ThrottleState = 'ok' | 'throttled' | 'quota_exceeded';

export interface UsageThrottleSignal {
  agentType: AgentType;
  state: ThrottleState;
  message: string;
  at: string;
}

export interface UsageSyncSnapshot {
  syncedAt: string;
  providerScannedAt?: string;
  grokSessions?: number;
  copilotSessions?: number;
  throttles: Partial<Record<AgentType, UsageThrottleSignal>>;
}

const throttleByType = new Map<AgentType, UsageThrottleSignal>();
let lastSyncedAt = now();
let lastProviderScanAt: string | undefined;
let debouncedScanTimer: ReturnType<typeof setTimeout> | null = null;
let watcherStarted = false;

const THROTTLE_TTL_MS = 15 * 60 * 1000; // soft signal lasts 15m unless cleared by success

const RATE_LIMIT_RE =
  /rate\s*limit|too many requests|\b429\b|quota|over budget|usage limit|limit exceeded|throttl|capacity|spend limit/i;

export function isProviderThrottleError(message: string): boolean {
  return RATE_LIMIT_RE.test(message);
}

export function classifyThrottle(message: string): ThrottleState {
  if (/quota|over budget|usage limit|spend limit/i.test(message)) return 'quota_exceeded';
  return 'throttled';
}

export function recordProviderThrottle(agentType: AgentType, message: string): void {
  const signal: UsageThrottleSignal = {
    agentType,
    state: classifyThrottle(message),
    message: message.slice(0, 500),
    at: now(),
  };
  throttleByType.set(agentType, signal);
  lastSyncedAt = signal.at;
  broadcastUsageUpdate(agentType, 'throttle');
}

export function clearProviderThrottle(agentType: AgentType): void {
  if (!throttleByType.has(agentType)) return;
  throttleByType.delete(agentType);
  lastSyncedAt = now();
  broadcastUsageUpdate(agentType, 'throttle_clear');
}

export function getThrottleSignal(agentType: AgentType): UsageThrottleSignal | undefined {
  const signal = throttleByType.get(agentType);
  if (!signal) return undefined;
  if (Date.now() - Date.parse(signal.at) > THROTTLE_TTL_MS) {
    throttleByType.delete(agentType);
    return undefined;
  }
  return signal;
}

export function getAllThrottleSignals(): Partial<Record<AgentType, UsageThrottleSignal>> {
  const out: Partial<Record<AgentType, UsageThrottleSignal>> = {};
  for (const type of [...throttleByType.keys()]) {
    const s = getThrottleSignal(type);
    if (s) out[type] = s;
  }
  return out;
}

/** Call after every outbound run that produced an audit entry. */
export function recordRunUsage(input: {
  agentType: AgentType;
  agentId?: string;
  tokenCount: number;
  cost?: number;
  tokenSource?: TokenSource;
  success: boolean;
  errorMessage?: string;
}): void {
  lastSyncedAt = now();

  if (!input.success && input.errorMessage && isProviderThrottleError(input.errorMessage)) {
    recordProviderThrottle(input.agentType, input.errorMessage);
  } else if (input.success) {
    clearProviderThrottle(input.agentType);
  }

  scheduleProviderRescan(input.agentType);
  broadcastUsageUpdate(input.agentType, 'run', {
    tokenCount: input.tokenCount,
    tokenSource: input.tokenSource ?? 'audit',
    agentId: input.agentId,
    success: input.success,
  });
}

function broadcastUsageUpdate(
  agentType: AgentType,
  reason: string,
  extra: Record<string, unknown> = {}
): void {
  broadcast({
    type: 'usage:update',
    payload: {
      agentType,
      reason,
      syncedAt: lastSyncedAt,
      throttle: getThrottleSignal(agentType) ?? null,
      ...extra,
    },
    timestamp: lastSyncedAt,
  });
}

/** Debounce filesystem provider scans (expensive on large session trees). */
export function scheduleProviderRescan(agentType?: AgentType): void {
  if (debouncedScanTimer) clearTimeout(debouncedScanTimer);
  debouncedScanTimer = setTimeout(() => {
    debouncedScanTimer = null;
    forceProviderRescan(agentType);
  }, 1200);
}

/** Immediate provider session rescan; returns diagnostic snapshot. */
export function forceProviderRescan(agentType?: AgentType): UsageSyncSnapshot {
  const monthStart = startOfCurrentMonthUtc();
  let grokSessions: number | undefined;
  let copilotSessions: number | undefined;

  if (!agentType || agentType === 'grok') {
    const snap = getGrokProviderTokenUsage(monthStart);
    grokSessions = snap?.sessionCount;
  }
  if (!agentType || agentType === 'copilot') {
    const snap = getCopilotProviderTokenUsage(monthStart);
    copilotSessions = snap?.sessionCount;
  }

  lastProviderScanAt = now();
  lastSyncedAt = lastProviderScanAt;

  const snapshot: UsageSyncSnapshot = {
    syncedAt: lastSyncedAt,
    providerScannedAt: lastProviderScanAt,
    grokSessions,
    copilotSessions,
    throttles: getAllThrottleSignals(),
  };

  broadcast({
    type: 'usage:update',
    payload: {
      agentType: agentType ?? 'all',
      reason: 'provider_scan',
      ...snapshot,
    },
    timestamp: lastSyncedAt,
  });

  return snapshot;
}

export function getUsageSyncMeta(): {
  syncedAt: string;
  providerScannedAt?: string;
  throttles: Partial<Record<AgentType, UsageThrottleSignal>>;
} {
  return {
    syncedAt: lastSyncedAt,
    providerScannedAt: lastProviderScanAt,
    throttles: getAllThrottleSignals(),
  };
}

/**
 * Optional watcher for outside-Crewtopus CLI usage on the same machine.
 * Enable with AGENTHUB_WATCH_PROVIDER_USAGE=true
 */
export function startProviderUsageWatcher(): void {
  if (watcherStarted) return;
  if (process.env.AGENTHUB_WATCH_PROVIDER_USAGE !== 'true') return;
  watcherStarted = true;

  const roots = [
    path.join(process.env.GROK_HOME || path.join(os.homedir(), '.grok'), 'sessions'),
    path.join(process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot'), 'session-state'),
  ];

  for (const root of roots) {
    try {
      if (!fs.existsSync(root)) continue;
      fs.watch(root, { recursive: true }, () => {
        scheduleProviderRescan();
      });
    } catch {
      /* watch is best-effort */
    }
  }
}

export function stopProviderUsageWatcherForTests(): void {
  if (debouncedScanTimer) {
    clearTimeout(debouncedScanTimer);
    debouncedScanTimer = null;
  }
  throttleByType.clear();
  watcherStarted = false;
}
