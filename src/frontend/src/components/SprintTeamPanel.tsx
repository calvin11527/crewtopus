import { Bot, Clock, Play, AlertCircle, Radio } from 'lucide-react';
import type {
  AgentRole,
  AgentStatus,
  SprintAutomationStatus,
  SprintTeamView,
  WorkItem,
} from '../types';
import StatusBadge from './StatusBadge';

import { AGENT_ROLE_LABELS, STAFF_ROLES } from '../constants/agent-roles';
import { formatAgentType } from '../constants/agent-types';
import {
  automationPauseHint,
  automationPauseLabel,
  AUTOMATION_PAUSE_HINTS,
} from '../constants/sprint-automation';

const ROLE_ORDER: AgentRole[] = STAFF_ROLES;

const ROLE_HINTS: Record<AgentRole, string> = {
  scrum_master: 'Standup (hourly) + queues stories when autonomous',
  project_manager: 'Autonomous / Full lifecycle: decomposes stories into developer tasks after BA',
  business_analyst: 'Autonomous / Full lifecycle: requirements, plan.md, and acceptance criteria before PM',
  developer: 'Implementation step in the pipeline',
  tester: 'Testing step after implementation',
  reviewer: 'Review step before loop verdict',
  custom: 'User-defined specialist profile',
};

interface SprintTeamPanelProps {
  team: SprintTeamView | undefined;
  automation: SprintAutomationStatus | undefined;
  runningItems: WorkItem[];
  agentStatuses: Record<string, AgentStatus>;
  displayNames: Record<string, string>;
  onSelectItem: (item: WorkItem) => void;
  onEnableAutonomous: () => void;
}

function memberStatus(
  agentId: string,
  agentStatuses: Record<string, AgentStatus>
): AgentStatus {
  return agentStatuses[agentId] ?? 'idle';
}

export default function SprintTeamPanel({
  team,
  automation,
  runningItems,
  agentStatuses,
  displayNames,
  onSelectItem,
  onEnableAutonomous,
}: SprintTeamPanelProps) {
  if (!team?.members.length) {
    return (
      <div id="sprint-team-panel" className="card sprint-team-panel sprint-team-panel--empty">
        <AlertCircle size={18} />
        <div>
          <strong>No sprint team staffed</strong>
          <p className="text-muted">
            Hire agents on the Agents page, then use <em>Staff team</em> to assign roles. Include{' '}
            <strong>Business Analyst</strong> and <strong>Project Manager</strong> so empty-sprint queue
            and Full lifecycle can plan work (BA → PM → developer), not only implement/review.
          </p>
        </div>
      </div>
    );
  }

  const membersByRole = ROLE_ORDER.map((role) => team.members.find((m) => m.role === role)).filter(
    Boolean
  ) as SprintTeamView['members'];

  const pauseReason = automation?.automation.pausedReason;
  const pauseHint = automationPauseHint(pauseReason);
  const pauseLabel = automationPauseLabel(pauseReason);
  const staffedRoles = new Set(membersByRole.map((m) => m.role));
  const missingLifecycleRoles = (['business_analyst', 'project_manager'] as AgentRole[]).filter(
    (role) => !staffedRoles.has(role)
  );
  const isManual = automation?.automation.mode !== 'autonomous';
  const anyRunning = runningItems.length > 0 || membersByRole.some((m) => agentStatuses[m.agentId] === 'running');

  return (
    <div id="sprint-team-panel" className="card sprint-team-panel">
      <div className="sprint-team-panel-header">
        <div className="sprint-team-panel-title">
          {anyRunning ? (
            <Radio size={16} className="sprint-team-live-icon" />
          ) : (
            <Clock size={16} />
          )}
          <h3>Sprint team</h3>
          {automation && (
            <span className="tag">{automation.automation.mode}</span>
          )}
        </div>
        {automation && (
          <p className="sprint-team-panel-sub">
            {automation.onShiftRoles.length > 0
              ? `On shift: ${automation.onShiftRoles.map((r) => r.replace(/_/g, ' ')).join(', ')}`
              : 'Outside working hours'}
            {pauseLabel ? ` · ${pauseLabel}` : ''}
          </p>
        )}
      </div>

      {missingLifecycleRoles.length > 0 && (
        <div className="sprint-team-hint sprint-team-hint--warn">
          <AlertCircle size={14} />
          <span>
            Missing {missingLifecycleRoles.map((r) => AGENT_ROLE_LABELS[r]).join(' & ')} — Full
            lifecycle / empty-sprint planning will skip BA→PM and fall back to the developer pipeline
            only.
          </span>
        </div>
      )}

      <div className="sprint-team-grid">
        {membersByRole.map((member) => {
          const status = memberStatus(member.agentId, agentStatuses);
          const label = displayNames[member.agentId] ?? member.agentName ?? member.agentId.slice(0, 8);
          return (
            <div
              key={member.id}
              id={`sprint-team-${member.role}`}
              className={`sprint-team-member${status === 'running' ? ' sprint-team-member--working' : ''}`}
            >
              <div className="sprint-team-member-top">
                <span className="sprint-team-role">{AGENT_ROLE_LABELS[member.role]}</span>
                <StatusBadge status={status} />
              </div>
              <div className="sprint-team-member-name">
                <Bot size={12} /> {label}
              </div>
              <span className="text-muted sprint-team-member-meta">
                {member.agentType ? formatAgentType(member.agentType) : '—'}
                {member.onShift ? ' · on shift' : ' · off shift'}
                {' · '}
                {ROLE_HINTS[member.role]}
              </span>
            </div>
          );
        })}
      </div>

      {runningItems.length > 0 && (
        <div className="sprint-team-running">
          <strong>
            <Play size={14} /> Active work
          </strong>
          <div className="sprint-team-running-chips">
            {runningItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className="sprint-team-chip"
                onClick={() => onSelectItem(item)}
              >
                {item.key} · {item.loopStatus === 'running' ? `loop ${item.loopIteration}/${item.maxLoopIterations}` : item.status}
              </button>
            ))}
          </div>
        </div>
      )}

      {!anyRunning && (isManual || pauseHint) && (
        <div className="sprint-team-hint">
          <AlertCircle size={14} />
          <span>
            {isManual && pauseReason === 'manual'
              ? AUTOMATION_PAUSE_HINTS.manual
              : pauseHint ?? 'Waiting for work to start.'}
          </span>
          {isManual && (
            <button type="button" className="btn btn--sm btn--primary" onClick={onEnableAutonomous}>
              Enable Autonomous
            </button>
          )}
        </div>
      )}
    </div>
  );

}