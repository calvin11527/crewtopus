import fs from 'fs';
import os from 'os';
import path from 'path';
import { getCopilotProviderTokenUsage, getGrokProviderTokenUsage } from '../modules/provider-usage';

describe('provider-usage', () => {
  let grokHome: string;
  let copilotHome: string;
  let previousGrokHome: string | undefined;
  let previousCopilotHome: string | undefined;

  beforeEach(() => {
    grokHome = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-home-'));
    copilotHome = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-home-'));
    previousGrokHome = process.env.GROK_HOME;
    previousCopilotHome = process.env.COPILOT_HOME;
    process.env.GROK_HOME = grokHome;
    process.env.COPILOT_HOME = copilotHome;

    const sessionDir = path.join(grokHome, 'sessions', 'test-session');
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionDir, 'signals.json'),
      JSON.stringify({ contextTokensUsed: 790_000, contextWindowTokens: 200_000 })
    );
  });

  afterEach(() => {
    if (previousGrokHome === undefined) delete process.env.GROK_HOME;
    else process.env.GROK_HOME = previousGrokHome;
    if (previousCopilotHome === undefined) delete process.env.COPILOT_HOME;
    else process.env.COPILOT_HOME = previousCopilotHome;
    fs.rmSync(grokHome, { recursive: true, force: true });
    fs.rmSync(copilotHome, { recursive: true, force: true });
  });

  it('reports max contextTokensUsed across grok sessions (not a monthly billable sum)', () => {
    const second = path.join(grokHome, 'sessions', 'other-session');
    fs.mkdirSync(second, { recursive: true });
    fs.writeFileSync(
      path.join(second, 'signals.json'),
      JSON.stringify({ contextTokensUsed: 120_000, contextWindowTokens: 200_000 })
    );

    const snapshot = getGrokProviderTokenUsage();
    expect(snapshot).not.toBeNull();
    // Diagnostic peak context — not sum (would be 910k and false-positive budgets)
    expect(snapshot!.totalTokens).toBe(790_000);
    expect(snapshot!.sessionCount).toBe(2);
    expect(snapshot!.source).toBe('grok_session_signals');
  });

  it('sums tokens from copilot session.shutdown events', () => {
    const sessionDir = path.join(copilotHome, 'session-state', 'session-a');
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionDir, 'events.jsonl'),
      [
        JSON.stringify({
          type: 'session.shutdown',
          timestamp: '2026-06-15T12:00:00.000Z',
          data: {
            modelMetrics: {
              'gpt-5-mini': {
                usage: {
                  inputTokens: 1000,
                  outputTokens: 200,
                  cacheReadTokens: 50,
                  cacheWriteTokens: 25,
                },
              },
            },
          },
        }),
      ].join('\n')
    );

    const snapshot = getCopilotProviderTokenUsage();
    expect(snapshot).not.toBeNull();
    expect(snapshot!.totalTokens).toBe(1275);
    expect(snapshot!.sessionCount).toBe(1);
    expect(snapshot!.source).toBe('copilot_session_shutdown');
  });

  it('filters copilot sessions before the since date', () => {
    const sessionDir = path.join(copilotHome, 'session-state', 'session-b');
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionDir, 'events.jsonl'),
      JSON.stringify({
        type: 'session.shutdown',
        timestamp: '2026-05-01T12:00:00.000Z',
        data: {
          tokenDetails: {
            input: { tokenCount: 500 },
            output: { tokenCount: 100 },
          },
        },
      })
    );

    const snapshot = getCopilotProviderTokenUsage(new Date('2026-06-01T00:00:00.000Z'));
    expect(snapshot).toBeNull();
  });
});