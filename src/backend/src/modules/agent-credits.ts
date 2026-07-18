import { getDatabase } from '../database';
import { getAgent, listAgents, updateAgentConfig } from './agent-registry';
import {
  getCopilotProviderTokenUsage,
  getGrokProviderTokenUsage,
  startOfCurrentMonthUtc,
  type ProviderTokenSnapshot,
} from './provider-usage';
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

/**
 * Snapshot provider dashboard % and derive a fixed monthly token quota.
 *
 * Grok: session signals are context-window peaks — calibrate from AgentHub audit tokens.
 * Copilot: shutdown events are cumulative usage — use provider scan.
 */
export function calibrateAgentProviderUsage(
  agentId: string,
  dashboardPercent: number
): Agent | null {
  const agent = getAgent(agentId);
  if (!agent) return null;
  if (dashboardPercent <= 0 || dashboardPercent > 100) {
    throw new Error('providerUsagePercent must be between 0 and 100');
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

  if (!calibrationTokens || calibrationTokens <= 0) {
    throw new Error(
      agent.type === 'grok'
        ? 'No AgentHub Grok audit tokens found this period. Run at least one Grok task in AgentHub before calibrating.'
        : `No provider CLI session tokens found for ${agent.type}. Run the CLI at least once this month before calibrating.`
    );
  }

  const monthlyTokenQuota = Math.round(calibrationTokens / (dashboardPercent / 100));
  return updateAgentConfig(agentId, {
    providerUsagePercent: dashboardPercent,
    providerCalibrationTokens: calibrationTokens,
    providerCalibrationSource: calibrationSource,
    monthlyTokenQuota,
    providerCalibratedAt: now(),
  });
}

function ensureLegacyProviderCalibration(group: Agent[], type: AgentType): void {
  const primary = pickPrimaryAgent(group);
  const percent = primary.config.providerUsagePercent;
  if (typeof percent !== 'number' || percent <= 0 || percent > 100) return;
  if (typeof primary.config.providerCalibrationTokens === 'number') return;
  if (typeof primary.config.monthlyTokenQuota === 'number' && primary.config.monthlyTokenQuota > 0) return;

  try {
    calibrateAgentProviderUsage(primary.id, percent);
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
  dashboardPercent?: number
): Pick<
  AgentCreditUsage,
  'percentageUsed' | 'overBudget' | 'trackingSource' | 'trackingNote' | 'providerTokenCount' | 'providerSessionCount' | 'monthlyTokenQuota'
> {
  const providerTokenCount = providerTokens && providerTokens > 0 ? providerTokens : undefined;
  const providerSessionCount = providerSessions && providerSessions > 0 ? providerSessions : undefined;
  const monthlyTokenQuota = monthlyQuota;

  let trackingSource: UsageTrackingSource = 'none';
  let tokensForPercent = 0;
  let trackingNote: string | undefined;

  // Grok session signals are context-window peaks, not monthly billable tokens.
  // Always prefer AgentHub audit for Grok % / hard budget when a quota exists.
  if (type === 'grok') {
    if (auditTokens > 0 || monthlyTokenQuota) {
      trackingSource = 'agenthub_audit';
      tokensForPercent = auditTokens;
      trackingNote =
        'Grok % uses AgentHub run audit tokens (not session context size). ' +
        'Calibrate with your grok.com dashboard % so the monthly quota matches your real plan.';
      if (providerSessionCount) {
        trackingNote += ` Local CLI shows ${providerSessionCount} session(s); max context peak ${providerTokenCount?.toLocaleString() ?? 0} tokens (not billable total).`;
      }
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
    // Soft display: if user entered dashboard % without enough data for quota, show that % (never hard-block).
    if (typeof dashboardPercent === 'number' && dashboardPercent > 0 && dashboardPercent <= 100) {
      return {
        percentageUsed: dashboardPercent,
        overBudget: false,
        trackingSource: trackingSource === 'none' ? 'agenthub_audit' : trackingSource,
        trackingNote:
          trackingNote ??
          `Showing last calibrated dashboard usage (${dashboardPercent}%). Run calibrate again after more AgentHub usage to track live %.`,
        providerTokenCount,
        providerSessionCount,
        monthlyTokenQuota,
      };
    }
    return {
      percentageUsed: 0,
      overBudget: false,
      trackingSource,
      trackingNote:
        trackingNote ??
        (type === 'grok'
          ? 'Sync with grok.com: set providerUsagePercent to your dashboard % (e.g. 50). That calibrates monthly quota from AgentHub Grok audit totals.'
          : type === 'copilot'
            ? 'Sync with the Copilot dashboard by PATCHing agent config providerUsagePercent to calibrate monthly quota.'
            : 'Set monthlyTokenQuota or providerUsagePercent in agent config to show provider-aligned usage %.'),
      providerTokenCount,
      providerSessionCount,
      monthlyTokenQuota,
    };
  }

  const pct = percentageUsed(tokensForPercent, monthlyTokenQuota);
  // Never hard-block solely from stale Grok session sums; audit/quota comparison only.
  const overBudget = tokensForPercent > monthlyTokenQuota;

  return {
    percentageUsed: pct,
    overBudget,
    trackingSource,
    trackingNote,
    providerTokenCount,
    providerSessionCount,
    monthlyTokenQuota,
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
    const dashboardPercent = pickPrimaryAgent(refreshedGroup).config.providerUsagePercent;
    const calibratedAt = pickPrimaryAgent(refreshedGroup).config.providerCalibratedAt as string | undefined;

    const tracking = buildTracking(
      type,
      auditTokens,
      auditRequests,
      providerTokens,
      providerSessions,
      monthlyQuota,
      typeof dashboardPercent === 'number' ? dashboardPercent : undefined
    );

    // Provider/audit-aligned % when available; otherwise internal credit budget %.
    const percentage =
      tracking.percentageUsed > 0
        ? tracking.percentageUsed
        : !unlimited && limit > 0
          ? percentageUsed(used, limit)
          : 0;

    // Grok: do not hard-block on credit alone when token tracking says OK and credits are only estimates;
    // still block when either credit or (audit-based) token quota is exceeded.
    const overBudget = tracking.overBudget || creditOverBudget;

    results.push({
      agentId: primary.id,
      agentName: primary.name,
      agentType: type,
      enabled: group.some((agent) => agent.enabled),
      creditLimit: limit,
      creditsUsed: used,
      creditsRemaining: unlimited ? 0 : remaining,
      unlimited,
      overBudget,
      tokenCount: auditTokens,
      requestCount: auditRequests,
      providerTokenCount: tracking.providerTokenCount,
      providerSessionCount: tracking.providerSessionCount,
      monthlyTokenQuota: tracking.monthlyTokenQuota,
      trackingSource: tracking.trackingSource,
      trackingNote: tracking.trackingNote,
      percentageUsed: percentage,
      providerDashboardPercent:
        typeof dashboardPercent === 'number' && dashboardPercent > 0 ? dashboardPercent : undefined,
      providerCalibratedAt: calibratedAt,
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