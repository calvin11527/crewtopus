import type { AgentRole } from '../types';

export const AGENT_ROLE_LABELS: Record<AgentRole, string> = {
  scrum_master: 'Scrum Master',
  project_manager: 'Project Manager',
  business_analyst: 'Business Analyst',
  developer: 'Developer',
  tester: 'Tester',
  reviewer: 'Reviewer',
  custom: 'Custom profile',
};

export const STAFF_ROLES: AgentRole[] = [
  'scrum_master',
  'project_manager',
  'business_analyst',
  'developer',
  'tester',
  'reviewer',
];

export function emptyStaffDraft(): Record<AgentRole, string> {
  return {
    scrum_master: '',
    project_manager: '',
    business_analyst: '',
    developer: '',
    tester: '',
    reviewer: '',
    custom: '',
  };
}