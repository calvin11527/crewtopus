import { getAgent, listAgents, updateAgentConfig } from '../modules/agent-registry';
import { pickFailoverType, resolveOutboundAgentType, isAgentTypeBlocked } from '../modules/adapter-failover';
import { calibrateAgentProviderUsage } from '../modules/agent-credits';

describe('adapter-failover', () => {
  it('picks an alternate type when preferred is free', () => {
    const next = pickFailoverType('grok', 'copilot');
    expect(next).toBe('copilot');
  });

  it('does not pick mock unless allowMock is set', () => {
    expect(pickFailoverType('grok', 'mock')).not.toBe('mock');
    expect(pickFailoverType('grok', 'mock', { allowMock: true })).toBe('mock');
  });

  it('auto-failovers for this run without rewriting the agent type', () => {
    const grok = listAgents().find((a) => a.type === 'grok');
    expect(grok).toBeDefined();
    calibrateAgentProviderUsage(grok!.id, 100, {
      period: 'weekly',
      mode: 'dashboard_primary',
    });
    expect(isAgentTypeBlocked('grok')).toBe(true);

    updateAgentConfig(grok!.id, { preferredFailoverType: 'copilot' });
    const res = resolveOutboundAgentType({
      requestedType: 'grok',
      agentId: grok!.id,
      allowFailover: true,
    });
    expect(res.failedOver).toBe(true);
    expect(res.agentType).toBe('copilot');
    expect(getAgent(grok!.id)?.type).toBe('grok');
  });

  it('does not failover when disabled', () => {
    const grok = listAgents().find((a) => a.type === 'grok');
    calibrateAgentProviderUsage(grok!.id, 100, { mode: 'dashboard_primary' });
    const res = resolveOutboundAgentType({
      requestedType: 'grok',
      agentId: grok!.id,
      allowFailover: false,
    });
    expect(res.failedOver).toBe(false);
    expect(res.agentType).toBe('grok');
  });
});
