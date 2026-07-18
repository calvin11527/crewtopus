import { Coins, Bot, Info, Settings2 } from 'lucide-react';
import { useAgentCredits } from '../api/hooks';
import type { AgentCreditUsage, AgentType } from '../types';

const AGENT_COLORS: Record<AgentType, string> = {
  claude: '#d97706',
  grok: '#ef4444',
  copilot: '#4f8fff',
  antigravity: '#a855f7',
  ollama: '#22c55e',
  mock: '#6868a0',
};

function formatCredits(value: number): string {
  return value.toLocaleString();
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toLocaleString();
}

function formatAgentType(type: AgentType): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function formatUsagePercent(value: number, overBudget: boolean): string {
  const pct = value % 1 === 0 ? `${value}%` : `${value.toFixed(1)}%`;
  return overBudget ? `${pct}+` : pct;
}

function usageTone(entry: AgentCreditUsage): 'ok' | 'warn' | 'critical' {
  if (entry.unlimited) return 'ok';
  if (entry.overBudget || entry.percentageUsed >= 90) return 'critical';
  if (entry.percentageUsed >= 70) return 'warn';
  return 'ok';
}

function displayTokens(entry: AgentCreditUsage): number {
  return entry.providerTokenCount ?? entry.tokenCount;
}

function CreditRow({
  entry,
  onConfigure,
}: {
  entry: AgentCreditUsage;
  onConfigure?: (agentId: string, agentType: AgentType) => void;
}) {
  const color = AGENT_COLORS[entry.agentType] ?? '#4f8fff';
  const tone = usageTone(entry);
  const tokens = displayTokens(entry);
  const hasTokenQuota = (entry.monthlyTokenQuota ?? 0) > 0;
  const showUsage = !entry.unlimited;

  return (
    <div id={`credit-usage-${entry.agentType}`} className="credit-usage-row">
      <div className="credit-usage-agent">
        <div className="credit-usage-icon" style={{ color, borderColor: `${color}33` }}>
          <Bot size={18} />
        </div>
        <div>
          <strong>{formatAgentType(entry.agentType)}</strong>
          <span className="credit-usage-type">
            Total usage across all {entry.agentType} agents
            {entry.trackingSource === 'provider'
              ? ` · provider sessions (${entry.providerSessionCount ?? 0}) this month${
                  entry.providerCalibratedAt
                    ? ` · calibrated ${new Date(entry.providerCalibratedAt).toLocaleDateString()}`
                    : ''
                }`
              : entry.requestCount > 0
                ? ` · ${entry.requestCount} run${entry.requestCount === 1 ? '' : 's'} via AgentHub`
                : ''}
          </span>
        </div>
        {!entry.enabled && <span className="tag">Disabled</span>}
        {entry.overBudget && <span className="tag tag--danger">Over quota</span>}
        {onConfigure && (
          <button
            type="button"
            className={`btn btn--sm ${entry.overBudget ? 'btn--primary' : 'btn--ghost'}`}
            onClick={() => onConfigure(entry.agentId, entry.agentType)}
            title="Change model and raise usage limits so this role can keep working"
          >
            <Settings2 size={14} /> {entry.overBudget ? 'Unblock' : 'Configure'}
          </button>
        )}
      </div>

      <div className="credit-usage-metrics">
        <div className="credit-usage-stat">
          <span className="credit-usage-label">Tokens</span>
          <span className="credit-usage-value">{formatTokens(tokens)}</span>
        </div>
        <div className="credit-usage-stat">
          <span className="credit-usage-label">{hasTokenQuota ? 'Quota' : 'Budget'}</span>
          <span className="credit-usage-value">
            {hasTokenQuota
              ? formatTokens(entry.monthlyTokenQuota!)
              : formatCredits(entry.creditLimit)}
          </span>
        </div>
        <div className="credit-usage-stat">
          <span className="credit-usage-label">Usage</span>
          <span className={`credit-usage-value credit-usage-value--${tone}`}>
            {showUsage ? formatUsagePercent(entry.percentageUsed, entry.overBudget) : '—'}
          </span>
        </div>
      </div>

      <div className="credit-usage-bar-wrap">
        <div className="credit-usage-bar">
          <div
            className={`credit-usage-bar-fill credit-usage-bar-fill--${tone}`}
            style={{
              width: showUsage ? `${Math.min(100, entry.percentageUsed)}%` : '0%',
              background: showUsage ? color : undefined,
            }}
          />
        </div>
        <span className="credit-usage-bar-caption">
          {hasTokenQuota
            ? `${formatTokens(tokens)} / ${formatTokens(entry.monthlyTokenQuota!)} tokens`
            : `${formatCredits(entry.creditsUsed)} / ${formatCredits(entry.creditLimit)} credits`}
        </span>
      </div>

      {entry.trackingNote && (
        <p className="credit-usage-note">
          <Info size={12} /> {entry.trackingNote}
        </p>
      )}
      {entry.providerDashboardPercent != null &&
        Math.abs(entry.percentageUsed - entry.providerDashboardPercent) >= 5 && (
          <p className="credit-usage-note text-muted">
            Last dashboard sync: {entry.providerDashboardPercent}%. If grok.com shows a different %,
            re-sync <code>providerUsagePercent</code> on the agent (Agents page) to recalibrate.
          </p>
        )}
      {entry.agentType === 'grok' && (
        <p className="credit-usage-note text-muted">
          Grok usage is based on AgentHub run audits + your dashboard calibration — not session
          context size (that used to false-trigger over-budget).
        </p>
      )}
    </div>
  );
}

interface CreditUsageProps {
  compact?: boolean;
  /** Open agent configure (model + budget) for the primary agent of this type. */
  onConfigureAgent?: (agentId: string, agentType: AgentType) => void;
}

export default function CreditUsage({ compact = false, onConfigureAgent }: CreditUsageProps) {
  const { data: credits, isLoading, isError } = useAgentCredits();

  if (isLoading) {
    return (
      <div id="credit-usage-panel" className={`card credit-usage-panel${compact ? ' credit-usage-panel--compact' : ''}`}>
        <p className="loading-text">Loading credit usage...</p>
      </div>
    );
  }

  if (isError || !credits) {
    return (
      <div id="credit-usage-panel" className={`card credit-usage-panel${compact ? ' credit-usage-panel--compact' : ''}`}>
        <p className="text-muted">Unable to load agent credit usage.</p>
      </div>
    );
  }

  const sorted = [...credits].sort((a, b) => {
    if (a.unlimited !== b.unlimited) return a.unlimited ? 1 : -1;
    return b.percentageUsed - a.percentageUsed;
  });

  const totalProviderTokens = credits.reduce(
    (sum, c) => sum + (c.providerTokenCount ?? c.tokenCount),
    0
  );

  return (
    <div id="credit-usage-panel" className={`card credit-usage-panel${compact ? ' credit-usage-panel--compact' : ''}`}>
      <div className="credit-usage-header">
        <h3>
          <Coins size={18} /> Agent Credit Usage
        </h3>
        {!compact && (
          <div className="credit-usage-summary">
            <span>
              <strong>{formatTokens(totalProviderTokens)}</strong> tokens tracked
            </span>
            <span className="text-muted">· usage % is total consumption per agent type</span>
          </div>
        )}
      </div>

      {sorted.length === 0 ? (
        <p className="text-muted">No agents registered yet.</p>
      ) : (
        <div className="credit-usage-list">
          {(compact ? sorted.slice(0, 4) : sorted).map((entry) => (
            <CreditRow key={entry.agentType} entry={entry} onConfigure={onConfigureAgent} />
          ))}
        </div>
      )}
    </div>
  );
}