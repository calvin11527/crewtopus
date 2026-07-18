import {
  buildLoopRetryPayload,
  getEscalationRetryContext,
  isTerminalLoopStatus,
  resolveRetryMode,
  shouldAutoChainFixLoop,
} from '../modules/loop-retry';
import { createWorkItem, updateWorkItem } from '../modules/work-items';
import { logWorkItemActivity } from '../modules/work-item-activity';

describe('loop-retry', () => {
  it('detects terminal loop statuses', () => {
    expect(isTerminalLoopStatus('escalated')).toBe(true);
    expect(isTerminalLoopStatus('running')).toBe(false);
  });

  it('resolves retry modes from prior loop status', () => {
    expect(resolveRetryMode('escalated')).toBe('escalation_continue');
    expect(resolveRetryMode('failed')).toBe('full');
    expect(resolveRetryMode('escalated', 'review_only')).toBe('review_only');
  });

  it('extracts escalation context from loop activity', () => {
    const item = createWorkItem({ type: 'task', title: 'Retry context test' });

    logWorkItemActivity({
      workItemId: item.id,
      activityType: 'agent_completed',
      summary: 'Implement pass',
      metadata: {
        pipelinePhase: 'implementation',
        content: 'Implemented feature X',
      },
    });
    logWorkItemActivity({
      workItemId: item.id,
      activityType: 'agent_completed',
      summary: 'Review pass',
      metadata: {
        pipelinePhase: 'review',
        content: 'CHANGES_REQUESTED\nAdd tests',
      },
    });

    const context = getEscalationRetryContext(item.id);
    expect(context?.priorImplementation).toContain('Implemented feature X');
    expect(context?.reviewFeedback).toContain('CHANGES_REQUESTED');
  });

  it('builds review-only payload for escalated items', () => {
    const item = createWorkItem({ type: 'task', title: 'Escalated payload' });
    updateWorkItem(item.id, { loopStatus: 'escalated', status: 'in_review' });

    logWorkItemActivity({
      workItemId: item.id,
      activityType: 'agent_completed',
      summary: 'Review',
      metadata: { pipelinePhase: 'review', content: 'CHANGES_REQUESTED\nFix lint' },
    });

    const payload = buildLoopRetryPayload(item.id, 'escalated', { retryMode: 'review_only' });
    expect(payload.retryMode).toBe('review_only');
    expect(payload.maxIterations).toBe(1);
    expect(payload.autoLoop).toBe(false);
    expect(payload.escalationContext?.reviewFeedback).toContain('CHANGES_REQUESTED');
  });

  it('auto-chains fix loop after review-only changes_requested', () => {
    expect(
      shouldAutoChainFixLoop(
        { retryMode: 'review_only', autoChainFix: true },
        'idle',
        'changes_requested'
      )
    ).toBe(true);
    expect(
      shouldAutoChainFixLoop(
        { retryMode: 'review_only', autoChainFix: false },
        'idle',
        'changes_requested'
      )
    ).toBe(false);
    expect(
      shouldAutoChainFixLoop({ retryMode: 'full' }, 'escalated', 'changes_requested')
    ).toBe(false);
  });
});