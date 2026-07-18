import { defaultWorkingHours, employmentsConflict, isOnShift } from '../modules/shift-utils';
import type { AgentEmployment } from '../types';

function employment(overrides: Partial<AgentEmployment> = {}): AgentEmployment {
  return {
    agentId: 'a1',
    role: 'developer',
    employmentStatus: 'active',
    timezone: 'UTC',
    workingHours: defaultWorkingHours(),
    hiredAt: '2026-01-01T00:00:00Z',
    skills: [],
    ...overrides,
  };
}

describe('shift-utils', () => {
  it('detects on-shift inside default weekday window', () => {
    const wed10am = new Date('2026-06-03T10:30:00Z');
    expect(isOnShift(employment(), wed10am)).toBe(true);
  });

  it('detects off-shift on weekends', () => {
    const sunday = new Date('2026-06-07T10:30:00Z');
    expect(isOnShift(employment(), sunday)).toBe(false);
  });

  it('detects off-shift when employment is on leave', () => {
    const wed = new Date('2026-06-03T10:30:00Z');
    expect(isOnShift(employment({ employmentStatus: 'on_leave' }), wed)).toBe(false);
  });

  it('detects overlapping schedules between employments', () => {
    const a = employment({ workingHours: [{ dow: [1, 2, 3], start: '09:00', end: '12:00' }] });
    const b = employment({
      agentId: 'a2',
      workingHours: [{ dow: [1, 2, 3], start: '11:00', end: '14:00' }],
    });
    expect(employmentsConflict(a, b)).toBe(true);
  });

  it('allows non-overlapping schedules', () => {
    const a = employment({ workingHours: [{ dow: [1], start: '09:00', end: '12:00' }] });
    const b = employment({
      agentId: 'a2',
      workingHours: [{ dow: [1], start: '13:00', end: '17:00' }],
    });
    expect(employmentsConflict(a, b)).toBe(false);
  });
});