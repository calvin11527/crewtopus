import type { AgentStatus, WorkflowStatus, ApprovalStatus } from '../types';

const STATUS_COLORS: Record<string, string> = {
  idle: 'badge--green',
  running: 'badge--blue',
  active: 'badge--blue',
  error: 'badge--red',
  failed: 'badge--red',
  disabled: 'badge--muted',
  draft: 'badge--muted',
  completed: 'badge--green',
  paused: 'badge--amber',
  cancelled: 'badge--muted',
  pending: 'badge--amber',
  approved: 'badge--green',
  rejected: 'badge--red',
  modified: 'badge--purple',
};

interface StatusBadgeProps {
  status: AgentStatus | WorkflowStatus | ApprovalStatus | string;
  id?: string;
}

export default function StatusBadge({ status, id }: StatusBadgeProps) {
  const cls = STATUS_COLORS[status] || 'badge--muted';
  return (
    <span id={id} className={`badge ${cls}`}>
      {status}
    </span>
  );
}