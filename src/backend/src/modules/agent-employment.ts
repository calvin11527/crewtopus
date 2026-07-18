import { getDatabase } from '../database';
import type {
  Agent,
  AgentEmployment,
  AgentRole,
  AgentType,
  EmploymentStatus,
  RosterAgent,
  WorkingHoursBlock,
} from '../types';
import { now, parseJson } from '../utils/helpers';
import { getAgent, listAgents, registerAgent } from './agent-registry';
import { registerCapability } from './capability-registry';
import {
  attachSkillsAsCapabilities,
  defaultSkillsForRole,
  validateSkillIds,
} from './agent-skills';
import { defaultWorkingHours, formatShiftWindow, isOnShift } from './shift-utils';

interface EmploymentRow {
  agent_id: string;
  display_title: string | null;
  role: string;
  custom_role_label: string | null;
  profile_description: string | null;
  skills: string | null;
  employment_status: string;
  timezone: string;
  working_hours: string;
  hired_at: string;
  notes: string | null;
}

export const ROLE_CAPABILITIES: Record<AgentRole, Array<{ name: string; description: string }>> = {
  scrum_master: [{ name: 'planning', description: 'Sprint orchestration and standup' }],
  project_manager: [
    { name: 'planning', description: 'Program planning and milestone tracking' },
    { name: 'analysis', description: 'Risk and dependency analysis' },
  ],
  business_analyst: [
    { name: 'analysis', description: 'Requirements and process analysis' },
    { name: 'planning', description: 'Story mapping and backlog shaping' },
  ],
  developer: [{ name: 'implementation', description: 'Feature and task implementation' }],
  tester: [{ name: 'testing', description: 'Test execution and validation' }],
  reviewer: [{ name: 'review', description: 'Code and deliverable review' }],
  custom: [],
};

const VALID_ROLES: AgentRole[] = [
  'scrum_master',
  'project_manager',
  'business_analyst',
  'developer',
  'tester',
  'reviewer',
  'custom',
];

function mapEmployment(row: EmploymentRow): AgentEmployment {
  return {
    agentId: row.agent_id,
    displayTitle: row.display_title ?? undefined,
    role: row.role as AgentRole,
    customRoleLabel: row.custom_role_label ?? undefined,
    profileDescription: row.profile_description ?? undefined,
    skills: parseJson<string[]>(row.skills ?? '[]', []),
    employmentStatus: row.employment_status as EmploymentStatus,
    timezone: row.timezone,
    workingHours: parseJson<WorkingHoursBlock[]>(row.working_hours, []),
    hiredAt: row.hired_at,
    notes: row.notes ?? undefined,
  };
}

function attachRoleCapabilities(agentId: string, role: AgentRole): void {
  for (const cap of ROLE_CAPABILITIES[role]) {
    registerCapability(agentId, cap.name, cap.description);
  }
}

function resolveHireSkills(role: AgentRole, skills?: string[]): string[] {
  const resolved = skills?.length ? validateSkillIds(skills) : defaultSkillsForRole(role);
  if (role === 'custom' && resolved.length === 0) {
    throw new Error('Select at least one skill for a custom agent profile');
  }
  return resolved;
}

export interface HireAgentInput {
  name: string;
  type: AgentType;
  role: AgentRole;
  displayTitle?: string;
  customRoleLabel?: string;
  profileDescription?: string;
  skills?: string[];
  timezone?: string;
  workingHours?: WorkingHoursBlock[];
  notes?: string;
  config?: Record<string, unknown>;
}

export interface UpdateEmploymentInput {
  displayTitle?: string;
  role?: AgentRole;
  customRoleLabel?: string;
  profileDescription?: string;
  skills?: string[];
  employmentStatus?: EmploymentStatus;
  timezone?: string;
  workingHours?: WorkingHoursBlock[];
  notes?: string;
}

/** Register a new agent and create employment in one step. */
export function hireNewAgent(input: HireAgentInput): RosterAgent {
  const agent = registerAgent(input.name, input.type, input.config);
  return hireExistingAgent(agent.id, {
    role: input.role,
    displayTitle: input.displayTitle ?? input.name,
    customRoleLabel: input.customRoleLabel,
    profileDescription: input.profileDescription,
    skills: input.skills,
    timezone: input.timezone,
    workingHours: input.workingHours,
    notes: input.notes,
  });
}

/** Hire an existing registered agent. */
export function hireExistingAgent(
  agentId: string,
  input: Omit<HireAgentInput, 'name' | 'type' | 'config'> & { role: AgentRole }
): RosterAgent {
  const agent = getAgent(agentId);
  if (!agent) throw new Error('Agent not found');

  const existing = getEmployment(agentId);
  if (existing && existing.employmentStatus !== 'terminated') {
    throw new Error('Agent is already hired');
  }

  if (input.role === 'custom' && !input.customRoleLabel?.trim()) {
    throw new Error('customRoleLabel is required when role is custom');
  }

  const skills = resolveHireSkills(input.role, input.skills);
  const timestamp = now();
  const workingHours = input.workingHours ?? defaultWorkingHours();
  const timezone = input.timezone ?? 'UTC';

  getDatabase()
    .prepare(
      `INSERT INTO agent_employment (
         agent_id, display_title, role, custom_role_label, profile_description, skills,
         employment_status, timezone, working_hours, hired_at, notes
       )
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
       ON CONFLICT(agent_id) DO UPDATE SET
         display_title = excluded.display_title,
         role = excluded.role,
         custom_role_label = excluded.custom_role_label,
         profile_description = excluded.profile_description,
         skills = excluded.skills,
         employment_status = 'active',
         timezone = excluded.timezone,
         working_hours = excluded.working_hours,
         hired_at = excluded.hired_at,
         notes = excluded.notes`
    )
    .run(
      agentId,
      input.displayTitle ?? agent.name,
      input.role,
      input.customRoleLabel?.trim() ?? null,
      input.profileDescription?.trim() ?? null,
      JSON.stringify(skills),
      timezone,
      JSON.stringify(workingHours),
      timestamp,
      input.notes ?? null
    );

  attachRoleCapabilities(agentId, input.role);
  attachSkillsAsCapabilities(agentId, skills);
  return toRosterAgent(agent);
}

export function getEmployment(agentId: string): AgentEmployment | null {
  const row = getDatabase()
    .prepare('SELECT * FROM agent_employment WHERE agent_id = ?')
    .get(agentId) as EmploymentRow | undefined;
  return row ? mapEmployment(row) : null;
}

export function updateEmployment(agentId: string, input: UpdateEmploymentInput): AgentEmployment {
  const current = getEmployment(agentId);
  if (!current) throw new Error('Agent is not hired');

  const role = input.role ?? current.role;
  if (role === 'custom' && !(input.customRoleLabel ?? current.customRoleLabel)?.trim()) {
    throw new Error('customRoleLabel is required when role is custom');
  }

  const skills =
    input.skills != null
      ? resolveHireSkills(role, input.skills)
      : input.role && input.role !== current.role
        ? defaultSkillsForRole(role)
        : current.skills;

  if (input.role && input.role !== current.role) {
    attachRoleCapabilities(agentId, input.role);
    attachSkillsAsCapabilities(agentId, skills);
  } else if (input.skills) {
    attachSkillsAsCapabilities(agentId, skills);
  }

  getDatabase()
    .prepare(
      `UPDATE agent_employment SET
         display_title = ?,
         role = ?,
         custom_role_label = ?,
         profile_description = ?,
         skills = ?,
         employment_status = ?,
         timezone = ?,
         working_hours = ?,
         notes = ?
       WHERE agent_id = ?`
    )
    .run(
      input.displayTitle ?? current.displayTitle ?? null,
      role,
      (input.customRoleLabel ?? current.customRoleLabel)?.trim() ?? null,
      (input.profileDescription ?? current.profileDescription)?.trim() ?? null,
      JSON.stringify(skills),
      input.employmentStatus ?? current.employmentStatus,
      input.timezone ?? current.timezone,
      JSON.stringify(input.workingHours ?? current.workingHours),
      input.notes ?? current.notes ?? null,
      agentId
    );

  return getEmployment(agentId)!;
}

export function terminateEmployment(agentId: string): AgentEmployment {
  return updateEmployment(agentId, { employmentStatus: 'terminated' });
}

export function listEmployedAgents(): AgentEmployment[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM agent_employment WHERE employment_status != ? ORDER BY hired_at ASC')
    .all('terminated') as EmploymentRow[];
  return rows.map(mapEmployment);
}

function listSprintAssignmentsForAgent(agentId: string): RosterAgent['sprintAssignments'] {
  const rows = getDatabase()
    .prepare(
      `SELECT stm.sprint_id, s.name AS sprint_name, stm.role
       FROM sprint_team_member stm
       JOIN sprint s ON s.id = stm.sprint_id
       WHERE stm.agent_id = ?`
    )
    .all(agentId) as Array<{ sprint_id: string; sprint_name: string; role: string }>;

  return rows.map((r) => ({
    sprintId: r.sprint_id,
    sprintName: r.sprint_name,
    role: r.role as AgentRole,
  }));
}

function toRosterAgent(agent: Agent, at: Date = new Date()): RosterAgent {
  const employment = getEmployment(agent.id);
  const assignments = listSprintAssignmentsForAgent(agent.id);
  return {
    ...agent,
    employment: employment ?? undefined,
    onShift: employment ? isOnShift(employment, at) : false,
    sprintAssignments: assignments,
  };
}

export function listRoster(at: Date = new Date()): RosterAgent[] {
  return listAgents()
    .map((agent) => toRosterAgent(agent, at))
    .filter((a) => a.employment && a.employment.employmentStatus !== 'terminated');
}

export function getRosterAgent(agentId: string): RosterAgent | null {
  const agent = getAgent(agentId);
  if (!agent) return null;
  return toRosterAgent(agent);
}

export function isAgentOnShift(agentId: string, at: Date = new Date()): boolean {
  const employment = getEmployment(agentId);
  if (!employment) return false;
  return isOnShift(employment, at);
}

export function describeAgentShift(agentId: string): string {
  const employment = getEmployment(agentId);
  if (!employment) return 'Not hired';
  return formatShiftWindow(employment);
}

export function assertValidRole(role: string): AgentRole {
  if (!VALID_ROLES.includes(role as AgentRole)) {
    throw new Error(`role must be one of: ${VALID_ROLES.join(', ')}`);
  }
  return role as AgentRole;
}