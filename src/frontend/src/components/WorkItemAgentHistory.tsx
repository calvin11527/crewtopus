import { useMemo, useState } from 'react';
import {
  Bot,
  Briefcase,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  ClipboardList,
  Code2,
  ExternalLink,
  FlaskConical,
  History,
  Loader2,
  SearchCheck,
  UserCog,
  XCircle,
} from 'lucide-react';
import type { WorkItem, WorkItemActivity, WorkItemLoopHistory } from '../types';
import {
  AGENT_HISTORY_STATUS_LABEL,
  agentHistoryRoleLabel,
  buildWorkItemAgentHistory,
  type AgentHistoryEntry,
  type AgentHistoryRole,
  type AgentHistoryStatus,
  type AgentRoleSnapshot,
} from '../utils/work-item-agent-history';

const ROLE_ICON: Record<AgentHistoryRole, typeof Bot> = {
  business_analyst: ClipboardList,
  project_manager: Briefcase,
  developer: Code2,
  tester: FlaskConical,
  reviewer: SearchCheck,
  scrum_master: UserCog,
  unknown: Bot,
};

interface WorkItemAgentHistoryProps {
  workItem: WorkItem;
  activity?: WorkItemActivity[] | null;
  loopHistory?: WorkItemLoopHistory | null;
  isBusy?: boolean;
  agentNames?: Record<string, string>;
}

function statusClass(status: AgentHistoryStatus | 'idle'): string {
  return `agent-history-status agent-history-status--${status}`;
}

function RoleSnapshotChip({ snap }: { snap: AgentRoleSnapshot }) {
  const Icon = ROLE_ICON[snap.role] ?? Bot;
  const active = snap.status !== 'idle';

  return (
    <div
      className={`agent-history-role-chip${active ? ' agent-history-role-chip--active' : ''}${
        snap.status === 'running' ? ' agent-history-role-chip--running' : ''
      }`}
      title={snap.summary ?? snap.label}
    >
      <Icon size={12} aria-hidden />
      <span className="agent-history-role-chip-label">{snap.label}</span>
      <span className={statusClass(snap.status)}>
        {snap.status === 'running' && <Loader2 size={10} className="agent-history-spin" aria-hidden />}
        {AGENT_HISTORY_STATUS_LABEL[snap.status]}
      </span>
      {snap.agentType && <span className="agent-history-agent-type">{snap.agentType}</span>}
    </div>
  );
}

function StatusIcon({ status }: { status: AgentHistoryStatus }) {
  switch (status) {
    case 'running':
      return <Loader2 size={14} className="agent-history-spin" aria-hidden />;
    case 'completed':
      return <CheckCircle2 size={14} aria-hidden />;
    case 'failed':
      return <XCircle size={14} aria-hidden />;
    case 'queued':
      return <CircleDashed size={14} aria-hidden />;
    default:
      return <History size={14} aria-hidden />;
  }
}

function TimelineRow({
  entry,
  agentNames,
}: {
  entry: AgentHistoryEntry;
  agentNames?: Record<string, string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const Icon = ROLE_ICON[entry.role] ?? Bot;
  const hasDetails = Boolean(entry.content || entry.error || entry.workDir || entry.auditId);
  const agentLabel =
    (entry.agentId && agentNames?.[entry.agentId]) || entry.agentType || null;

  return (
    <li
      className={`agent-history-entry agent-history-entry--${entry.status}`}
      data-role={entry.role}
      data-status={entry.status}
    >
      <div className="agent-history-entry-rail" aria-hidden>
        <span className={`agent-history-entry-dot agent-history-entry-dot--${entry.status}`}>
          <StatusIcon status={entry.status} />
        </span>
      </div>
      <div className="agent-history-entry-body">
        <div className="agent-history-entry-header">
          <span className="agent-history-entry-role">
            <Icon size={13} aria-hidden />
            {agentHistoryRoleLabel(entry.role)}
          </span>
          <span className={statusClass(entry.status)}>
            {AGENT_HISTORY_STATUS_LABEL[entry.status]}
          </span>
          {entry.loopIteration != null && entry.loopIteration > 0 && (
            <span className="agent-history-iter">iter {entry.loopIteration}</span>
          )}
          {entry.phase && <span className="agent-history-phase">{entry.phase}</span>}
          {agentLabel && (
            <span className="agent-history-agent-type" title={entry.agentId}>
              <Bot size={11} aria-hidden /> {agentLabel}
            </span>
          )}
          <time dateTime={entry.timestamp}>
            {new Date(entry.timestamp).toLocaleString()}
          </time>
        </div>
        <p className="agent-history-entry-summary">{entry.summary}</p>
        {entry.error && <p className="agent-history-entry-error">{entry.error}</p>}
        {hasDetails && (
          <div className="agent-history-entry-actions">
            {(entry.content || entry.workDir) && (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
              >
                {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {expanded ? 'Hide output' : 'Show output'}
              </button>
            )}
            {entry.auditId && (
              <a className="agent-history-audit-link" href={`/audit#${entry.auditId}`}>
                Audit <ExternalLink size={11} aria-hidden />
              </a>
            )}
          </div>
        )}
        {expanded && entry.content && (
          <pre className="agent-history-output">{entry.content}</pre>
        )}
        {expanded && entry.workDir && (
          <p className="agent-history-workdir">
            Work dir: <code>{entry.workDir}</code>
          </p>
        )}
      </div>
    </li>
  );
}

/** Multi-agent role status strip + chronological work history for a work item. */
export default function WorkItemAgentHistory({
  workItem,
  activity,
  loopHistory,
  isBusy = false,
  agentNames,
}: WorkItemAgentHistoryProps) {
  const model = useMemo(
    () =>
      buildWorkItemAgentHistory({
        workItem,
        activity,
        loopHistory,
        isBusy,
        agentNames,
      }),
    [workItem, activity, loopHistory, isBusy, agentNames]
  );

  const activeRoles = model.roleSnapshots.filter((s) => s.status !== 'idle');
  const hasTimeline = model.entries.length > 0;

  return (
    <section className="agent-history" aria-label="Agent history">
      <div className="agent-history-header">
        <h4>
          <History size={16} aria-hidden /> Agent history
        </h4>
        <div className="agent-history-header-meta">
          <span
            className={`agent-history-phase-chip agent-history-phase-chip--${model.phase === 'n/a' ? 'na' : model.phase}`}
            title="Story lifecycle phase (BA → PM → developer pipeline)"
          >
            {model.phaseLabel}
          </span>
          {(model.loopIteration ?? 0) > 0 && (
            <span className="agent-history-loop-chip">
              Loop {model.loopIteration}/{model.maxLoopIterations} · {model.loopStatus}
            </span>
          )}
        </div>
      </div>

      <div className="agent-history-roles" role="list" aria-label="Role status">
        {model.roleSnapshots.map((snap) => (
          <div key={snap.role} role="listitem">
            <RoleSnapshotChip snap={snap} />
          </div>
        ))}
      </div>

      {!hasTimeline && (
        <p className="agent-history-empty text-muted">
          No agent work recorded yet. BA/PM run via sprint automation on stories; developer,
          tester, and reviewer appear when you run the pipeline.
        </p>
      )}

      {hasTimeline && (
        <>
          <div className="agent-history-timeline-header">
            <span>
              Timeline
              {activeRoles.length > 0
                ? ` · ${activeRoles.length} role${activeRoles.length === 1 ? '' : 's'} active in history`
                : ''}
            </span>
          </div>
          <ol className="agent-history-timeline">
            {model.entries.map((entry) => (
              <TimelineRow key={entry.id} entry={entry} agentNames={agentNames} />
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
