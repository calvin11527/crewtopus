import { getDatabase } from '../database';
import { getAgent, listAgents, updateAgentConfig } from './agent-registry';
import {
  getCopilotProviderTokenUsage,
  getGrokProviderTokenUsage,
  startOfCurrentMonthUtc,
  type ProviderTokenSnapshot,
} from './provider-usage';
import { getThrottleSignal, getUsageSyncMeta } from './usage-meter';
import { now } from '../utils/helpers';
import type { Agent, AgentCreditUsage, AgentType, UsageTrackingSource } from '../types';

/** Default internal cost budget per agent type (1 credit ≈ $0.01 estimated). Not provider quota. */
const DEFAULT_CREDIT_LIMITS: Record<AgentType, number> = {
  claude: 10_000,
  grok: 5_000,
  copilot: 5_000,
  antigravity: 5_000,
  ollama: 0,
  mock: 1_000,
};

const DEFAULT_MONTHLY_TOKEN_QUOTA: Partial<Record<AgentType, number>> = {
  grok: Number(process.env.AGENTHUB_GROK_MONTHLY_TOKEN_QUOTA) || undefined,
  claude: Number(process.env.AGENTHUB_CLAUDE_MONTHLY_TOKEN_QUOTA) || undefined,
  copilot: Number(process.env.AGENTHUB_COPILOT_MONTHLY_TOKEN_QUOTA) || undefined,
};

interface UsageTotals {
  credits_used: number;
  token_count: number;
  request_count: number;
}

function resolveCreditLimit(config: Record<string, unknown>, type: AgentType): number {
  const configured = config.creditLimit;
  if (typeof configured === 'number' && configured >= 0) return configured;
  return DEFAULT_CREDIT_LIMITS[type] ?? 5_000;
}

function resolveMonthlyTokenQuota(config: Record<string, unknown>, type: AgentType): number | undefined {
  const configured = config.monthlyTokenQuota;
  if (typeof configured === 'number' && configured > 0) return configured;
  const envDefault = DEFAULT_MONTHLY_TOKEN_QUOTA[type];
  return envDefault && envDefault > 0 ? envDefault : undefined;
}

/** Convert audit cost (USD) to integer credits (cents). */
function costToCredits(costUsd: number): number {
  return Math.round(costUsd * 100);
}

function percentageUsed(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.round((used / limit) * 1000) / 10;
}

function pickPrimaryAgent(group: Agent[]): Agent {
  return [...group].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
}

function refreshAgentGroup(group: Agent[]): Agent[] {
  return group.map((agent) => getAgent(agent.id) ?? agent);
}

function resolveTypeCreditLimit(group: Agent[], type: AgentType): number {
  for (const agent of group) {
    const configured = agent.config.creditLimit;
    if (typeof configured === 'number' && configured >= 0) return configured;
  }
  return DEFAULT_CREDIT_LIMITS[type] ?? 5_000;
}

function resolveTypeMonthlyTokenQuota(group: Agent[], type: AgentType): number | undefined {
  for (const agent of group) {
    const configured = agent.config.monthlyTokenQuota;
    if (typeof configured === 'number' && configured > 0) return configured;
  }
  return DEFAULT_MONTHLY_TOKEN_QUOTA[type];
}

function readProviderSnapshot(type: AgentType, monthStart: Date): ProviderTokenSnapshot | null {
  if (type === 'grok') return getGrokProviderTokenUsage(monthStart);
  if (type === 'copilot') return getCopilotProviderTokenUsage(monthStart);
  return null;
}

/** Fixed monthly quota from a one-time dashboard calibration (never rescale with live tokens). */
function resolveCalibratedMonthlyQuota(group: Agent[]): number | undefined {
  for (const agent of group) {
    const percent = agent.config.providerUsagePercent;
    const calibrationTokens = agent.config.providerCalibrationTokens;
    if (
      typeof percent === 'number' &&
      percent > 0 &&
      percent <= 100 &&
      typeof calibrationTokens === 'number' &&
      calibrationTokens > 0
    ) {
      return Math.round(calibrationTokens / (percent / 100));
    }
  }
  return undefined;
}

function resolveEffectiveMonthlyQuota(group: Agent[], type: AgentType): number | undefined {
  return resolveTypeMonthlyTokenQuota(group, type) ?? resolveCalibratedMonthlyQuota(group);
}

/** Sum AgentHub audit tokens for an agent type (optionally since a date). */
export function sumAuditTokensForAgentType(agentType: AgentType, since?: Date): number {
  const db = getDatabase();
  if (since) {
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(token_count), 0) AS token_count
         FROM audit_log
         WHERE agent_type = ? AND timestamp >= ?`
      )
      .get(agentType, since.toISOString()) as { token_count: number };
    return row.token_count ?? 0;
  }
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(token_count), 0) AS token_count
       FROM audit_log
       WHERE agent_type = ?`
    )
    .get(agentType) as { token_count: number };
  return row.token_count ?? 0;
}

export interface ProviderUsageSyncOptions {
  /** SuperGrok overall weekly % (e.g. 61). */
  dashboardPercent: number;
  /** weekly SuperGrok (default for Grok) or monthly token quota model. */
  period?: 'weekly' | 'monthly';
  /** When SuperGrok limit resets (ISO or parseable datetime). */
  resetAt?: string | null;
  /** SuperGrok bucket breakdown: Build + Conversation. */
  breakdown?: { build?: number; conversation?: number } | null;
  /**
   * dashboard_primary (default Grok): UI % = dashboard until next sync.
   * token_quota (legacy): derive monthlyTokenQuota from audit tokens / %.
   */
  mode?: 'dashboard_primary' | 'token_quota';
}

/**
 * Sync provider dashboard usage into agent config.
 *
 * SuperGrok (Grok default): weekly shared limit with Build + Conversation buckets.
 * There is no public live API — user pastes values from grok.com. That % is the
 * source of truth until the next sync (audit tokens are secondary diagnostics).
 *
 * Copilot / legacy token_quota: still derive monthlyTokenQuota from local signals.
 */
export function calibrateAgentProviderUsage(
  agentId: string,
  dashboardPercent: number,
  options: Omit<ProviderUsageSyncOptions, 'dashboardPercent'> = {}
): Agent | null {
  const agent = getAgent(agentId);
  if (!agent) return null;
  if (dashboardPercent < 0 || dashboardPercent > 100) {
    throw new Error('providerUsagePercent must be between 0 and 100');
  }

  const mode =
    options.mode ??
    (agent.type === 'grok' ? 'dashboard_primary' : 'token_quota');
  const period =
    options.period ?? (agent.type === 'grok' && mode === 'dashboard_primary' ? 'weekly' : 'monthly');

  let resetAt: string | undefined;
  if (options.resetAt) {
    const parsed = Date.parse(options.resetAt);
    if (Number.isNaN(parsed)) {
      throw new Error('providerResetAt must be a valid date/time');
    }
    resetAt = new Date(parsed).toISOString();
  }

  const breakdown = options.breakdown
    ? {
        build:
          typeof options.breakdown.build === 'number' ? options.breakdown.build : undefined,
        conversation:
          typeof options.breakdown.conversation === 'number'
            ? options.breakdown.conversation
            : undefined,
      }
    : undefined;

  if (mode === 'dashboard_primary') {
    // Dashboard is truth — do not invent monthly token quotas that drift to 100%+.
    return updateAgentConfig(agentId, {
      providerUsagePercent: dashboardPercent,
      providerUsagePeriod: period,
      providerUsageMode: 'dashboard_primary',
      providerPlan: agent.type === 'grok' ? 'supergrok' : agent.config.providerPlan,
      providerResetAt: resetAt ?? null,
      providerBreakdown: breakdown ?? null,
      providerCalibratedAt: now(),
      // Clear legacy token quota so audit growth cannot false-trigger over-budget.
      monthlyTokenQuota: null,
      providerCalibrationTokens: null,
      providerCalibrationSource: 'dashboard',
    });
  }

  const monthStart = startOfCurrentMonthUtc();
  let calibrationTokens = 0;
  let calibrationSource: 'agenthub_audit' | 'provider' = 'provider';

  if (agent.type === 'grok') {
    calibrationTokens = sumAuditTokensForAgentType('grok', monthStart);
    calibrationSource = 'agenthub_audit';
    if (calibrationTokens <= 0) {
      calibrationTokens = sumAuditTokensForAgentType('grok');
    }
  } else {
    const snapshot = readProviderSnapshot(agent.type, monthStart);
    calibrationTokens = snapshot?.totalTokens ?? 0;
  }

  if ((!calibrationTokens || calibrationTokens <= 0) && dashboardPercent > 0) {
    throw new Error(
      agent.type === 'grok'
        ? 'No AgentHub Grok audit tokens found this period. Use SuperGrok dashboard sync (default) or run a Grok task first for token_quota mode.'
        : `No provider CLI session tokens found for ${agent.type}. Run the CLI at least once this month before calibrating.`
    );
  }

  const monthlyTokenQuota =
    dashboardPercent > 0
      ? Math.round(calibrationTokens / (dashboardPercent / 100))
      : undefined;

  return updateAgentConfig(agentId, {
    providerUsagePercent: dashboardPercent,
    providerUsagePeriod: period,
    providerUsageMode: 'token_quota',
    providerCalibrationTokens: calibrationTokens,
    providerCalibrationSource: calibrationSource,
    monthlyTokenQuota: monthlyTokenQuota ?? null,
    providerResetAt: resetAt ?? null,
    providerBreakdown: breakdown ?? null,
    providerCalibratedAt: now(),
  });
}

function ensureLegacyProviderCalibration(group: Agent[], type: AgentType): void {
  const primary = pickPrimaryAgent(group);
  // SuperGrok dashboard sync is complete — never rewrite it with token_quota math.
  if (
    primary.config.providerUsageMode === 'dashboard_primary' ||
    primary.config.providerCalibrationSource === 'dashboard'
  ) {
    return;
  }
  const percent = primary.config.providerUsagePercent;
  if (typeof percent !== 'number' || percent <= 0 || percent > 100) return;
  if (typeof primary.config.providerCalibrationTokens === 'number') return;
  if (typeof primary.config.monthlyTokenQuota === 'number' && primary.config.monthlyTokenQuota > 0) return;

  try {
    // Legacy path only: old configs that had % without a derived quota.
    calibrateAgentProviderUsage(primary.id, percent, {
      mode: type === 'grok' ? 'token_quota' : 'token_quota',
    });
  } catch {
    /* best-effort migration for legacy configs */
  }
}

function buildTracking(
  type: AgentType,
  auditTokens: number,
  auditRequests: number,
  providerTokens?: number,
  providerSessions?: number,
  monthlyQuota?: number,
  dashboardPercent?: number,
  usageMode?: string,
  usagePeriod?: string,
  resetAt?: string,
  breakdown?: { build?: number; conversation?: number }
): Pick<
  AgentCreditUsage,
  | 'percentageUsed'
  | 'overBudget'
  | 'trackingSource'
  | 'trackingNote'
  | 'providerTokenCount'
  | 'providerSessionCount'
  | 'monthlyTokenQuota'
  | 'usagePeriod'
  | 'providerResetAt'
  | 'superGrokBreakdown'
> {
  const providerTokenCount = providerTokens && providerTokens > 0 ? providerTokens : undefined;
  const providerSessionCount = providerSessions && providerSessions > 0 ? providerSessions : undefined;
  const monthlyTokenQuota = monthlyQuota;
  const period = (usagePeriod === 'weekly' || usagePeriod === 'monthly' ? usagePeriod : undefined) as
    | 'weekly'
    | 'monthly'
    | undefined;

  // SuperGrok / dashboard-primary: website % is truth (weekly Build+Conversation pool).
  if (
    type === 'grok' &&
    (usageMode === 'dashboard_primary' ||
      (typeof dashboardPercent === 'number' &&
        dashboardPercent >= 0 &&
        dashboardPercent <= 100 &&
        usageMode !== 'token_quota'))
  ) {
    if (typeof dashboardPercent === 'number' && dashboardPercent >= 0 && dashboardPercent <= 100) {
      const parts: string[] = [];
      if (breakdown?.build != null) parts.push(`Build ${breakdown.build}%`);
      if (breakdown?.conversation != null) parts.push(`Conversation ${breakdown.conversation}%`);
      const resetNote = resetAt
        ? ` Resets ${new Date(resetAt).toLocaleString()}.`
        : ' Set reset time when you sync from SuperGrok.';
      return {
        percentageUsed: dashboardPercent,
        overBudget: dashboardPercent >= 100,
        trackingSource: 'dashboard_primary',
        trackingNote:
          `SuperGrok weekly limit from last dashboard sync (${dashboardPercent}%)` +
          (parts.length ? ` · ${parts.join(' · ')}` : '') +
          `.${resetNote} ` +
          `Crewtopus cannot read grok.com live — re-sync after you use Grok (site or CLI). ` +
          (auditRequests > 0
            ? `Local Crewtopus runs this month: ${auditRequests} · ~${auditTokens.toLocaleString()} estimated tokens (not SuperGrok %).`
            : 'No Crewtopus Grok runs logged yet this month.'),
        providerTokenCount,
        providerSessionCount,
        monthlyTokenQuota: undefined,
        usagePeriod: period ?? 'weekly',
        providerResetAt: resetAt,
        superGrokBreakdown: breakdown,
      };
    }
  }

  let trackingSource: UsageTrackingSource = 'none';
  let tokensForPercent = 0;
  let trackingNote: string | undefined;

  if (type === 'grok') {
    if (auditTokens > 0 || monthlyTokenQuota) {
      trackingSource = 'agenthub_audit';
      tokensForPercent = auditTokens;
      trackingNote =
        'Legacy token-quota mode. Prefer SuperGrok dashboard sync (weekly %) for true plan limits.';
    }
  } else if (providerTokenCount) {
    trackingSource = 'provider';
    tokensForPercent = providerTokenCount;
    if (auditTokens > 0 && providerTokenCount > auditTokens * 1.2) {
      trackingNote =
        `Provider CLI sessions report ${providerTokenCount.toLocaleString()} tokens this period; ` +
        `AgentHub audit logged ${auditTokens.toLocaleString()} across ${auditRequests} run(s).`;
    }
  } else if (auditTokens > 0) {
    trackingSource = 'agenthub_audit';
    tokensForPercent = auditTokens;
    trackingNote =
      'Based on AgentHub audit estimates only (prompt + response). Direct CLI usage outside AgentHub is not included.';
  }

  if (!monthlyTokenQuota) {
    if (typeof dashboardPercent === 'number' && dashboardPercent >= 0 && dashboardPercent <= 100) {
      return {
        percentageUsed: dashboardPercent,
        overBudget: dashboardPercent >= 100,
        trackingSource: 'dashboard_primary',
        trackingNote:
          trackingNote ??
          `Showing last synced dashboard usage (${dashboardPercent}%). Re-sync from the provider site after more usage.`,
        providerTokenCount,
        providerSessionCount,
        monthlyTokenQuota,
        usagePeriod: period,
        providerResetAt: resetAt,
        superGrokBreakdown: breakdown,
      };
    }
    return {
      percentageUsed: 0,
      overBudget: false,
      trackingSource,
      trackingNote:
        trackingNote ??
        (type === 'grok'
          ? 'Sync SuperGrok weekly % from grok.com (e.g. 61% with Build 59% + Conversation 2%). That is the real plan limit — not monthly audit tokens.'
          : type === 'copilot'
            ? 'Sync with the Copilot dashboard by setting providerUsagePercent to calibrate monthly quota.'
            : 'Set monthlyTokenQuota or providerUsagePercent in agent config to show provider-aligned usage %.'),
      providerTokenCount,
      providerSessionCount,
      monthlyTokenQuota,
      usagePeriod: period,
      providerResetAt: resetAt,
      superGrokBreakdown: breakdown,
    };
  }

  const pct = percentageUsed(tokensForPercent, monthlyTokenQuota);
  const overBudget = tokensForPercent > monthlyTokenQuota;

  return {
    percentageUsed: pct,
    overBudget,
    trackingSource,
    trackingNote,
    providerTokenCount,
    providerSessionCount,
    monthlyTokenQuota,
    usagePeriod: period,
    providerResetAt: resetAt,
    superGrokBreakdown: breakdown,
  };
}

/** Aggregate usage per agent type from audit logs and provider session signals. */
export function getAgentCreditUsage(): AgentCreditUsage[] {
  const db = getDatabase();
  const agents = listAgents();
  const monthStart = startOfCurrentMonthUtc();
  const grokProvider = getGrokProviderTokenUsage(monthStart);
  const copilotProvider = getCopilotProviderTokenUsage(monthStart);

  const monthStartIso = monthStart.toISOString();
  const byAgentType = db
    .prepare(
      `SELECT agent_type,
              COALESCE(SUM(cost), 0) AS total_cost,
              COALESCE(SUM(token_count), 0) AS token_count,
              COUNT(*) AS request_count
       FROM audit_log
       WHERE agent_type IS NOT NULL AND timestamp >= ?
       GROUP BY agent_type`
    )
    .all(monthStartIso) as Array<{
    agent_type: string;
    total_cost: number;
    token_count: number;
    request_count: number;
  }>;

  const usageByType = new Map<string, UsageTotals>();
  for (const row of byAgentType) {
    usageByType.set(row.agent_type, {
      credits_used: costToCredits(row.total_cost),
      token_count: row.token_count,
      request_count: row.request_count,
    });
  }

  const agentsByType = new Map<AgentType, Agent[]>();
  for (const agent of agents) {
    const group = agentsByType.get(agent.type) ?? [];
    group.push(agent);
    agentsByType.set(agent.type, group);
  }

  const results: AgentCreditUsage[] = [];

  for (const [type, group] of agentsByType) {
    const primary = pickPrimaryAgent(group);
    const limit = resolveTypeCreditLimit(group, type);
    const usage = usageByType.get(type);

    const used = usage?.credits_used ?? 0;
    const unlimited = limit === 0;
    const creditOverBudget = !unlimited && limit > 0 && used > limit;
    const remaining = unlimited ? 0 : Math.max(0, limit - used);

    const auditTokens = usage?.token_count ?? 0;
    const auditRequests = usage?.request_count ?? 0;
    const providerTokens =
      type === 'grok'
        ? grokProvider?.totalTokens
        : type === 'copilot'
          ? copilotProvider?.totalTokens
          : undefined;
    const providerSessions =
      type === 'grok'
        ? grokProvider?.sessionCount
        : type === 'copilot'
          ? copilotProvider?.sessionCount
          : undefined;
    ensureLegacyProviderCalibration(group, type);
    const refreshedGroup = refreshAgentGroup(group);
    const monthlyQuota = resolveEffectiveMonthlyQuota(refreshedGroup, type);
    const primaryCfg = pickPrimaryAgent(refreshedGroup).config;
    const dashboardPercent = primaryCfg.providerUsagePercent;
    const calibratedAt = primaryCfg.providerCalibratedAt as string | undefined;
    const usageMode = primaryCfg.providerUsageMode as string | undefined;
    const usagePeriod = primaryCfg.providerUsagePeriod as string | undefined;
    const resetAt =
      typeof primaryCfg.providerResetAt === 'string' ? primaryCfg.providerResetAt : undefined;
    const rawBreakdown = primaryCfg.providerBreakdown as
      | { build?: number; conversation?: number }
      | null
      | undefined;
    const breakdown =
      rawBreakdown && typeof rawBreakdown === 'object'
        ? {
            build: typeof rawBreakdown.build === 'number' ? rawBreakdown.build : undefined,
            conversation:
              typeof rawBreakdown.conversation === 'number' ? rawBreakdown.conversation : undefined,
          }
        : undefined;

    // SuperGrok dashboard mode: ignore legacy monthlyTokenQuota for display/block.
    const quotaForTracking =
      type === 'grok' &&
      (usageMode === 'dashboard_primary' ||
        (typeof dashboardPercent === 'number' && usageMode !== 'token_quota'))
        ? undefined
        : monthlyQuota;

    const tracking = buildTracking(
      type,
      auditTokens,
      auditRequests,
      providerTokens,
      providerSessions,
      quotaForTracking,
      typeof dashboardPercent === 'number' ? dashboardPercent : undefined,
      usageMode,
      usagePeriod,
      resetAt,
      breakdown
    );

    // Provider/audit-aligned % when available; otherwise internal credit budget %.
    const percentage =
      tracking.percentageUsed > 0
        ? tracking.percentageUsed
        : !unlimited && limit > 0
          ? percentageUsed(used, limit)
          : 0;

    // SuperGrok dashboard mode: only dashboard % / throttle gates; ignore estimated credit cents.
    const dashboardPrimary =
      type === 'grok' &&
      (usageMode === 'dashboard_primary' ||
        (typeof dashboardPercent === 'number' && usageMode !== 'token_quota'));
    const overBudget = dashboardPrimary
      ? tracking.overBudget
      : tracking.overBudget || creditOverBudget;

    const throttle = getThrottleSignal(type);
    const syncMeta = getUsageSyncMeta();
    // Only quota_exceeded (not short-term rate limits) hard-blocks via overBudget.
    const overBudgetWithThrottle = overBudget || throttle?.state === 'quota_exceeded';

    results.push({
      agentId: primary.id,
      agentName: primary.name,
      agentType: type,
      enabled: group.some((agent) => agent.enabled),
      creditLimit: limit,
      creditsUsed: used,
      creditsRemaining: unlimited ? 0 : remaining,
      unlimited,
      overBudget: overBudgetWithThrottle,
      tokenCount: auditTokens,
      requestCount: auditRequests,
      providerTokenCount: tracking.providerTokenCount,
      providerSessionCount: tracking.providerSessionCount,
      monthlyTokenQuota: tracking.monthlyTokenQuota,
      trackingSource: tracking.trackingSource,
      trackingNote: tracking.trackingNote,
      percentageUsed: percentage,
      providerDashboardPercent:
        typeof dashboardPercent === 'number' && dashboardPercent >= 0 ? dashboardPercent : undefined,
      providerCalibratedAt: calibratedAt,
      usagePeriod: tracking.usagePeriod,
      providerResetAt: tracking.providerResetAt,
      superGrokBreakdown: tracking.superGrokBreakdown,
      syncedAt: calibratedAt || syncMeta.syncedAt,
      throttleState: throttle?.state ?? 'ok',
      throttleMessage: throttle?.message,
      throttleAt: throttle?.at,
    });
  }

  return results.sort((a, b) => a.agentType.localeCompare(b.agentType));
}

export class CreditBudgetExceededError extends Error {
  readonly agentType: AgentType;

  constructor(agentType: AgentType, message: string) {
    super(message);
    this.name = 'CreditBudgetExceededError';
    this.agentType = agentType;
  }
}

/** True when the agent type has exceeded its configured credit or token budget. */
export function isAgentTypeOverBudget(agentType: AgentType): boolean {
  const usage = getAgentCreditUsage().find((u) => u.agentType === agentType);
  return Boolean(usage?.overBudget);
}

/** Throw when the agent type cannot accept more outbound runs. Ollama (unlimited) is always allowed. */
export function assertAgentTypeWithinBudget(agentType: AgentType): void {
  const usage = getAgentCreditUsage().find((u) => u.agentType === agentType);
  if (!usage || usage.unlimited || !usage.overBudget) return;
  throw new CreditBudgetExceededError(
    agentType,
    `${agentType} is over budget (${usage.percentageUsed}% of monthly quota / ${usage.creditsUsed} credits used). ` +
      'On Agent Registry → Adapter / model, switch this agent to another provider (e.g. copilot → grok), ' +
      'or raise/clear usage limits for this adapter type.'
  );
}