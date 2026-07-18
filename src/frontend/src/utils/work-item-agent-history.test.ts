import { describe, it, expect } from 'vitest';
import type { WorkItem, WorkItemActivity } from '../types';
import {
  activityToHistoryEntry,
  buildRoleSnapshots,
  buildWorkItemAgentHistory,
  getWorkItemLifecyclePhase,
  inferActivityRole,
  isAgentHistoryActivity,
  resolveRunningEntries,
  workItemLifecycleChip,
} from './work-item-agent-history';

function makeItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'wi-1',
    key: 'AH-1',
    type: 'story',
    title: 'Sample story',
    status: 'todo',
    priority: 'medium',
    labels: [],
    acceptanceCriteria: [],
    loopIteration: 0,
    maxLoopIterations: 3,
    loopStatus: 'idle',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeActivity(overrides: Partial<WorkItemActivity> = {}): WorkItemActivity {
  return {
    id: `act-${Math.random().toString(36).slice(2, 8)}`,
    workItemId: 'wi-1',
    activityType: 'comment',
    summary: 'note',
    createdAt: '2026-07-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('getWorkItemLifecyclePhase', () => {
  it('returns n/a for tasks', () => {
    expect(getWorkItemLifecyclePhase(makeItem({ type: 'task' }))).toBe('n/a');
  });

  it('returns ba_pending until BA label exists', () => {
    expect(getWorkItemLifecyclePhase(makeItem({ labels: [] }))).toBe('ba_pending');
  });

  it('returns pm_pending after BA done', () => {
    expect(
      getWorkItemLifecyclePhase(makeItem({ labels: ['lifecycle:ba_done'] }))
    ).toBe('pm_pending');
  });

  it('returns dev_ready after PM done', () => {
    expect(
      getWorkItemLifecyclePhase(
        makeItem({ labels: ['lifecycle:ba_done', 'lifecycle:pm_done', 'lifecycle:atomic'] })
      )
    ).toBe('dev_ready');
  });

  it('returns complete when story is done', () => {
    expect(getWorkItemLifecyclePhase(makeItem({ status: 'done' }))).toBe('complete');
  });

  it('exposes card chips for pending BA/PM phases', () => {
    expect(workItemLifecycleChip(makeItem({ labels: [] }))?.short).toBe('BA');
    expect(workItemLifecycleChip(makeItem({ labels: ['lifecycle:ba_done'] }))?.short).toBe('PM');
    expect(
      workItemLifecycleChip(
        makeItem({ labels: ['lifecycle:ba_done', 'lifecycle:pm_done', 'lifecycle:atomic'] })
      )?.short
    ).toBe('Dev ready');
    expect(workItemLifecycleChip(makeItem({ type: 'task' }))).toBeNull();
  });
});

describe('inferActivityRole', () => {
  it('maps lifecycle BA/PM events', () => {
    expect(
      inferActivityRole(
        makeActivity({
          activityType: 'agent_completed',
          summary: 'BA done',
          metadata: { event: 'lifecycle_ba_complete' },
        })
      )
    ).toBe('business_analyst');

    expect(
      inferActivityRole(
        makeActivity({
          activityType: 'agent_completed',
          summary: 'PM done',
          metadata: { event: 'lifecycle_pm_complete' },
        })
      )
    ).toBe('project_manager');
  });

  it('maps pipeline phases to developer/tester/reviewer', () => {
    expect(
      inferActivityRole(
        makeActivity({
          activityType: 'agent_started',
          summary: 'started',
          metadata: { pipelinePhase: 'implementation' },
        })
      )
    ).toBe('developer');
    expect(
      inferActivityRole(
        makeActivity({
          activityType: 'agent_started',
          summary: 'started',
          metadata: { pipelinePhase: 'testing' },
        })
      )
    ).toBe('tester');
    expect(
      inferActivityRole(
        makeActivity({
          activityType: 'agent_completed',
          summary: 'review done',
          metadata: { pipelinePhase: 'review' },
        })
      )
    ).toBe('reviewer');
  });
});

describe('resolveRunningEntries', () => {
  it('closes started rows when a matching completed follows', () => {
    const started = activityToHistoryEntry(
      makeActivity({
        id: 's1',
        activityType: 'agent_started',
        summary: 'Grok started',
        agentType: 'grok',
        createdAt: '2026-07-01T10:00:00.000Z',
        metadata: { pipelinePhase: 'implementation', loopIteration: 1 },
      })
    );
    const completed = activityToHistoryEntry(
      makeActivity({
        id: 'c1',
        activityType: 'agent_completed',
        summary: 'Grok completed',
        agentType: 'grok',
        createdAt: '2026-07-01T10:05:00.000Z',
        metadata: { pipelinePhase: 'implementation', loopIteration: 1 },
      })
    );

    const resolved = resolveRunningEntries([started, completed], { isBusy: false });
    expect(resolved.find((e) => e.id === 's1')?.status).toBe('completed');
    expect(resolved.find((e) => e.id === 'c1')?.status).toBe('completed');
  });

  it('keeps latest start as running when item is busy', () => {
    const started = activityToHistoryEntry(
      makeActivity({
        id: 's2',
        activityType: 'agent_started',
        summary: 'Copilot review started',
        agentType: 'copilot',
        createdAt: '2026-07-01T11:00:00.000Z',
        metadata: { pipelinePhase: 'review', loopIteration: 1 },
      })
    );

    const resolved = resolveRunningEntries([started], {
      isBusy: true,
      loopStatus: 'running',
    });
    expect(resolved[0]?.status).toBe('running');
  });
});

describe('buildWorkItemAgentHistory', () => {
  it('builds role snapshots and timeline from mixed lifecycle + pipeline activity', () => {
    const activity: WorkItemActivity[] = [
      makeActivity({
        id: 'a1',
        activityType: 'comment',
        summary: 'Shift scheduler queued story for business analyst requirements pass',
        agentType: 'claude',
        createdAt: '2026-07-01T09:00:00.000Z',
        metadata: { event: 'shift_lifecycle_start' },
      }),
      makeActivity({
        id: 'a2',
        activityType: 'agent_completed',
        summary: 'Business analyst completed requirements for AH-1',
        agentType: 'claude',
        createdAt: '2026-07-01T09:10:00.000Z',
        metadata: { event: 'lifecycle_ba_complete', content: '## Requirements' },
      }),
      makeActivity({
        id: 'a3',
        activityType: 'agent_completed',
        summary: 'Project manager marked AH-1 as atomic',
        agentType: 'claude',
        createdAt: '2026-07-01T09:20:00.000Z',
        metadata: { event: 'lifecycle_pm_complete' },
      }),
      makeActivity({
        id: 'a4',
        activityType: 'agent_started',
        summary: 'Iteration 1: grok started implement',
        agentType: 'grok',
        createdAt: '2026-07-01T10:00:00.000Z',
        metadata: { pipelinePhase: 'implementation', loopIteration: 1 },
      }),
      makeActivity({
        id: 'a5',
        activityType: 'agent_completed',
        summary: 'Iteration 1: grok completed',
        agentType: 'grok',
        createdAt: '2026-07-01T10:05:00.000Z',
        metadata: { pipelinePhase: 'implementation', loopIteration: 1, content: 'done' },
      }),
      makeActivity({
        id: 'a6',
        activityType: 'agent_completed',
        summary: 'Iteration 1: copilot completed review',
        agentType: 'copilot',
        createdAt: '2026-07-01T10:15:00.000Z',
        auditId: 'audit-rev',
        metadata: { pipelinePhase: 'review', loopIteration: 1 },
      }),
    ];

    const model = buildWorkItemAgentHistory({
      workItem: makeItem({
        labels: ['lifecycle:ba_done', 'lifecycle:pm_done', 'lifecycle:atomic'],
        loopIteration: 1,
        loopStatus: 'approved',
      }),
      activity,
      isBusy: false,
    });

    expect(model.phase).toBe('dev_ready');
    expect(model.entries.length).toBeGreaterThanOrEqual(5);

    const ba = model.roleSnapshots.find((r) => r.role === 'business_analyst');
    const pm = model.roleSnapshots.find((r) => r.role === 'project_manager');
    const dev = model.roleSnapshots.find((r) => r.role === 'developer');
    const rev = model.roleSnapshots.find((r) => r.role === 'reviewer');

    expect(ba?.status).toBe('completed');
    expect(pm?.status).toBe('completed');
    expect(dev?.status).toBe('completed');
    expect(rev?.status).toBe('completed');
    expect(rev?.agentType).toBe('copilot');
  });

  it('filters out non-agent activity noise', () => {
    expect(
      isAgentHistoryActivity(
        makeActivity({ activityType: 'status_change', summary: 'Moved to todo' })
      )
    ).toBe(false);
  });

  it('marks idle roles when no activity', () => {
    const snaps = buildRoleSnapshots([], { isBusy: false });
    expect(snaps.every((s) => s.status === 'idle')).toBe(true);
  });
});
