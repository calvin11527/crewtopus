import { listAgents, updateAgentConfig } from '../modules/agent-registry';
import {
  parseEffortLevel,
  resolveAgentEffort,
  resolveAlwaysApprove,
  validateAlwaysApproveConfig,
  validateEffortConfig,
} from '../modules/agent-run-options';

describe('agent-run-options', () => {
  it('parses supported effort levels', () => {
    expect(parseEffortLevel('high')).toBe('high');
    expect(parseEffortLevel('xhigh')).toBe('xhigh');
    expect(parseEffortLevel('nope')).toBeUndefined();
    expect(parseEffortLevel('')).toBeUndefined();
  });

  it('resolves effort from agent config then env', () => {
    const grok = listAgents().find((a) => a.type === 'grok')!;
    updateAgentConfig(grok.id, { effort: 'low' });
    expect(resolveAgentEffort(grok.id, 'grok')).toBe('low');

    const previous = process.env.GROK_EFFORT;
    process.env.GROK_EFFORT = 'medium';
    const copilot = listAgents().find((a) => a.type === 'copilot')!;
    expect(resolveAgentEffort(undefined, 'grok')).toBe('medium');
    expect(resolveAgentEffort(copilot.id, 'copilot')).toBeUndefined();
    if (previous === undefined) delete process.env.GROK_EFFORT;
    else process.env.GROK_EFFORT = previous;
  });

  it('defaults grok always-approve on and others off unless configured', () => {
    const grok = listAgents().find((a) => a.type === 'grok')!;
    const copilot = listAgents().find((a) => a.type === 'copilot')!;
    expect(resolveAlwaysApprove(grok.id, 'grok')).toBe(true);
    expect(resolveAlwaysApprove(copilot.id, 'copilot')).toBe(false);

    updateAgentConfig(grok.id, { alwaysApprove: false });
    updateAgentConfig(copilot.id, { alwaysApprove: true });
    expect(resolveAlwaysApprove(grok.id, 'grok')).toBe(false);
    expect(resolveAlwaysApprove(copilot.id, 'copilot')).toBe(true);
  });

  it('validates config patches', () => {
    expect(validateEffortConfig('high')).toBeNull();
    expect(validateEffortConfig(null)).toBeNull();
    expect(validateEffortConfig('max')).toMatch(/effort must be one of/);
    expect(validateAlwaysApproveConfig(true)).toBeNull();
    expect(validateAlwaysApproveConfig('yes')).toMatch(/boolean/);
  });
});
