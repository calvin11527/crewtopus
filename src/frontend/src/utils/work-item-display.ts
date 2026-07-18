/**
 * Work item titles sometimes contain full markdown docs (agent/bootstrap mistakes).
 * UI always shows a short heading; full text is available via helpers.
 */

const DEFAULT_MAX = 100;

/** First non-empty line, stripped of light markdown noise. */
export function firstLineTitle(title: string): string {
  const lines = title.replace(/\r\n/g, '\n').split('\n');
  for (const line of lines) {
    let cleaned = line.trim();
    if (!cleaned) continue;
    cleaned = cleaned
      .replace(/^\>\s*/, '')
      .replace(/\*\*/g, '')
      .replace(/^#+\s*/, '')
      .replace(/^Epic:\s*#+\s*/i, 'Epic: ')
      .replace(/^Epic:\s*/i, 'Epic: ')
      .replace(/\s+#+\s*/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (cleaned) return cleaned;
  }
  return title.trim() || 'Untitled';
}

/** Compact title for cards and detail headers. */
export function displayWorkItemTitle(title: string, maxLen = DEFAULT_MAX): string {
  const head = firstLineTitle(title || '');
  if (head.length <= maxLen) return head;
  return `${head.slice(0, Math.max(1, maxLen - 1))}…`;
}

/** True when title is multi-line or longer than a normal card heading. */
export function isOversizedTitle(title: string, maxLen = DEFAULT_MAX): boolean {
  if (!title) return false;
  if (title.includes('\n')) return true;
  return title.trim().length > maxLen;
}

/** Remainder of title after the first line (for collapsible "full document" UI). */
export function titleOverflowBody(title: string): string {
  const normalized = title.replace(/\r\n/g, '\n').trim();
  const idx = normalized.indexOf('\n');
  if (idx === -1) {
    if (normalized.length <= DEFAULT_MAX) return '';
    return normalized;
  }
  return normalized.slice(idx + 1).trim();
}
