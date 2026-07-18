import {
  getAgent,
  listAgents,
  registerAgent,
  updateAgent,
  updateAgentStatus,
} from '../modules/agent-registry';
import {
  getCapabilitiesForAgent,
  registerCapability,
  syncCapabilitiesForAgentType,
} from '../modules/capability-registry';

describe('updateAgent type switch', () => {
  it('switches adapter type from copilot to grok and clears stale provider calibration', () => {
    const agent = registerAgent(`Switch Test ${Date.now()}`, 'copilot', {
      model: 'gpt-5.4',
      creditLimit: 5000,
      monthlyTokenQuota: 1_000_000,
      providerUsagePercent: 80,
      providerCalibrationTokens: 800_000,
    });

    const updated = updateAgent(agent.id, {
      type: 'grok',
      config: { model: 'grok-build' },
    });

    expect(updated).not.toBeNull();
    expect(updated!.type).toBe('grok');
    expect(updated!.config.model).toBe('grok-build');
    expect(updated!.config.creditLimit).toBe(5000);
    expect(updated!.config.monthlyTokenQuota).toBeUndefined();
    expect(updated!.config.providerUsagePercent).toBeUndefined();
    expect(updated!.config.providerCalibrationTokens).toBeUndefined();

    const reloaded = getAgent(agent.id);
    expect(reloaded?.type).toBe('grok');
    expect(reloaded?.config.model).toBe('grok-build');
  });

  it('blocks adapter type change while agent is running', () => {
    const agent = registerAgent(`Running Switch ${Date.now()}`, 'copilot');
    updateAgentStatus(agent.id, 'running');
    expect(() => updateAgent(agent.id, { type: 'grok' })).toThrow(/while this agent is running/i);
    expect(getAgent(agent.id)?.type).toBe('copilot');
    updateAgentStatus(agent.id, 'idle');
    const updated = updateAgent(agent.id, { type: 'grok' });
    expect(updated?.type).toBe('grok');
  });

  it('syncs capabilities when adapter type changes', () => {
    const agent = registerAgent(`Caps Test ${Date.now()}`, 'copilot');
    registerCapability(agent.id, 'implementation', 'Code implementation');
    expect(getCapabilitiesForAgent(agent.id).map((c) => c.name)).toContain('implementation');

    updateAgent(agent.id, { type: 'ollama' });
    syncCapabilitiesForAgentType(agent.id, 'ollama');

    const caps = getCapabilitiesForAgent(agent.id).map((c) => c.name).sort();
    expect(caps).toEqual(['local-inference', 'privacy-sensitive'].sort());
  });

  it('rejects unknown agent types', () => {
    const agents = listAgents();
    const any = agents[0];
    expect(any).toBeDefined();
    expect(() =>
      updateAgent(any.id, { type: 'not-a-type' as 'grok' })
    ).toThrow(/type must be one of/);
  });
});
