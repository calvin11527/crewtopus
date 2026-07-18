import { getDatabase } from '../database';
import type {
  Agent,
  AgentRole,
  AgentType,
  SprintAutomation,
  SprintAutomationMode,
  SprintAutomationPauseReason,
  SprintTeamMember,
  SprintTeamView,
} from '../types';
import { generateId, now } from '../utils/helpers';
import { broadcast } from '../websocket';
import { getAgent, listAgents } from './agent-registry';
import { assertValidRole, getEmployment } from './agent-employment';
import { isOnShift } from './shift-utils';
import { getSprint, listWorkItems } from './work-items';
import { hasActiveLoopJobForWorkItem } from './job-queue';

interface TeamMemberRow {
  id: string;
  sprint_id: string;
  agent_id: string;
  role: string;
  priority: number;
  automation_enabled: number;
  created_at: string;
}

interface AutomationRow {
  sprint_id: string;
  mode: string;
  last_tick_at: string | null;
  paused_reason: string | null;
  active_queue_id: string | null;
}

const ROLE_DEFAULT_TYPES: Record<AgentRole, AgentType> = {
  scrum_master: 'claude',
  project_manager: 'claude',
  business_analyst: 'claude',
  developer: 'grok',
  tester: 'copilot',
  reviewer: 'copilot',
  custom: 'grok',
};

function mapTeamMember(row: TeamMemberRow): SprintTeamMember {
  return {
    id: row.id,
    sprintId: row.sprint_id,
    agentId: row.agent_id,
    role: row.role as AgentRole,
    priority: row.priority,
    automationEnabled: row.automation_enabled === 1,
    createdAt: row.created_at,
  };
}

function mapAutomation(row: AutomationRow): SprintAutomation {
  return {
    sprintId: row.sprint_id,
    mode: row.mode as SprintAutomationMode,
    lastTickAt: row.last_tick_at ?? undefined,
    pausedReason: (row.paused_reason as SprintAutomationPauseReason) ?? null,
    activeQueueId: row.active_queue_id ?? undefined,
  };
}

function ensureAutomationRow(sprintId: string): SprintAutomation {
  const existing = getSprintAutomation(sprintId);
  if (existing) return existing;

  getDatabase()
    .prepare(
      `INSERT INTO sprint_automation (sprint_id, mode, paused_reason) VALUES (?, 'paused', 'manual')`
    )
    .run(sprintId);

  return getSprintAutomation(sprintId)!;
}

export function getSprintAutomation(sprintId: string): SprintAutomation | null {
  const row = getDatabase()
    .prepare('SELECT * FROM sprint_automation WHERE sprint_id = ?')
    .get(sprintId) as AutomationRow | undefined;
  return row ? mapAutomation(row) : null;
}

export function setSprintAutomationMode(
  sprintId: string,
  mode: SprintAutomationMode
): SprintAutomation {
  if (!getSprint(sprintId)) throw new Error('Sprint not found');
  ensureAutomationRow(sprintId);

  getDatabase()
    .prepare(
      `UPDATE sprint_automation SET mode = ?, paused_reason = ? WHERE sprint_id = ?`
    )
    .run(mode, mode === 'paused' ? 'manual' : null, sprintId);

  const automation = getSprintAutomation(sprintId)!;
  broadcast({
    type: 'sprint_automation:status',
    payload: { sprintId, mode: automation.mode, pausedReason: automation.pausedReason },
    timestamp: now(),
  });
  return automation;
}

export function updateSprintAutomationState(
  sprintId: string,
  patch: Partial<Pick<SprintAutomation, 'lastTickAt' | 'pausedReason' | 'activeQueueId'>>
): SprintAutomation {
  ensureAutomationRow(sprintId);
  const current = getSprintAutomation(sprintId)!;

  getDatabase()
    .prepare(
      `UPDATE sprint_automation SET last_tick_at = ?, paused_reason = ?, active_queue_id = ? WHERE sprint_id = ?`
    )
    .run(
      patch.lastTickAt ?? current.lastTickAt ?? null,
      patch.pausedReason !== undefined ? patch.pausedReason : current.pausedReason,
      patch.activeQueueId !== undefined ? patch.activeQueueId : current.activeQueueId ?? null,
      sprintId
    );

  return getSprintAutomation(sprintId)!;
}

export interface SprintTeamMemberInput {
  agentId: string;
  role: AgentRole;
  priority?: number;
  automationEnabled?: boolean;
}

export function detectStaffingConflicts(
  sprintId: string,
  members: SprintTeamMemberInput[]
): string[] {
  const conflicts: string[] = [];
  const seenAgents = new Map<string, AgentRole>();

  for (const member of members) {
    const emp = getEmployment(member.agentId);
    if (!emp) {
      conflicts.push(`Agent ${member.agentId} is not hired`);
      continue;
    }

    const priorRole = seenAgents.get(member.agentId);
    if (priorRole) {
      conflicts.push(
        `${emp.displayTitle ?? member.agentId} cannot fill both ${priorRole} and ${member.role} on this sprint`
      );
      continue;
    }
    seenAgents.set(member.agentId, member.role);

    const otherSprints = getDatabase()
      .prepare(
        `SELECT stm.sprint_id, s.name AS sprint_name
         FROM sprint_team_member stm
         JOIN sprint s ON s.id = stm.sprint_id
         WHERE stm.agent_id = ? AND stm.sprint_id != ?`
      )
      .all(member.agentId, sprintId) as Array<{ sprint_id: string; sprint_name: string }>;

    for (const other of otherSprints) {
      conflicts.push(
        `${emp.displayTitle ?? member.agentId} is already staffed on sprint "${other.sprint_name}" — remove them there first or use a different agent`
      );
    }
  }

  return conflicts;
}

export function setSprintTeam(
  sprintId: string,
  members: SprintTeamMemberInput[],
  options: { allowConflicts?: boolean } = {}
): SprintTeamView {
  if (!getSprint(sprintId)) throw new Error('Sprint not found');

  const conflicts = detectStaffingConflicts(sprintId, members);
  if (conflicts.length > 0 && !options.allowConflicts) {
    throw new Error(conflicts.join('; '));
  }

  const db = getDatabase();
  const replace = db.transaction(() => {
    db.prepare('DELETE FROM sprint_team_member WHERE sprint_id = ?').run(sprintId);
    const timestamp = now();
    for (const m of members) {
      const role = assertValidRole(m.role);
      db.prepare(
        `INSERT INTO sprint_team_member (id, sprint_id, agent_id, role, priority, automation_enabled, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        generateId(),
        sprintId,
        m.agentId,
        role,
        m.priority ?? 0,
        m.automationEnabled !== false ? 1 : 0,
        timestamp
      );
    }
  });
  replace();

  ensureAutomationRow(sprintId);
  return getSprintTeamView(sprintId);
}

export function listSprintTeamMembers(sprintId: string): SprintTeamMember[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM sprint_team_member WHERE sprint_id = ? ORDER BY priority DESC, role ASC')
    .all(sprintId) as TeamMemberRow[];
  return rows.map(mapTeamMember);
}

export function getSprintTeamMemberByRole(
  sprintId: string,
  role: AgentRole
): SprintTeamMember | null {
  const row = getDatabase()
    .prepare('SELECT * FROM sprint_team_member WHERE sprint_id = ? AND role = ?')
    .get(sprintId, role) as TeamMemberRow | undefined;
  return row ? mapTeamMember(row) : null;
}

export function getSprintTeamView(sprintId: string, at: Date = new Date()): SprintTeamView {
  const members = listSprintTeamMembers(sprintId).map((m) => {
    const agent = getAgent(m.agentId);
    const employment = getEmployment(m.agentId);
    return {
      ...m,
      agentName: agent?.name ?? m.agentId,
      agentType: agent?.type ?? ('mock' as AgentType),
      onShift: employment ? isOnShift(employment, at) : false,
    };
  });

  return {
    sprintId,
    members,
    conflicts: detectStaffingConflicts(
      sprintId,
      members.map((m) => ({ agentId: m.agentId, role: m.role }))
    ),
    automation: ensureAutomationRow(sprintId),
  };
}

/** Resolve staffed agent for a sprint role, with global type fallback. */
export function resolveSprintAgent(
  sprintId: string | undefined,
  role: AgentRole
): Agent | null {
  if (sprintId) {
    const member = getSprintTeamMemberByRole(sprintId, role);
    if (member) {
      const agent = getAgent(member.agentId);
      if (agent?.enabled) return agent;
    }
  }

  const fallbackType = ROLE_DEFAULT_TYPES[role];
  return listAgents().find((a) => a.type === fallbackType && a.enabled) ?? null;
}

export function isSprintRoleOnShift(
  sprintId: string,
  role: AgentRole,
  at: Date = new Date()
): boolean {
  const member = getSprintTeamMemberByRole(sprintId, role);
  if (!member || !member.automationEnabled) return false;
  const employment = getEmployment(member.agentId);
  if (!employment || employment.employmentStatus !== 'active') return false;
  return isOnShift(employment, at);
}

export function sprintHasActiveWork(sprintId: string): boolean {
  const items = listWorkItems({ sprintId });

  for (const item of items) {
    if (hasActiveLoopJobForWorkItem(item.id)) return true;
    if (item.loopStatus === 'running') return true;
    if (item.status !== 'in_progress') continue;

    if (item.type === 'story') {
      const children = listWorkItems({ parentId: item.id });
      const childBusy = children.some(
        (child) =>
          child.status === 'in_progress' ||
          child.loopStatus === 'running' ||
          hasActiveLoopJobForWorkItem(child.id)
      );
      if (!childBusy) continue;
    }

    return true;
  }

  return false;
}

export interface SprintAutomationStatus {
  sprintId: string;
  automation: SprintAutomation;
  team: SprintTeamView;
  onShiftRoles: AgentRole[];
  queueRunning: boolean;
}

export function getSprintAutomationStatus(sprintId: string, at: Date = new Date()): SprintAutomationStatus {
  const team = getSprintTeamView(sprintId, at);
  const onShiftRoles = team.members.filter((m) => m.onShift).map((m) => m.role);
  const automation = team.automation;

  return {
    sprintId,
    automation,
    team,
    onShiftRoles,
    queueRunning: Boolean(automation.activeQueueId),
  };
}