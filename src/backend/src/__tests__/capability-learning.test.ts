import {
  parseHelpText,
  upsertCapabilityFact,
  listCapabilityFacts,
  createImprovementSuggestion,
  listImprovementSuggestions,
  setSuggestionStatus,
  probeAgentCapabilities,
} from '../modules/capability-learning';

describe('capability-learning', () => {
  it('parses flags and models from help text', () => {
    const parsed = parseHelpText(`
      Usage: grok [options]
      --model <name>   Select model (grok-4.5, grok-3)
      --permission plan|yolo
      --workspace path
    `);
    expect(parsed.flags).toEqual(expect.arrayContaining(['--model', '--permission', '--workspace']));
    expect(parsed.models.some((m) => m.includes('grok'))).toBe(true);
    expect(parsed.mentions).toEqual(expect.arrayContaining(['model', 'permission', 'workspace']));
  });

  it('upserts capability facts', () => {
    const a = upsertCapabilityFact({
      agentType: 'mock',
      factKey: 'test_fact',
      factValue: { v: 1 },
      source: 'manual',
    });
    const b = upsertCapabilityFact({
      agentType: 'mock',
      factKey: 'test_fact',
      factValue: { v: 2 },
      source: 'run_outcome',
    });
    expect(a.id).toBe(b.id);
    expect(b.factValue).toEqual({ v: 2 });
    const listed = listCapabilityFacts('mock').filter((f) => f.factKey === 'test_fact');
    expect(listed).toHaveLength(1);
  });

  it('dedupes open suggestions by title', () => {
    createImprovementSuggestion({
      agentType: 'grok',
      title: 'test-suggestion-unique',
      body: 'first',
      severity: 'info',
    });
    createImprovementSuggestion({
      agentType: 'grok',
      title: 'test-suggestion-unique',
      body: 'second',
      severity: 'warn',
    });
    const open = listImprovementSuggestions('open').filter((s) => s.title === 'test-suggestion-unique');
    expect(open).toHaveLength(1);
    expect(open[0].body).toBe('second');
    setSuggestionStatus(open[0].id, 'dismissed');
  });

  it('seeds mock facts via probe', () => {
    const { facts } = probeAgentCapabilities(['mock']);
    expect(facts.some((f) => f.agentType === 'mock' && f.factKey === 'modes')).toBe(true);
  });
});
