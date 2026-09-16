import { describe, expect, it } from 'vitest';
import { deriveWorkItemNow, formatElapsed } from './derive-work-item-now';
import type { WorkItem } from '../types';

const item: Pick<WorkItem, 'key' | 'status' | 'loopStatus' | 'assignedAgentType'> = {
  key: 'AH-15',
  status: 'in_progress',
  loopStatus: 'idle',
  assignedAgentType: 'grok',
};

describe('deriveWorkItemNow', () => {
  const t0 = Date.parse('2026-09-16T10:08:04.000Z');

  it('formats elapsed time', () => {
    expect(formatElapsed('2026-09-16T10:08:04.000Z', t0 + 12_000)).toBe('12s');
    expect(formatElapsed('2026-09-16T10:08:04.000Z', t0 + 125_000)).toBe('2m 5s');
  });

  it('shows BA in queue while the job is pending', () => {
    const now = deriveWorkItemNow({
      item,
      job: {
        id: 'j1',
        status: 'pending',
        jobType: 'story_ba',
        createdAt: '2026-09-16T10:08:04.000Z',
      },
      nowMs: t0 + 72_000,
    });
    expect(now.visible).toBe(true);
    expect(now.title).toMatch(/in queue/i);
    expect(now.waitReason).toMatch(/worker/i);
    expect(now.elapsedLabel).toBe('1m 12s');
    expect(now.cardLine).toMatch(/BA · queued/);
    expect(now.severity).toBe('working');
  });

  it('shows starting grok when running with no CLI output', () => {
    const now = deriveWorkItemNow({
      item: { ...item, loopStatus: 'idle' },
      job: {
        id: 'j1',
        status: 'running',
        jobType: 'story_ba',
        createdAt: '2026-09-16T10:08:04.000Z',
        startedAt: '2026-09-16T10:08:04.000Z',
      },
      hasCliOutput: false,
      nowMs: t0 + 18_000,
    });
    expect(now.title).toMatch(/Starting grok/i);
    expect(now.cta).toBe('cancel');
  });

  it('escalates copy after 45s of silent running', () => {
    const now = deriveWorkItemNow({
      item,
      job: {
        id: 'j1',
        status: 'running',
        jobType: 'story_ba',
        startedAt: '2026-09-16T10:08:04.000Z',
      },
      hasCliOutput: false,
      nowMs: t0 + 50_000,
    });
    expect(now.title).toMatch(/no CLI output/i);
  });

  it('surfaces approval as needs_you', () => {
    const now = deriveWorkItemNow({
      item: { ...item, loopStatus: 'awaiting_approval' },
      job: { id: 'j1', status: 'awaiting_approval', jobType: 'story_ba' },
    });
    expect(now.severity).toBe('needs_you');
    expect(now.cta).toBe('approve');
    expect(now.cardLine).toBe('Needs approval');
  });

  it('surfaces failed jobs as stopped with retry', () => {
    const now = deriveWorkItemNow({
      item: { ...item, loopStatus: 'failed' },
      job: { id: 'j1', status: 'failed', jobType: 'story_ba', error: 'spawn ENAMETOOLONG' },
    });
    expect(now.severity).toBe('failed');
    expect(now.cta).toBe('retry');
    expect(now.detail).toContain('ENAMETOOLONG');
  });

  it('hides the strip when idle with no live job', () => {
    const now = deriveWorkItemNow({
      item: { ...item, status: 'todo', loopStatus: 'idle' },
      job: { id: 'j1', status: 'completed', jobType: 'story_ba' },
    });
    expect(now.visible).toBe(false);
  });
});
