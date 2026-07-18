import { AlertTriangle, Bot, Clock, Power, PowerOff, Settings2 } from 'lucide-react';
import type { Agent, AgentModelOption, AgentRole, RosterAgent } from '../types';
import StatusBadge from './StatusBadge';
import { AGENT_TYPE_COLORS, formatAgentType } from '../constants/agent-types';
import { AGENT_ROLE_LABELS } from '../constants/agent-roles';

interface AgentCardProps {
  agent: Agent | RosterAgent;
  models?: AgentModelOption[];
  liveStatus?: string;
  overBudget?: boolean;
  onToggle: (id: string, enable: boolean) => void;
  onConfigure?: (agent: Agent) => void;
  onEditHours?: (agent: RosterAgent) => void;
}

function displayModel(agent: Agent, models?: AgentModelOption[]): string {
  const configured = typeof agent.config.model === 'string' ? agent.config.model : '';
  if (configured) {
    const match = models?.find((m) => m.id === configured);
    return match?.label ?? configured;
  }
  const fallback = models?.find((m) => m.isDefault) ?? models?.[0];
  return fallback ? `${fallback.label} (default)` : 'Provider default';
}

function isRoster(agent: Agent | RosterAgent): agent is RosterAgent {
  return 'onShift' in agent || 'employment' in agent || 'sprintAssignments' in agent;
}

function roleLabel(agent: RosterAgent): string {
  const emp = agent.employment;
  if (!emp) return 'Not hired';
  if (emp.role === 'custom') return emp.customRoleLabel ?? 'Custom';
  return AGENT_ROLE_LABELS[emp.role as AgentRole] ?? emp.role;
}

export default function AgentCard({
  agent,
  models,
  liveStatus,
  overBudget = false,
  onToggle,
  onConfigure,
  onEditHours,
}: AgentCardProps) {
  const color = AGENT_TYPE_COLORS[agent.type] || '#4f8fff';
  const roster = isRoster(agent) ? agent : null;
  const status = liveStatus || agent.status;
  const title = roster?.employment?.displayTitle ?? agent.name;
  const isRunning = status === 'running';

  return (
    <article
      id={`agent-card-${agent.id}`}
      className={`agent-card${overBudget ? ' agent-card--over-budget' : ''}${!agent.enabled ? ' agent-card--disabled' : ''}`}
    >
      <header className="agent-card-header">
        <div className="agent-icon" style={{ color, borderColor: `${color}33` }}>
          <Bot size={20} />
        </div>
        <div className="agent-card-identity">
          <h4>{title}</h4>
          <div className="agent-card-meta">
            <span className="agent-type-badge" style={{ color, borderColor: `${color}44` }}>
              {formatAgentType(agent.type)}
            </span>
            {roster?.employment && (
              <span className="text-muted agent-card-role">{roleLabel(roster)}</span>
            )}
            {overBudget && (
              <span className="tag tag--danger agent-card-quota-tag" title="This adapter is over quota">
                <AlertTriangle size={10} /> Over quota
              </span>
            )}
          </div>
        </div>
        <StatusBadge status={status} id={`agent-status-${agent.id}`} />
      </header>

      <dl className="agent-card-facts">
        <div>
          <dt>Model</dt>
          <dd>
            {onConfigure ? (
              <button
                type="button"
                className="agent-model-link"
                onClick={() => onConfigure(agent)}
                title="Change adapter and model"
              >
                {displayModel(agent, models)}
              </button>
            ) : (
              displayModel(agent, models)
            )}
          </dd>
        </div>
        {roster && (
          <div>
            <dt>Shift</dt>
            <dd>
              {roster.onShift ? (
                <span className="tag tag--success">On shift</span>
              ) : (
                <span className="tag">Off shift</span>
              )}
            </dd>
          </div>
        )}
        {roster && roster.sprintAssignments.length > 0 && (
          <div className="agent-card-facts--wide">
            <dt>Sprints</dt>
            <dd className="text-muted">
              {roster.sprintAssignments.map((s) => s.sprintName).join(', ')}
            </dd>
          </div>
        )}
      </dl>

      {overBudget && (
        <p className="agent-card-quota-hint">
          Switch adapter (e.g. Copilot → Grok) so this role can keep working.
        </p>
      )}

      <footer className="agent-card-actions">
        {onConfigure && (
          <button
            type="button"
            className={`btn btn--sm ${overBudget ? 'btn--primary' : 'btn--ghost'}`}
            onClick={() => onConfigure(agent)}
            title="Change adapter (e.g. Copilot → Grok), model, and limits"
            disabled={isRunning}
          >
            <Settings2 size={14} /> {overBudget ? 'Switch adapter' : 'Adapter / model'}
          </button>
        )}
        {roster?.employment && onEditHours && (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => onEditHours(roster)}
            title="Edit working hours"
          >
            <Clock size={14} /> Hours
          </button>
        )}
        <button
          id={`agent-toggle-${agent.id}`}
          type="button"
          className={`btn btn--sm ${agent.enabled ? 'btn--ghost' : 'btn--primary'}`}
          onClick={() => onToggle(agent.id, !agent.enabled)}
          disabled={isRunning}
          title={isRunning ? 'Cannot disable while running' : undefined}
        >
          {agent.enabled ? (
            <>
              <PowerOff size={14} /> Disable
            </>
          ) : (
            <>
              <Power size={14} /> Enable
            </>
          )}
        </button>
      </footer>
    </article>
  );
}
