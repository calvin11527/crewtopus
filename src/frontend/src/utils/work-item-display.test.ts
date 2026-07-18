import { describe, it, expect } from 'vitest';
import {
  displayWorkItemTitle,
  firstLineTitle,
  isOversizedTitle,
  titleOverflowBody,
} from './work-item-display';

const longDoc = `Epic: # Sprint Goal — Market Trend Desk

## Status
Active

**By sprint end** we ship a desk.
`;

describe('work-item-display', () => {
  it('uses first heading line for display', () => {
    expect(firstLineTitle(longDoc)).toBe('Epic: Sprint Goal — Market Trend Desk');
    expect(displayWorkItemTitle(longDoc).startsWith('Epic:')).toBe(true);
    expect(displayWorkItemTitle(longDoc).includes('## Status')).toBe(false);
  });

  it('detects oversized multi-line titles', () => {
    expect(isOversizedTitle(longDoc)).toBe(true);
    expect(isOversizedTitle('Short title')).toBe(false);
  });

  it('returns overflow body after first line', () => {
    const body = titleOverflowBody(longDoc);
    expect(body).toContain('## Status');
    expect(body.startsWith('Epic:')).toBe(false);
  });

  it('truncates very long single-line titles', () => {
    const one = 'A'.repeat(200);
    expect(displayWorkItemTitle(one).length).toBeLessThanOrEqual(100);
    expect(displayWorkItemTitle(one).endsWith('…')).toBe(true);
  });
});
