import { describe, expect, it } from 'vitest';
import { buildBoardSearchParams, parseBoardSearchParams } from './board-url';

describe('board URL params', () => {
  it('parses sprint id and item', () => {
    const parsed = parseBoardSearchParams(new URLSearchParams('sprint=abc&item=wi-1'));
    expect(parsed.sprintId).toBe('abc');
    expect(parsed.itemId).toBe('wi-1');
  });

  it('treats sprint=all as All items', () => {
    expect(parseBoardSearchParams(new URLSearchParams('sprint=all')).sprintId).toBeNull();
  });

  it('leaves sprint undefined when omitted', () => {
    expect(parseBoardSearchParams(new URLSearchParams('item=x')).sprintId).toBeUndefined();
  });

  it('writes sprint=all and clears item', () => {
    const next = buildBoardSearchParams(new URLSearchParams('sprint=abc&item=wi-1'), {
      sprint: null,
      item: null,
    });
    expect(next.get('sprint')).toBe('all');
    expect(next.get('item')).toBeNull();
  });
});
