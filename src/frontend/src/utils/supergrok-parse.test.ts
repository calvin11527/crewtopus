import { describe, it, expect } from 'vitest';
import {
  parseSuperGrokUsageText,
  parseSuperGrokQuery,
  parseSuperGrokReset,
} from './supergrok-parse';

const ZH_SAMPLE = `
每週 SuperGrok 限制
61%
已使用
重設於2026年7月25日 晚上11:02
Grok Build
59%
對話
2%
`;

describe('supergrok-parse', () => {
  it('parses Traditional Chinese SuperGrok dashboard text', () => {
    const snap = parseSuperGrokUsageText(ZH_SAMPLE);
    expect(snap).not.toBeNull();
    expect(snap!.percent).toBe(61);
    expect(snap!.build).toBe(59);
    expect(snap!.conversation).toBe(2);
    expect(snap!.resetAt).toBeTruthy();
    const d = new Date(snap!.resetAt!);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6); // July
    expect(d.getDate()).toBe(25);
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(2);
  });

  it('parses bookmarklet JSON', () => {
    const snap = parseSuperGrokUsageText(
      JSON.stringify({ percent: 61, build: 59, conversation: 2, resetAt: '2026-07-25T15:02:00.000Z' })
    );
    expect(snap?.percent).toBe(61);
    expect(snap?.build).toBe(59);
    expect(snap?.source).toBe('json');
  });

  it('parses deep-link query params', () => {
    const snap = parseSuperGrokQuery(
      new URLSearchParams('supergrok=1&percent=61&build=59&conversation=2&reset=2026-07-25T23:02:00')
    );
    expect(snap?.percent).toBe(61);
    expect(snap?.build).toBe(59);
    expect(snap?.conversation).toBe(2);
  });

  it('parses English reset phrase', () => {
    const r = parseSuperGrokReset('Resets on July 25, 2026 at 11:02 PM');
    expect(r.iso).toBeTruthy();
    const d = new Date(r.iso!);
    expect(d.getMonth()).toBe(6);
    expect(d.getDate()).toBe(25);
  });
});
