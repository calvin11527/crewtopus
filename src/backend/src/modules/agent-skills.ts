import type { AgentRole } from '../types';
import { registerCapability } from './capability-registry';

export interface AgentSkillDefinition {
  id: string;
  label: string;
  description: string;
  domain: string;
  suggestedRoles: AgentRole[];
}

/** Curated elite skills — top-tier capabilities per discipline. */
export const AGENT_SKILL_CATALOG: AgentSkillDefinition[] = [
  // Agile & delivery leadership
  { id: 'sprint-facilitation', label: 'Sprint facilitation', description: 'Elite Scrum ceremonies, flow metrics, and team cadence design', domain: 'Agile leadership', suggestedRoles: ['scrum_master', 'project_manager'] },
  { id: 'impediment-removal', label: 'Impediment removal', description: 'Rapid blocker triage and cross-functional escalation', domain: 'Agile leadership', suggestedRoles: ['scrum_master'] },
  { id: 'velocity-forecasting', label: 'Velocity forecasting', description: 'Probabilistic sprint forecasting and capacity modeling', domain: 'Agile leadership', suggestedRoles: ['scrum_master', 'project_manager'] },
  { id: 'backlog-grooming', label: 'Backlog grooming', description: 'INVEST stories, slicing epics, and priority trade-offs', domain: 'Agile leadership', suggestedRoles: ['scrum_master', 'business_analyst'] },
  // Project management
  { id: 'scope-management', label: 'Scope management', description: 'Scope baselines, change control, and deferral decisions', domain: 'Project management', suggestedRoles: ['project_manager'] },
  { id: 'raid-log', label: 'RAID log ownership', description: 'Risks, assumptions, issues, and dependencies tracking', domain: 'Project management', suggestedRoles: ['project_manager'] },
  { id: 'milestone-planning', label: 'Milestone planning', description: 'Critical path, release trains, and go-live readiness', domain: 'Project management', suggestedRoles: ['project_manager'] },
  { id: 'executive-reporting', label: 'Executive reporting', description: 'Status narratives, KPI dashboards, and stakeholder briefings', domain: 'Project management', suggestedRoles: ['project_manager'] },
  { id: 'cross-team-coordination', label: 'Cross-team coordination', description: 'Dependency mapping across squads and vendors', domain: 'Project management', suggestedRoles: ['project_manager', 'scrum_master'] },
  // Business analysis
  { id: 'requirements-elicitation', label: 'Requirements elicitation', description: 'Structured interviews, workshops, and context discovery', domain: 'Business analysis', suggestedRoles: ['business_analyst'] },
  { id: 'user-story-mapping', label: 'User story mapping', description: 'Journey maps, story maps, and MVP slicing', domain: 'Business analysis', suggestedRoles: ['business_analyst'] },
  { id: 'process-modeling', label: 'Process modeling (BPMN)', description: 'As-is/to-be flows and operational hand-offs', domain: 'Business analysis', suggestedRoles: ['business_analyst'] },
  { id: 'acceptance-criteria', label: 'Acceptance criteria authoring', description: 'Testable Given/When/Then and definition-of-done', domain: 'Business analysis', suggestedRoles: ['business_analyst', 'tester'] },
  { id: 'gap-analysis', label: 'Gap analysis', description: 'Current vs target state with remediation options', domain: 'Business analysis', suggestedRoles: ['business_analyst'] },
  // Engineering
  { id: 'system-design', label: 'System design', description: 'Distributed systems, boundaries, and trade-off docs', domain: 'Engineering', suggestedRoles: ['developer', 'custom'] },
  { id: 'api-contract-design', label: 'API contract design', description: 'OpenAPI/GraphQL contracts and versioning strategy', domain: 'Engineering', suggestedRoles: ['developer'] },
  { id: 'full-stack-implementation', label: 'Full-stack implementation', description: 'Production-grade features across UI, API, and data', domain: 'Engineering', suggestedRoles: ['developer'] },
  { id: 'performance-optimization', label: 'Performance optimization', description: 'Profiling, caching, and latency budgets', domain: 'Engineering', suggestedRoles: ['developer'] },
  { id: 'refactoring-at-scale', label: 'Refactoring at scale', description: 'Safe large-scale code migration and strangler patterns', domain: 'Engineering', suggestedRoles: ['developer', 'reviewer'] },
  // Quality
  { id: 'test-strategy', label: 'Test strategy design', description: 'Risk-based test pyramids and quality gates', domain: 'Quality assurance', suggestedRoles: ['tester'] },
  { id: 'e2e-automation', label: 'E2E automation', description: 'Playwright/Cypress suites with CI integration', domain: 'Quality assurance', suggestedRoles: ['tester'] },
  { id: 'load-stress-testing', label: 'Load & stress testing', description: 'Capacity limits, soak tests, and SLO validation', domain: 'Quality assurance', suggestedRoles: ['tester'] },
  { id: 'exploratory-testing', label: 'Exploratory testing', description: 'Charters, edge cases, and adversarial scenarios', domain: 'Quality assurance', suggestedRoles: ['tester'] },
  // Review & security
  { id: 'security-review', label: 'Security review', description: 'OWASP-oriented code and design review', domain: 'Review & security', suggestedRoles: ['reviewer'] },
  { id: 'architecture-review', label: 'Architecture review', description: 'Scalability, coupling, and operability assessment', domain: 'Review & security', suggestedRoles: ['reviewer'] },
  { id: 'threat-modeling', label: 'Threat modeling', description: 'STRIDE/LINDDUN threat surfaces and mitigations', domain: 'Review & security', suggestedRoles: ['reviewer'] },
  { id: 'compliance-audit', label: 'Compliance audit', description: 'SOC2/GDPR control mapping and evidence review', domain: 'Review & security', suggestedRoles: ['reviewer', 'business_analyst'] },
  // Research & analysis
  { id: 'technical-research', label: 'Technical research', description: 'Deep dives, PoCs, and build-vs-buy analysis', domain: 'Research & analysis', suggestedRoles: ['custom', 'developer'] },
  { id: 'data-analysis', label: 'Data analysis', description: 'Metrics, funnels, and experiment interpretation', domain: 'Research & analysis', suggestedRoles: ['business_analyst', 'custom'] },
  { id: 'root-cause-analysis', label: 'Root cause analysis', description: 'Five-whys, fault trees, and corrective actions', domain: 'Research & analysis', suggestedRoles: ['scrum_master', 'project_manager'] },
  // Agent orchestration
  { id: 'multi-agent-orchestration', label: 'Multi-agent orchestration', description: 'Role routing, hand-offs, and pipeline design', domain: 'Agent orchestration', suggestedRoles: ['custom', 'scrum_master'] },
  { id: 'context-engineering', label: 'Context engineering', description: 'Scopes, retrieval, and prompt-boundary hardening', domain: 'Agent orchestration', suggestedRoles: ['custom', 'developer'] },
  { id: 'eval-harness-design', label: 'Eval harness design', description: 'Verdict parsers, acceptance evals, and regression gates', domain: 'Agent orchestration', suggestedRoles: ['custom', 'tester'] },
];

export function listSkillCatalog(): AgentSkillDefinition[] {
  return AGENT_SKILL_CATALOG;
}

export function defaultSkillsForRole(role: AgentRole): string[] {
  return AGENT_SKILL_CATALOG.filter((s) => s.suggestedRoles.includes(role)).map((s) => s.id);
}

export function resolveSkillDefinition(skillId: string): AgentSkillDefinition | undefined {
  return AGENT_SKILL_CATALOG.find((s) => s.id === skillId);
}

export function validateSkillIds(skillIds: string[]): string[] {
  const valid = new Set(AGENT_SKILL_CATALOG.map((s) => s.id));
  const unknown = skillIds.filter((id) => !valid.has(id));
  if (unknown.length > 0) {
    throw new Error(`Unknown skills: ${unknown.join(', ')}`);
  }
  return skillIds;
}

/** Register hired skills as agent capabilities for routing and display. */
export function attachSkillsAsCapabilities(agentId: string, skillIds: string[]): void {
  for (const skillId of skillIds) {
    const skill = resolveSkillDefinition(skillId);
    registerCapability(agentId, skillId, skill?.description ?? skill?.label ?? skillId);
  }
}