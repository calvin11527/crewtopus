import {
  classifyThrottle,
  clearProviderThrottle,
  getThrottleSignal,
  isProviderThrottleError,
  recordProviderThrottle,
  recordRunUsage,
  stopProviderUsageWatcherForTests,
} from '../modules/usage-meter';

describe('usage-meter', () => {
  afterEach(() => {
    stopProviderUsageWatcherForTests();
  });

  it('detects provider throttle messages', () => {
    expect(isProviderThrottleError('Error: rate limit exceeded')).toBe(true);
    expect(isProviderThrottleError('HTTP 429 Too Many Requests')).toBe(true);
    expect(isProviderThrottleError('you are over budget')).toBe(true);
    expect(isProviderThrottleError('file not found')).toBe(false);
  });

  it('classifies quota vs short-term throttle', () => {
    expect(classifyThrottle('quota exceeded')).toBe('quota_exceeded');
    expect(classifyThrottle('rate limit')).toBe('throttled');
  });

  it('records and clears throttle signals', () => {
    recordProviderThrottle('grok', 'rate limit hit');
    expect(getThrottleSignal('grok')?.state).toBe('throttled');
    clearProviderThrottle('grok');
    expect(getThrottleSignal('grok')).toBeUndefined();
  });

  it('clears throttle on successful run usage', () => {
    recordProviderThrottle('copilot', '429');
    recordRunUsage({
      agentType: 'copilot',
      tokenCount: 100,
      success: true,
    });
    expect(getThrottleSignal('copilot')).toBeUndefined();
  });

  it('sets throttle on failed run with quota error', () => {
    recordRunUsage({
      agentType: 'grok',
      tokenCount: 0,
      success: false,
      errorMessage: 'over budget this month',
    });
    expect(getThrottleSignal('grok')?.state).toBe('quota_exceeded');
  });
});
