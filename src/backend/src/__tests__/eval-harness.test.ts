import fs from 'fs';
import os from 'os';
import path from 'path';
import { createWorkItem } from '../modules/work-items';
import {
  runEval,
  runLoopEvals,
  allEvalsPassed,
  parseReviewVerdict,
  extractCriterionEvidenceTokens,
  buildWorkDirCorpus,
} from '../modules/eval-harness';

describe('Eval Harness (M5)', () => {
  it('should parse review verdicts', () => {
    expect(parseReviewVerdict('APPROVED\nok')).toBe('approved');
    expect(parseReviewVerdict('CHANGES_REQUESTED\nfix')).toBe('changes_requested');
  });

  it('should eval file_exists', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-file-'));
    fs.writeFileSync(path.join(tmp, 'improvements.md'), '# x');

    const result = runEval({ id: 'f', type: 'file_exists', config: { file: 'improvements.md' } }, { workDir: tmp });
    expect(result.passed).toBe(true);

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('should eval acceptance criteria with work item', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-ac-'));
    fs.writeFileSync(path.join(tmp, 'improvements.md'), '# Improvements\n- one\n- two\n- three\n');

    const item = createWorkItem({
      type: 'task',
      title: 'Eval test',
      assignedAgentType: 'mock',
      acceptanceCriteria: [
        'improvements.md created in work directory',
        'At least 3 actionable recommendations',
      ],
    });

    const results = runLoopEvals(
      [
        { id: 'v', type: 'verdict_parse', config: { required: 'approved' } },
        { id: 'a', type: 'acceptance_criteria' },
      ],
      { workItem: item, workDir: tmp, reviewContent: 'APPROVED\n', reviewVerdict: 'approved' }
    );

    expect(allEvalsPassed(results)).toBe(true);

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('should match product ACs via nested code identifiers, not full prose', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-nested-'));
    fs.mkdirSync(path.join(tmp, 'dashboard', 'src', 'components'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'src', 'analysis'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'dashboard', 'src', 'components', 'MarketTrendDesk.tsx'),
      'export function MarketTrendDesk() { return <div>regime screener drill-down VIX</div>; }\n'
    );
    fs.writeFileSync(
      path.join(tmp, 'src', 'analysis', 'market_trend_desk.py'),
      'def build_market_trend_desk():\n  return {"sample_size": 1, "ledger_status": "ok", "baseline": "x", "market_trend_brief": True}\n'
    );
    fs.writeFileSync(path.join(tmp, 'quick_validation.py'), 'print("ok")\n');

    const item = createWorkItem({
      type: 'task',
      title: 'Market desk',
      assignedAgentType: 'mock',
      acceptanceCriteria: [
        'Dashboard: new MarketTrendDesk view shows regime, ≥ 5 candidate symbols, drill-down available',
        'MCP endpoint or tool: `market_trend_brief` returns regime + screened symbols + top forecasts',
        'All forecast labels (sample_size, ledger_status, baseline) visible on desk',
        'Load time: regime + screen + top 5 names in < 3 seconds (cold start)',
        'quick_validation.py still passes',
      ],
    });

    const result = runEval(
      { id: 'a', type: 'acceptance_criteria' },
      { workItem: item, workDir: tmp, reviewVerdict: 'approved' }
    );

    expect(result.passed).toBe(true);
    const corpus = buildWorkDirCorpus(tmp);
    expect(corpus.files.some((f) => f.includes('MarketTrendDesk'))).toBe(true);

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('extracts evidence tokens from free-form criteria', () => {
    const tokens = extractCriterionEvidenceTokens(
      'MCP endpoint or tool: `market_trend_brief` returns regime + MarketTrendDesk'
    );
    expect(tokens).toEqual(expect.arrayContaining(['market_trend_brief', 'markettrenddesk', 'regime']));
  });

  it('should skip test_command when useRepoRoot and no workspace is linked', () => {
    const item = createWorkItem({ type: 'task', title: 'No repo', assignedAgentType: 'mock' });
    const result = runEval(
      {
        id: 't',
        type: 'test_command',
        config: { command: 'npm test', useRepoRoot: true, skipIfNoRepo: true },
      },
      { workItem: item }
    );
    expect(result.passed).toBe(true);
    expect(result.details).toContain('Skipped');
  });

  it('should fail test_command when command exits non-zero', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-cmd-'));
    const result = runEval(
      { id: 't', type: 'test_command', config: { command: 'exit 1', cwd: tmp } },
      { workDir: tmp }
    );
    expect(result.passed).toBe(false);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});