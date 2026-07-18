import type {
  AgentRole,
  AgentType,
  LoopStatus,
  WorkItem,
  WorkItemActivity,
  WorkItemLoopHistory,
} from '../types';
import { AGENT_ROLE_LABELS } from '../constants/agent-roles';

export type AgentHistoryStatus = 'queued' | 'running' | 'completed' | 'failed' | 'info';

/** Roles shown in the multi-agent history (excludes custom). */
export type AgentHistoryRole = Exclude<AgentRole, 'custom'> | 'unknown';

export type StoryLifecyclePhase =
  | 'ba_pending'
  | 'pm_pending'
  | 'dev_ready'
  | 'tracking'
  | 'complete'
  | 'n/a';

export interface AgentHistoryEntry {
  id: string;
  role: AgentHistoryRole;
  status: AgentHistoryStatus;
  agentType?: AgentType;
  agentId?: string;
  summary: string;
  timestamp: string;
  loopIteration?: number;
  phase?: string;
  auditId?: string;
  content?: string;
  error?: string;
  workDir?: string;
  event?: string;
  activityType: string;
}

export interface AgentRoleSnapshot {
  role: AgentHistoryRole;
  label: string;
  status: AgentHistoryStatus | 'idle';
  agentType?: AgentType;
  agentId?: string;
  summary?: string;
  timestamp?: string;
  loopIteration?: number;
  auditId?: string;
}

export interface WorkItemAgentHistoryModel {
  phase: StoryLifecyclePhase;
  phaseLabel: string;
  entries: AgentHistoryEntry[];
  roleSnapshots: AgentRoleSnapshot[];
  loopStatus?: LoopStatus;
  loopIteration?: number;
  maxLoopIterations?: number;
}

const ROLE_ORDER: AgentHistoryRole[] = [
  'business_analyst',
  'project_manager',
  'developer',
  'tester',
  'reviewer',
  'scrum_master',
];

const LIFECYCLE_PHASE_LABEL: Record<StoryLifecyclePhase, string> = {
  ba_pending: 'Awaiting business analyst',
  pm_pending: 'Awaiting project manager',
  dev_ready: 'Ready for developer pipeline',
  tracking: 'Tracking child tasks',
  complete: 'Complete',
  'n/a': 'Direct run (no BA/PM lifecycle)',
};

/** Compact chip text for kanban cards (null = hide chip). */
export const LIFECYCLE_PHASE_SHORT: Record<StoryLifecyclePhase, string | null> = {
  ba_pending: 'BA',
  pm_pending: 'PM',
  dev_ready: 'Dev ready',
  tracking: 'Tracking',
  complete: null,
  'n/a': null,
};

function metaString(activity: WorkItemActivity, key: string): string | undefined {
  const value = activity.metadata?.[key];
  return typeof value === 'string' ? value : undefined;
}

function metaNumber(activity: WorkItemActivity, key: string): number | undefined {
  const value = activity.metadata?.[key];
  return typeof value === 'number' ? value : undefined;
}

/** Infer lifecycle phase from work-item labels (frontend-safe, no children scan). */
export function getWorkItemLifecyclePhase(item: WorkItem): StoryLifecyclePhase {
  if (item.type !== 'story') return 'n/a';
  if (item.status === 'done') return 'complete';

  const labels = item.labels ?? [];
  const baDone = labels.includes('lifecycle:ba_done');
  const pmDone = labels.includes('lifecycle:pm_done');
  const atomic = labels.includes('lifecycle:atomic');

  if (!baDone) return 'ba_pending';
  if (!pmDone) return 'pm_pending';
  if (atomic || pmDone) return 'dev_ready';
  return 'tracking';
}

export function lifecyclePhaseLabel(phase: StoryLifecyclePhase): string {
  return LIFECYCLE_PHASE_LABEL[phase];
}

export function lifecyclePhaseShort(phase: StoryLifecyclePhase): string | null {
  return LIFECYCLE_PHASE_SHORT[phase];
}

/** Card/detail chip for stories still in BA→PM→dev lifecycle. */
export function workItemLifecycleChip(item: WorkItem): {
  phase: StoryLifecyclePhase;
  short: string;
  label: string;
} | null {
  const phase = getWorkItemLifecyclePhase(item);
  const short = lifecyclePhaseShort(phase);
  if (!short) return null;
  return { phase, short, label: lifecyclePhaseLabel(phase) };
}

export function agentHistoryRoleLabel(role: AgentHistoryRole): string {
  if (role === 'unknown') return 'Agent';
  return AGENT_ROLE_LABELS[role];
}

/** Map activity rows to a role for the multi-agent timeline. */
export function inferActivityRole(activity: WorkItemActivity): AgentHistoryRole {
  const event = metaString(activity, 'event') ?? '';
  const phase = metaString(activity, 'pipelinePhase') ?? '';
  const summary = activity.summary.toLowerCase();

  if (
    event === 'lifecycle_ba_complete' ||
    event === 'lifecycle_recover_ba' ||
    (event === 'full_lifecycle_start' && summary.includes('business analyst')) ||
    (event === 'shift_lifecycle_start' && summary.includes('business analyst'))
  ) {
    return 'business_analyst';
  }
  if (
    event === 'lifecycle_pm_complete' ||
    (event === 'full_lifecycle_start' && summary.includes('project manager')) ||
    (event === 'shift_lifecycle_start' && summary.includes('project manager'))
  ) {
    return 'project_manager';
  }
  if (event === 'full_lifecycle_pipeline_queued') {
    return 'developer';
  }

  if (phase === 'implementation') return 'developer';
  if (phase === 'testing') return 'tester';
  if (phase === 'review') return 'reviewer';
  if (phase === 'planning') {
    if (summary.includes('business analyst') || summary.includes('requirements')) {
      return 'business_analyst';
    }
    return 'project_manager';
  }

  if (summary.includes('scrum master')) return 'scrum_master';
  if (summary.includes('business analyst')) return 'business_analyst';
  if (summary.includes('project manager')) return 'project_manager';
  if (/\breview(er|ed|ing)?\b/.test(summary) || summary.includes('changes_requested') || summary.includes('approved')) {
    return 'reviewer';
  }
  if (/\btest(er|ing|s)?\b/.test(summary) || summary.includes('validation')) {
    return 'tester';
  }
  if (
    activity.activityType === 'agent_started' ||
    activity.activityType === 'agent_completed' ||
    activity.activityType === 'agent_failed' ||
    event === 'agent_queued' ||
    event === 'pipeline_enqueued' ||
    event === 'proactive_pipeline_enqueued'
  ) {
    return 'developer';
  }

  return 'unknown';
}

function inferActivityStatus(activity: WorkItemActivity): AgentHistoryStatus {
  const event = metaString(activity, 'event') ?? '';

  if (activity.activityType === 'agent_failed') return 'failed';
  if (activity.activityType === 'agent_completed') return 'completed';
  if (activity.activityType === 'agent_started') return 'running';

  if (
    event === 'agent_queued' ||
    event === 'shift_lifecycle_start' ||
    event === 'pipeline_enqueued' ||
    event === 'proactive_pipeline_enqueued' ||
    event === 'full_lifecycle_start' ||
    event === 'full_lifecycle_pipeline_queued'
  ) {
    return 'queued';
  }

  if (
    event === 'lifecycle_ba_complete' ||
    event === 'lifecycle_pm_complete' ||
    event === 'lifecycle_recover_ba' ||
    event === 'loop_iteration_completed'
  ) {
    return 'completed';
  }

  return 'info';
}

/** Whether this activity should appear on the agent history timeline. */
export function isAgentHistoryActivity(activity: WorkItemActivity): boolean {
  if (
    activity.activityType === 'agent_started' ||
    activity.activityType === 'agent_completed' ||
    activity.activityType === 'agent_failed'
  ) {
    return true;
  }

  const event = metaString(activity, 'event');
  if (!event) {
    // Keep role-named comments (shift queue messages without event on older rows)
    const summary = activity.summary.toLowerCase();
    return (
      summary.includes('business analyst') ||
      summary.includes('project manager') ||
      summary.includes('scrum master') ||
      summary.includes('developer pipeline')
    );
  }

  return (
    event === 'agent_queued' ||
    event === 'shift_lifecycle_start' ||
    event === 'lifecycle_ba_complete' ||
    event === 'lifecycle_pm_complete' ||
    event === 'lifecycle_recover_ba' ||
    event === 'loop_iteration_completed' ||
    event === 'pipeline_enqueued' ||
    event === 'proactive_pipeline_enqueued' ||
    event === 'full_lifecycle_start' ||
    event === 'full_lifecycle_pipeline_queued' ||
    event === 'full_lifecycle_chain_failed' ||
    event === 'full_lifecycle_no_pipeline_target'
  );
}

export function activityToHistoryEntry(activity: WorkItemActivity): AgentHistoryEntry {
  const content = metaString(activity, 'content');
  const error = metaString(activity, 'error');
  const workDir = metaString(activity, 'workDir');
  const phase = metaString(activity, 'pipelinePhase');
  const event = metaString(activity, 'event');
  const loopIteration =
    metaNumber(activity, 'loopIteration') ?? metaNumber(activity, 'iteration');

  return {
    id: activity.id,
    role: inferActivityRole(activity),
    status: inferActivityStatus(activity),
    agentType:
      (activity.metadata?.agentType as AgentType | undefined) || activity.agentType,
    agentId: activity.agentId,
    summary: activity.summary,
    timestamp: activity.createdAt,
    loopIteration,
    phase,
    auditId: activity.auditId,
    content,
    error,
    workDir,
    event,
    activityType: activity.activityType,
  };
}

/**
 * Pair agent_started with later completed/failed so the timeline does not leave
 * stale "running" rows after a step finishes.
 */
export function resolveRunningEntries(
  entries: AgentHistoryEntry[],
  options: { isBusy: boolean; loopStatus?: LoopStatus }
): AgentHistoryEntry[] {
  const sorted = [...entries].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const openKeys = new Map<string, number>();

  const keyFor = (entry: AgentHistoryEntry) =>
    `${entry.role}|${entry.phase ?? ''}|${entry.loopIteration ?? 0}|${entry.agentType ?? ''}`;

  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i]!;
    if (entry.status === 'running' && entry.activityType === 'agent_started') {
      openKeys.set(keyFor(entry), i);
      continue;
    }
    if (entry.status === 'completed' || entry.status === 'failed') {
      const key = keyFor(entry);
      const openIdx = openKeys.get(key);
      if (openIdx != null) {
        // Keep started as a distinct event but mark it completed once closed
        sorted[openIdx] = { ...sorted[openIdx]!, status: entry.status === 'failed' ? 'failed' : 'completed' };
        openKeys.delete(key);
      }
    }
  }

  // Any remaining open starts: still running only if item is busy
  for (const idx of openKeys.values()) {
    const entry = sorted[idx]!;
    if (!options.isBusy && options.loopStatus !== 'running') {
      sorted[idx] = { ...entry, status: 'info' };
    } else {
      sorted[idx] = { ...entry, status: 'running' };
    }
  }

  return sorted;
}

export function buildRoleSnapshots(
  entries: AgentHistoryEntry[],
  options: { isBusy: boolean; loopStatus?: LoopStatus } = { isBusy: false }
): AgentRoleSnapshot[] {
  const latestByRole = new Map<AgentHistoryRole, AgentHistoryEntry>();

  for (const entry of entries) {
    if (entry.role === 'unknown') continue;
    const prev = latestByRole.get(entry.role);
    if (!prev || new Date(entry.timestamp) >= new Date(prev.timestamp)) {
      latestByRole.set(entry.role, entry);
    }
  }

  // Prefer the most recent non-info status when a role has both start+complete
  const roles = ROLE_ORDER.filter((role) => role !== 'unknown');
  return roles.map((role) => {
    const latest = latestByRole.get(role);
    if (!latest) {
      return {
        role,
        label: agentHistoryRoleLabel(role),
        status: 'idle' as const,
      };
    }

    let status: AgentHistoryStatus | 'idle' = latest.status;
    if (
      status === 'running' &&
      !options.isBusy &&
      options.loopStatus !== 'running'
    ) {
      status = 'info';
    }

    return {
      role,
      label: agentHistoryRoleLabel(role),
      status,
      agentType: latest.agentType,
      agentId: latest.agentId,
      summary: latest.summary,
      timestamp: latest.timestamp,
      loopIteration: latest.loopIteration,
      auditId: latest.auditId,
    };
  });
}

export interface BuildAgentHistoryInput {
  workItem: WorkItem;
  activity?: WorkItemActivity[] | null;
  loopHistory?: WorkItemLoopHistory | null;
  isBusy?: boolean;
  /** Optional display names keyed by agent id */
  agentNames?: Record<string, string>;
}

/** Build the full agent-history model for a work item detail panel. */
export function buildWorkItemAgentHistory(input: BuildAgentHistoryInput): WorkItemAgentHistoryModel {
  const { workItem, activity, loopHistory, isBusy = false } = input;
  const phase = getWorkItemLifecyclePhase(workItem);

  const rawEntries = (activity ?? [])
    .filter(isAgentHistoryActivity)
    .map(activityToHistoryEntry);

  const entries = resolveRunningEntries(rawEntries, {
    isBusy,
    loopStatus: workItem.loopStatus,
  });

  // Enrich from loop history when activity is sparse (verdict-only rows)
  if (loopHistory?.iterations?.length) {
    for (const iter of loopHistory.iterations) {
      const hasIter = entries.some(
        (e) => e.loopIteration === iter.iteration && e.event === 'loop_iteration_completed'
      );
      if (hasIter) continue;
      entries.push({
        id: `loop-iter-${iter.id}`,
        role: 'reviewer',
        status: iter.completedAt ? 'completed' : isBusy ? 'running' : 'info',
        summary: `Loop iteration ${iter.iteration}: ${iter.verdict ?? 'in progress'}`,
        timestamp: iter.completedAt ?? iter.startedAt,
        loopIteration: iter.iteration,
        auditId: iter.reviewAuditId ?? iter.implementAuditId,
        event: 'loop_iteration_completed',
        activityType: 'comment',
      });
    }
    entries.sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }

  const roleSnapshots = buildRoleSnapshots(entries, {
    isBusy,
    loopStatus: workItem.loopStatus,
  });

  return {
    phase,
    phaseLabel: lifecyclePhaseLabel(phase),
    entries: [...entries].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    ),
    roleSnapshots,
    loopStatus: workItem.loopStatus,
    loopIteration: workItem.loopIteration,
    maxLoopIterations: workItem.maxLoopIterations,
  };
}

export const AGENT_HISTORY_STATUS_LABEL: Record<AgentHistoryStatus | 'idle', string> = {
  idle: 'Idle',
  queued: 'Queued',
  running: 'Working',
  completed: 'Done',
  failed: 'Failed',
  info: 'Noted',
};
