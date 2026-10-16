import {
  clampLoopIterations,
  DEFAULT_MAX_LOOP_ITERATIONS,
  explicitLoopIterations,
  MAX_USER_LOOP_ITERATIONS,
  resolveLoopIterations,
} from '../types';

describe('loop pass cap', () => {
  it('defaults to a single automatic pass', () => {
    expect(DEFAULT_MAX_LOOP_ITERATIONS).toBe(1);
    expect(MAX_USER_LOOP_ITERATIONS).toBe(3);
    expect(resolveLoopIterations({})).toBe(1);
  });

  it('lets a person raise the cap to 3 and no higher', () => {
    expect(clampLoopIterations(2)).toBe(2);
    expect(clampLoopIterations(3)).toBe(3);
    expect(clampLoopIterations(4)).toBe(3);
    expect(clampLoopIterations(0)).toBe(1);
    expect(clampLoopIterations('9')).toBe(3);
  });

  it('prefers an explicit request, then the work item, then the template', () => {
    expect(
      resolveLoopIterations({ explicit: 2, workItemMax: 1, loopMax: 3 })
    ).toBe(2);
    expect(resolveLoopIterations({ workItemMax: 3, loopMax: 1 })).toBe(3);
    expect(resolveLoopIterations({ loopMax: 3 })).toBe(3);
    expect(resolveLoopIterations({ workItemMax: 1, loopMax: 3 })).toBe(1);
  });

  it('omits an unset cap so callers do not override the saved setting', () => {
    expect(explicitLoopIterations(undefined)).toEqual({});
    expect(explicitLoopIterations(3)).toEqual({ maxIterations: 3 });
    expect(explicitLoopIterations(8)).toEqual({ maxIterations: 3 });
  });
});
