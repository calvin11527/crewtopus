import { assertLoopContract, LoopContractError } from '../modules/loop-contract';
import type { WorkflowLoop } from '../types';

function baseLoop(overrides: Partial<WorkflowLoop> = {}): WorkflowLoop {
  return {
    id: 'test-loop',
    until: 'verdict_approved',
    maxIterations: 1,
    onExhausted: 'escalate',
    steps: [{ name: 'implement', agent: 'mock', capability: 'implementation' }],
    ...overrides,
  };
}

describe('loop-contract', () => {
  it('accepts supported until / parser / evals', () => {
    expect(() =>
      assertLoopContract(
        baseLoop({
          until: 'eval_pass',
          evals: [
            { id: 'v', type: 'verdict_parse', config: { required: 'approved' } },
            { id: 't', type: 'test_command', config: { detect: true } },
          ],
        })
      )
    ).not.toThrow();
  });

  it('rejects custom eval type with a clear hint', () => {
    expect(() =>
      assertLoopContract(
        baseLoop({
          evals: [{ id: 'c', type: 'custom', config: { script: 'evil.js' } }],
        })
      )
    ).toThrow(LoopContractError);
    expect(() =>
      assertLoopContract(
        baseLoop({
          evals: [{ id: 'c', type: 'custom' }],
        })
      )
    ).toThrow(/not supported/);
  });

  it('requires untilMatchPattern for step_output_match', () => {
    expect(() => assertLoopContract(baseLoop({ until: 'step_output_match' }))).toThrow(
      /untilMatchPattern/
    );
    expect(() =>
      assertLoopContract(baseLoop({ until: 'step_output_match', untilMatchPattern: 'PASS' }))
    ).not.toThrow();
  });

  it('requires verdictRegex for custom_regex parser', () => {
    expect(() =>
      assertLoopContract(baseLoop({ verdictParser: 'custom_regex' }))
    ).toThrow(/verdictRegex/);
  });
});
