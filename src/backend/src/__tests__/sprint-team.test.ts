import { createSprint } from '../modules/work-items';
import { hireNewAgent } from '../modules/agent-employment';
import { getSprintTeamView, setSprintTeam } from '../modules/sprint-team';

describe('Sprint team staffing', () => {
  it('staffs a sprint with hired agents', () => {
    const sprint = createSprint(`Team sprint ${Date.now()}`, { status: 'active' });
    const dev = hireNewAgent({
      name: `Dev ${Date.now()}`,
      type: 'mock',
      role: 'developer',
      workingHours: [{ dow: [1], start: '09:00', end: '12:00' }],
    });
    const reviewer = hireNewAgent({
      name: `Rev ${Date.now()}`,
      type: 'mock',
      role: 'reviewer',
      workingHours: [{ dow: [1], start: '13:00', end: '17:00' }],
    });

    const view = setSprintTeam(sprint.id, [
      { agentId: dev.id, role: 'developer' },
      { agentId: reviewer.id, role: 'reviewer' },
    ]);

    expect(view.members).toHaveLength(2);
    expect(getSprintTeamView(sprint.id).members.map((m) => m.role).sort()).toEqual([
      'developer',
      'reviewer',
    ]);
  });

  it('allows multiple roles with overlapping working hours on the same sprint', () => {
    const sprint = createSprint(`Overlap sprint ${Date.now()}`, { status: 'active' });
    const hours = [{ dow: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' }];
    const scrum = hireNewAgent({ name: `SM ${Date.now()}`, type: 'mock', role: 'scrum_master', workingHours: hours });
    const dev = hireNewAgent({ name: `Dev2 ${Date.now()}`, type: 'mock', role: 'developer', workingHours: hours });
    const tester = hireNewAgent({ name: `QA ${Date.now()}`, type: 'mock', role: 'tester', workingHours: hours });

    const view = setSprintTeam(sprint.id, [
      { agentId: scrum.id, role: 'scrum_master' },
      { agentId: dev.id, role: 'developer' },
      { agentId: tester.id, role: 'tester' },
    ]);

    expect(view.conflicts).toHaveLength(0);
    expect(view.members).toHaveLength(3);
  });
});