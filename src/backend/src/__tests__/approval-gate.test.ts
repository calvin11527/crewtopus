import type { ContextScope } from '../types';
import {
  createApprovalRequest,
  approveRequest,
  consumeApprovedRequest,
  findUnconsumedApprovedRequest,
  ApprovalBindingError,
} from '../modules/approval-gate';
import { hashContext } from '../modules/context-scope';
import { createWorkItem } from '../modules/work-items';

function makeScope(overrides: Partial<ContextScope> = {}): ContextScope {
  return {
    files: ['// a.ts\nexport const ok = true;'],
    diffs: [],
    symbols: [],
    maxTokens: 8000,
    sensitivityLevel: 2,
    ...overrides,
  };
}

describe('approval-gate binding', () => {
  it('redeems an approved request once for matching work item + hash', () => {
    const item = createWorkItem({ type: 'task', title: 'Approval bind' });
    const scope = makeScope();
    const pending = createApprovalRequest(scope, undefined, { workItemId: item.id });
    approveRequest(pending.id);

    const consumed = consumeApprovedRequest(pending.id, {
      workItemId: item.id,
      contextHash: hashContext(scope),
    });
    expect(consumed.consumedAt).toBeTruthy();

    expect(() =>
      consumeApprovedRequest(pending.id, {
        workItemId: item.id,
        contextHash: hashContext(scope),
      })
    ).toThrow(ApprovalBindingError);
  });

  it('rejects a different work item or context hash', () => {
    const item = createWorkItem({ type: 'task', title: 'Approval owner' });
    const other = createWorkItem({ type: 'task', title: 'Other item' });
    const scope = makeScope();
    const pending = createApprovalRequest(scope, undefined, { workItemId: item.id });
    approveRequest(pending.id);

    expect(() =>
      consumeApprovedRequest(pending.id, {
        workItemId: other.id,
        contextHash: hashContext(scope),
      })
    ).toThrow(/different work item/);

    expect(() =>
      consumeApprovedRequest(pending.id, {
        workItemId: item.id,
        contextHash: hashContext(makeScope({ files: ['// other.ts'] })),
      })
    ).toThrow(/does not match this context/);
  });

  it('finds an unconsumed approved request for the same work item and hash', () => {
    const item = createWorkItem({ type: 'task', title: 'Find approved' });
    const scope = makeScope();
    const pending = createApprovalRequest(scope, undefined, { workItemId: item.id });
    approveRequest(pending.id);

    const found = findUnconsumedApprovedRequest({
      workItemId: item.id,
      contextHash: hashContext(scope),
    });
    expect(found?.id).toBe(pending.id);
  });
});
