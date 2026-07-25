import { useState } from 'react';
import { Coins, Bot, Info, Settings2, RefreshCw } from 'lucide-react';
import { useAgentCredits, useSyncAgentCredits, useSyncSuperGrokDashboard } from '../api/hooks';
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
        {entry.throttleState === 'throttled' && (
          <span className="tag tag--warn" title={entry.throttleMessage}>
            Rate limited
          </span>
        )}
        {entry.throttleState === 'quota_exceeded' && !entry.overBudget && (
          <span className="tag tag--danger" title={entry.throttleMessage}>
            Quota signal
          </span>
        )}
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
      {entry.superGrokBreakdown &&
        (entry.superGrokBreakdown.build != null ||
          entry.superGrokBreakdown.conversation != null) && (
          <p className="credit-usage-note">
            SuperGrok buckets:{' '}
            {entry.superGrokBreakdown.build != null && (
              <strong>Build {entry.superGrokBreakdown.build}%</strong>
            )}
            {entry.superGrokBreakdown.build != null &&
              entry.superGrokBreakdown.conversation != null &&
              ' · '}
            {entry.superGrokBreakdown.conversation != null && (
              <strong>Conversation {entry.superGrokBreakdown.conversation}%</strong>
            )}
            {entry.providerResetAt && (
              <span className="text-muted">
                {' '}
                · resets {new Date(entry.providerResetAt).toLocaleString()}
              </span>
            )}
          </p>
        )}
      {entry.throttleMessage && (
        <p className="credit-usage-note text-muted">
          Live provider signal: {entry.throttleMessage}
        </p>
      )}
      {entry.agentType === 'grok' && entry.trackingSource !== 'dashboard_primary' && (
        <p className="credit-usage-note text-muted">
          SuperGrok is a <strong>weekly</strong> limit (Build + Conversation), not monthly audit
          tokens. Use <strong>Sync SuperGrok</strong> below with numbers from grok.com.
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
  const { data: credits, isLoading, isError, dataUpdatedAt } = useAgentCredits();
  const sync = useSyncAgentCredits();
  const superGrok = useSyncSuperGrokDashboard();
  const [sgPercent, setSgPercent] = useState('61');
  const [sgBuild, setSgBuild] = useState('59');
  const [sgConversation, setSgConversation] = useState('2');
  const [sgReset, setSgReset] = useState('2026-07-25T23:02');
  const [sgError, setSgError] = useState<string | null>(null);

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
  const syncedAt =
    credits.map((c) => c.syncedAt).filter(Boolean).sort().at(-1) ||
    (dataUpdatedAt ? new Date(dataUpdatedAt).toISOString() : undefined);

  return (
    <div id="credit-usage-panel" className={`card credit-usage-panel${compact ? ' credit-usage-panel--compact' : ''}`}>
      <div className="credit-usage-header">
        <h3>
          <Coins size={18} /> Agent Credit Usage
        </h3>
        <div className="credit-usage-header-actions">
          {!compact && (
            <div className="credit-usage-summary">
              <span>
                <strong>{formatTokens(totalProviderTokens)}</strong> tokens tracked
              </span>
              <span className="text-muted">· live after each run (WS)</span>
            </div>
          )}
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={sync.isPending}
            onClick={() => sync.mutate()}
            title="Rescan local provider CLI sessions and recompute usage"
          >
            <RefreshCw size={14} className={sync.isPending ? 'spin' : undefined} />{' '}
            {sync.isPending ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
      </div>

      {syncedAt && (
        <p className="credit-usage-sync-meta text-muted">
          Last sync {new Date(syncedAt).toLocaleString()} · SuperGrok has no public live API —
          paste weekly % from grok.com for true plan usage.
        </p>
      )}

      {sorted.length === 0 ? (
        <p className="text-muted">No agents registered yet.</p>
      ) : (
        <div className="credit-usage-list">
          {(compact ? sorted.slice(0, 4) : sorted).map((entry) => (
            <CreditRow key={entry.agentType} entry={entry} onConfigure={onConfigureAgent} />
          ))}
        </div>
      )}

      {!compact && (
        <div className="supergrok-sync card" style={{ marginTop: 16 }}>
          <h4 style={{ margin: '0 0 8px', fontSize: '0.9rem' }}>Sync SuperGrok (weekly)</h4>
          <p className="text-muted" style={{ fontSize: '0.8rem', margin: '0 0 10px' }}>
            From grok.com: overall % · Build % · Conversation % · reset time. Example: 61% = Build
            59% + Conversation 2%.
          </p>
          <div className="supergrok-sync-fields">
            <label>
              Overall %
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={sgPercent}
                onChange={(e) => setSgPercent(e.target.value)}
              />
            </label>
            <label>
              Build %
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={sgBuild}
                onChange={(e) => setSgBuild(e.target.value)}
              />
            </label>
            <label>
              Conversation %
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={sgConversation}
                onChange={(e) => setSgConversation(e.target.value)}
              />
            </label>
            <label>
              Resets at
              <input
                type="datetime-local"
                value={sgReset}
                onChange={(e) => setSgReset(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={superGrok.isPending}
              onClick={async () => {
                setSgError(null);
                const percent = Number(sgPercent);
                if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
                  setSgError('Overall % must be 0–100');
                  return;
                }
                try {
                  await superGrok.mutateAsync({
                    percent,
                    build: sgBuild === '' ? undefined : Number(sgBuild),
                    conversation: sgConversation === '' ? undefined : Number(sgConversation),
                    resetAt: sgReset ? new Date(sgReset).toISOString() : undefined,
                    agentType: 'grok',
                  });
                } catch (err) {
                  setSgError(err instanceof Error ? err.message : 'Sync failed');
                }
              }}
            >
              {superGrok.isPending ? 'Saving…' : 'Apply SuperGrok %'}
            </button>
          </div>
          {sgError && <p className="text-muted" style={{ color: 'var(--accent-red)' }}>{sgError}</p>}
          {superGrok.isSuccess && !sgError && (
            <p className="text-muted" style={{ fontSize: '0.8rem' }}>
              Saved. Grok bar now shows your SuperGrok weekly % until you sync again.
            </p>
          )}
        </div>
      )}
    </div>
  );
}