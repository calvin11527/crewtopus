import { describe, it, expect } from 'vitest';
import { queryKeys } from './hooks';

describe('queryKeys', () => {
  it('builds stable work item activity keys', () => {
    expect(queryKeys.workItemActivity('abc')).toEqual(['work-items', 'abc', 'activity']);
  });

  it('invalidates loop history per work item', () => {
    expect(queryKeys.workItemLoop('wi-99')).toEqual(['work-items', 'wi-99', 'loop']);
  });
});