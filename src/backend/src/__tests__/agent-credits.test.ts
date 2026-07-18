import fs from 'fs';
import os from 'os';
import path from 'path';
import { getDatabase } from '../database';
import { getAgent, listAgents, registerAgent, updateAgentConfig } from '../modules/agent-registry';
import {
  getAgentCreditUsage,
  calibrateAgentProviderUsage,
  assertAgentTypeWithinBudget,
  CreditBudgetExceededError,
  isAgentTypeOverBudget,
} from '../modules/agent-credits';
import { logAuditEntry } from '../modules/audit-logger';

describe('agent-credits', () => {
  let grokHome: string;
  let copilotHome: string;
  let previousGrokHome: string | undefined;
  let previousCopilotHome: string | undefined;

  beforeEach(() => {
    grokHome = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-credits-'));
    copilotHome = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-credits-'));
    previousGrokHome = process.env.GROK_HOME;
    previousCopilotHome = process.env.COPILOT_HOME;
    process.env.GROK_HOME = grokHome;
    process.env.COPILOT_HOME = copilotHome;
  });

  afterEach(() => {
    if (previousGrokHome === undefined) delete process.env.GROK_HOME;
    else process.env.GROK_HOME = previousGrokHome;
    if (previousCopilotHome === undefined) delete process.env.COPILOT_HOME;
    else process.env.COPILOT_HOME = previousCopilotHome;
    fs.rmSync(grokHome, { recursive: true, force: true });
    fs.rmSync(copilotHome, { recursive: true, force: true });
  });

  it('returns zero token usage when no audit or provider sessions exist', () => {
    const usage = getAgentCreditUsage();
    expect(usage.length).toBeGreaterThan(0);
    const grok = usage.find((u) => u.agentType === 'grok');
    expect(grok?.tokenCount).toBe(0);
    expect(grok?.percentageUsed).toBe(0);
    expect(grok?.trackingSource).toBe('none');
  });

  it('uses AgentHub audit tokens for grok percentage when quota is configured (not session context sum)', () => {
    const agents = listAgents();
    const grok = agents.find((a) => a.type === 'grok');
    expect(grok).toBeDefined();

    // Session context size must NOT drive Grok monthly % (would false-positive over-budget)
    const sessionDir = path.join(grokHome, 'sessions', 'month-session');
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionDir, 'signals.json'),
      JSON.stringify({ contextTokensUsed: 790_000 })
    );

    logAuditEntry({
      agentId: grok!.id,
      agentType: 'grok',
      contextHash: 'audit-tokens-pct',
      tokenCount: 500_000,
      cost: 1,
    });
    updateAgentConfig(grok!.id, { monthlyTokenQuota: 1_000_000 });

    const usage = getAgentCreditUsage();
    const grokUsage = usage.find((u) => u.agentType === 'grok');
    expect(grokUsage?.tokenCount).toBe(500_000);
    expect(grokUsage?.trackingSource).toBe('agenthub_audit');
    expect(grokUsage?.percentageUsed).toBe(50);
    expect(grokUsage?.overBudget).toBe(false);
  });

  it('uses provider session tokens for copilot percentage when quota is configured', () => {
    const agents = listAgents();
    const copilot = agents.find((a) => a.type === 'copilot');
    expect(copilot).toBeDefined();

    const sessionDir = path.join(copilotHome, 'session-state', 'copilot-session');
    fs.mkdirSync(sessionDir, { recursive: true });
    const currentMonthEvent = new Date();
    currentMonthEvent.setUTCDate(10);
    fs.writeFileSync(
      path.join(sessionDir, 'events.jsonl'),
      JSON.stringify({
        type: 'session.shutdown',
        timestamp: currentMonthEvent.toISOString(),
        data: {
          modelMetrics: {
            'gpt-5-mini': {
              usage: {
                inputTokens: 40_000,
                outputTokens: 10_000,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
              },
            },
          },
        },
      })
    );

    updateAgentConfig(copilot!.id, { monthlyTokenQuota: 100_000 });

    const usage = getAgentCreditUsage();
    const copilotUsage = usage.find((u) => u.agentType === 'copilot');
    expect(copilotUsage?.providerTokenCount).toBe(50_000);
    expect(copilotUsage?.providerSessionCount).toBe(1);
    expect(copilotUsage?.trackingSource).toBe('provider');
    expect(copilotUsage?.percentageUsed).toBe(50);
  });

  it('calibrates a fixed monthly quota from providerUsagePercent using Grok audit tokens', () => {
    const agents = listAgents();
    const grok = agents.find((a) => a.type === 'grok');
    expect(grok).toBeDefined();

    logAuditEntry({
      agentId: grok!.id,
      agentType: 'grok',
      contextHash: 'calibrate-base',
      tokenCount: 790_000,
      cost: 1,
    });

    const calibrated = calibrateAgentProviderUsage(grok!.id, 79);
    expect(calibrated?.config.monthlyTokenQuota).toBe(1_000_000);
    expect(calibrated?.config.providerCalibrationTokens).toBe(790_000);
    expect(calibrated?.config.providerCalibrationSource).toBe('agenthub_audit');

    const usage = getAgentCreditUsage();
    const grokUsage = usage.find((u) => u.agentType === 'grok');
    expect(grokUsage?.monthlyTokenQuota).toBe(1_000_000);
    expect(grokUsage?.percentageUsed).toBeCloseTo(79, 0);
    expect(grokUsage?.providerDashboardPercent).toBe(79);
  });

  it('updates percentage when AgentHub audit tokens grow after calibration', () => {
    const agents = listAgents();
    const grok = agents.find((a) => a.type === 'grok');
    expect(grok).toBeDefined();

    logAuditEntry({
      agentId: grok!.id,
      agentType: 'grok',
      contextHash: 'calibrate-base-2',
      tokenCount: 790_000,
      cost: 1,
    });
    calibrateAgentProviderUsage(grok!.id, 79);

    logAuditEntry({
      agentId: grok!.id,
      agentType: 'grok',
      contextHash: 'calibrate-growth',
      tokenCount: 30_000,
      cost: 0.1,
    });

    const usage = getAgentCreditUsage();
    const grokUsage = usage.find((u) => u.agentType === 'grok');
    expect(grokUsage?.tokenCount).toBe(820_000);
    expect(grokUsage?.percentageUsed).toBeCloseTo(82, 0);
    expect(grokUsage?.overBudget).toBe(false);
  });

  it('does not mark grok over-budget from large session context peaks alone', () => {
    const agents = listAgents();
    const grok = agents.find((a) => a.type === 'grok');
    expect(grok).toBeDefined();

    // Many fat sessions would previously sum to "over quota"
    for (let i = 0; i < 5; i++) {
      const sessionDir = path.join(grokHome, 'sessions', `fat-${i}`);
      fs.mkdirSync(sessionDir, { recursive: true });
      fs.writeFileSync(
        path.join(sessionDir, 'signals.json'),
        JSON.stringify({ contextTokensUsed: 900_000 })
      );
    }

    logAuditEntry({
      agentId: grok!.id,
      agentType: 'grok',
      contextHash: 'small-audit',
      tokenCount: 100_000,
      cost: 0.5,
    });
    updateAgentConfig(grok!.id, {
      monthlyTokenQuota: 1_000_000,
      providerUsagePercent: 50,
    });

    expect(isAgentTypeOverBudget('grok')).toBe(false);
    const usage = getAgentCreditUsage().find((u) => u.agentType === 'grok');
    expect(usage?.percentageUsed).toBe(10);
    expect(usage?.trackingSource).toBe('agenthub_audit');
  });

  it('shows actual total usage percentage from audit credits (3900/5000 = 78%)', () => {
    const agents = listAgents();
    const grok = agents.find((a) => a.type === 'grok');
    expect(grok).toBeDefined();

    logAuditEntry({
      agentId: grok!.id,
      agentType: 'grok',
      contextHash: 'credit-usage-78',
      tokenCount: 50_000,
      cost: 39,
    });

    const usage = getAgentCreditUsage();
    const grokUsage = usage.find((u) => u.agentType === 'grok');
    expect(grokUsage?.creditsUsed).toBe(3900);
    expect(grokUsage?.creditLimit).toBe(5000);
    expect(grokUsage?.percentageUsed).toBe(78);
    expect(grokUsage?.creditsRemaining).toBe(1100);
    expect(grokUsage?.overBudget).toBe(false);
  });

  it('aggregates audit tokens separately from provider totals', () => {
    const agents = listAgents();
    const grok = agents.find((a) => a.type === 'grok');
    expect(grok).toBeDefined();

    logAuditEntry({
      agentId: grok!.id,
      agentType: 'grok',
      contextHash: 'abc123',
      tokenCount: 1000,
      cost: 2.5,
    });

    const usage = getAgentCreditUsage();
    const grokUsage = usage.find((u) => u.agentType === 'grok');
    expect(grokUsage?.tokenCount).toBe(1000);
    expect(grokUsage?.creditsUsed).toBe(250);
    expect(grokUsage?.trackingSource).toBe('agenthub_audit');
  });

  it('aggregates usage across all registered instances of the same agent type', () => {
    const agents = listAgents();
    const primaryGrok = agents.find((a) => a.type === 'grok');
    expect(primaryGrok).toBeDefined();

    const secondGrok = registerAgent('Grok Backup', 'grok');

    logAuditEntry({
      agentId: primaryGrok!.id,
      agentType: 'grok',
      contextHash: 'grok-primary',
      tokenCount: 100,
      cost: 1,
    });

    logAuditEntry({
      agentId: secondGrok.id,
      agentType: 'grok',
      contextHash: 'grok-backup',
      tokenCount: 200,
      cost: 1,
    });

    getDatabase()
      .prepare(
        `INSERT INTO audit_log
         (id, agent_id, workflow_id, work_item_id, loop_iteration, pipeline_phase, agent_type,
          task, context_hash, files, token_count, cost, approval_status, response_metadata, timestamp)
         VALUES (?, NULL, NULL, NULL, NULL, NULL, ?, NULL, ?, ?, ?, ?, NULL, NULL, ?)`
      )
      .run('orphan-grok', 'grok', 'hash-grok-orphan', '[]', 100, 0.1, new Date().toISOString());

    const usage = getAgentCreditUsage();
    const grokRows = usage.filter((u) => u.agentType === 'grok');
    expect(grokRows).toHaveLength(1);
    expect(grokRows[0].tokenCount).toBe(400);
    expect(grokRows[0].requestCount).toBe(3);
  });

  it('blocks outbound runs when agent type is over credit budget', () => {
    const agents = listAgents();
    const grok = agents.find((a) => a.type === 'grok');
    expect(grok).toBeDefined();

    updateAgentConfig(grok!.id, { creditLimit: 100 });
    logAuditEntry({
      agentId: grok!.id,
      agentType: 'grok',
      contextHash: 'over-budget',
      tokenCount: 500,
      cost: 2,
    });

    expect(isAgentTypeOverBudget('grok')).toBe(true);
    expect(() => assertAgentTypeWithinBudget('grok')).toThrow(CreditBudgetExceededError);
    expect(() => assertAgentTypeWithinBudget('ollama')).not.toThrow();
  });

  it('unblocks after raising credit limit and clearing monthly token quota', () => {
    const agents = listAgents();
    const grok = agents.find((a) => a.type === 'grok');
    expect(grok).toBeDefined();

    updateAgentConfig(grok!.id, {
      creditLimit: 1,
      monthlyTokenQuota: 10,
      model: 'grok-build',
    });
    logAuditEntry({
      agentId: grok!.id,
      agentType: 'grok',
      contextHash: 'unblock-test',
      tokenCount: 50,
      cost: 1,
    });

    expect(isAgentTypeOverBudget('grok')).toBe(true);

    updateAgentConfig(grok!.id, { creditLimit: 0, monthlyTokenQuota: null });
    const after = getAgent(grok!.id);
    expect(after?.config.creditLimit).toBe(0);
    expect(after?.config.monthlyTokenQuota).toBeUndefined();
    expect(after?.config.model).toBe('grok-build');
    expect(isAgentTypeOverBudget('grok')).toBe(false);
    expect(() => assertAgentTypeWithinBudget('grok')).not.toThrow();
  });

  it('marks ollama as unlimited with zero default limit', () => {
    const usage = getAgentCreditUsage();
    const ollama = usage.find((u) => u.agentType === 'ollama');
    expect(ollama).toBeDefined();
    expect(ollama!.unlimited).toBe(true);
    expect(ollama!.creditLimit).toBe(0);
  });
});