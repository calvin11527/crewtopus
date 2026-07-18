import { hireNewAgent, listRoster, terminateEmployment } from '../modules/agent-employment';
import { getCapabilitiesForAgent } from '../modules/capability-registry';
import { createWorkItem, buildWorkItemAgentPrompt } from '../modules/work-items';
import { defaultSkillsForRole, resolveSkillDefinition } from '../modules/agent-skills';

describe('Agent employment', () => {
  it('hires a new agent with role capabilities', () => {
    const roster = hireNewAgent({
      name: `Test Dev ${Date.now()}`,
      type: 'mock',
      role: 'developer',
      timezone: 'UTC',
    });

    expect(roster.employment?.role).toBe('developer');
    expect(roster.onShift).toBeDefined();
    const caps = getCapabilitiesForAgent(roster.id).map((c) => c.name);
    expect(caps).toContain('implementation');
  });

  it('lists hired agents in roster', () => {
    const before = listRoster().length;
    hireNewAgent({ name: `Roster ${Date.now()}`, type: 'mock', role: 'reviewer' });
    expect(listRoster().length).toBeGreaterThan(before);
  });

  it('hires project manager with default elite skills', () => {
    const roster = hireNewAgent({
      name: `PM ${Date.now()}`,
      type: 'mock',
      role: 'project_manager',
    });
    expect(roster.employment?.skills.length).toBeGreaterThan(0);
    expect(roster.employment?.skills).toContain('scope-management');
  });

  it('hires custom profile with explicit skills', () => {
    const roster = hireNewAgent({
      name: `Sec ${Date.now()}`,
      type: 'mock',
      role: 'custom',
      customRoleLabel: 'Security Architect',
      profileDescription: 'Owns threat modeling and security reviews.',
      skills: ['threat-modeling', 'security-review'],
    });
    expect(roster.employment?.customRoleLabel).toBe('Security Architect');
    const caps = getCapabilitiesForAgent(roster.id).map((c) => c.name);
    expect(caps).toContain('threat-modeling');
  });

  it('injects hired developer skills into work item prompts', () => {
    const roster = hireNewAgent({
      name: `Prompt Dev ${Date.now()}`,
      type: 'mock',
      role: 'developer',
    });
    const item = createWorkItem({
      type: 'task',
      title: 'Build feature',
      assignedAgentId: roster.id,
      assignedAgentType: 'mock',
    });

    const prompt = buildWorkItemAgentPrompt(item, '', '/tmp/work');
    expect(prompt).toContain('## Agent skills');
    const skillLabels = defaultSkillsForRole('developer')
      .map((id) => resolveSkillDefinition(id)?.label)
      .filter(Boolean);
    expect(skillLabels.some((label) => prompt.includes(label!))).toBe(true);
  });

  it('terminates employment', () => {
    const roster = hireNewAgent({ name: `Term ${Date.now()}`, type: 'mock', role: 'tester' });
    const terminated = terminateEmployment(roster.id);
    expect(terminated.employmentStatus).toBe('terminated');
    expect(listRoster().some((r) => r.id === roster.id)).toBe(false);
  });
});