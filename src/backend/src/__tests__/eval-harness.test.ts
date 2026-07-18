import fs from 'fs';
import os from 'os';
import path from 'path';
import { createWorkItem } from '../modules/work-items';
import {
  runEval,
  runLoopEvals,
  allEvalsPassed,
  parseReviewVerdict,
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