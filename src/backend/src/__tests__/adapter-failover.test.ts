import { listAgents, updateAgentConfig } from '../modules/agent-registry';
import { pickFailoverType, resolveOutboundAgentType, isAgentTypeBlocked } from '../modules/adapter-failover';
import { logAuditEntry } from '../modules/audit-logger';
import { calibrateAgentProviderUsage } from '../modules/agent-credits';

describe('adapter-failover', () => {
  it('picks an alternate type when preferred is free', () => {
    const next = pickFailoverType('grok', 'mock');
    expect(next).toBe('mock');
  });

  it('auto-failovers when requested type is over SuperGrok 100%', () => {
    const grok = listAgents().find((a) => a.type === 'grok');
    expect(grok).toBeDefined();
    calibrateAgentProviderUsage(grok!.id, 100, {
      period: 'weekly',
      mode: 'dashboard_primary',
    });
    expect(isAgentTypeBlocked('grok')).toBe(true);

    updateAgentConfig(grok!.id, { preferredFailoverType: 'mock' });
    const res = resolveOutboundAgentType({
      requestedType: 'grok',
      agentId: grok!.id,
      allowFailover: true,
    });
    expect(res.failedOver).toBe(true);
    expect(res.agentType).toBe('mock');
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
