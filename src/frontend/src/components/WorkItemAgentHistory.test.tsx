import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WorkItemAgentHistory from './WorkItemAgentHistory';
import type { WorkItem, WorkItemActivity } from '../types';

const baseItem: WorkItem = {
  id: 'wi-1',
  key: 'AH-42',
  type: 'story',
  title: 'Ship agent history',
  status: 'in_progress',
  priority: 'high',
  labels: ['lifecycle:ba_done', 'lifecycle:pm_done', 'lifecycle:atomic'],
  acceptanceCriteria: [],
  loopIteration: 1,
  maxLoopIterations: 3,
  loopStatus: 'running',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T12:00:00.000Z',
};

const activity: WorkItemActivity[] = [
  {
    id: 'a-ba',
    workItemId: 'wi-1',
    activityType: 'agent_completed',
    summary: 'Business analyst completed requirements for AH-42',
    agentType: 'claude',
    createdAt: '2026-07-01T09:00:00.000Z',
    metadata: { event: 'lifecycle_ba_complete', content: '## Plan' },
  },
  {
    id: 'a-dev',
    workItemId: 'wi-1',
    activityType: 'agent_started',
    summary: 'Iteration 1: grok started implement on AH-42',
    agentType: 'grok',
    createdAt: '2026-07-01T12:00:00.000Z',
    metadata: { pipelinePhase: 'implementation', loopIteration: 1 },
  },
];

describe('WorkItemAgentHistory', () => {
  it('renders role strip, lifecycle phase, and timeline entries', () => {
    render(
      <WorkItemAgentHistory workItem={baseItem} activity={activity} isBusy />
    );

    expect(screen.getByRole('region', { name: /agent history/i })).toBeTruthy();
    expect(screen.getByText(/ready for developer pipeline/i)).toBeTruthy();
    expect(screen.getAllByText('Business Analyst').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Developer').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/business analyst completed requirements/i)).toBeTruthy();
    expect(screen.getByText(/grok started implement/i)).toBeTruthy();
    expect(screen.getAllByText('Working').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Done').length).toBeGreaterThanOrEqual(1);
  });

  it('expands output when Show output is clicked', () => {
    render(
      <WorkItemAgentHistory workItem={baseItem} activity={activity} isBusy={false} />
    );

    fireEvent.click(screen.getByRole('button', { name: /show output/i }));
    expect(screen.getByText('## Plan')).toBeTruthy();
  });

  it('shows empty hint when there is no activity', () => {
    render(
      <WorkItemAgentHistory
        workItem={{ ...baseItem, type: 'task', labels: [], loopIteration: 0, loopStatus: 'idle' }}
        activity={[]}
      />
    );
    expect(screen.getByText(/no agent work recorded yet/i)).toBeTruthy();
  });
});
