/**
 * Parse SuperGrok usage from grok.com page text (EN/ZH) or Crewtopus deep-link params.
 * SuperGrok is a weekly shared pool: overall % ≈ Build % + Conversation %.
 */

export interface SuperGrokUsageSnapshot {
  percent: number;
  build?: number;
  conversation?: number;
  /** ISO string when possible */
  resetAt?: string;
  /** Raw reset phrase if ISO parse is incomplete */
  resetLabel?: string;
  source: 'paste' | 'query' | 'json';
}

function clampPct(n: number): number | undefined {
  if (!Number.isFinite(n) || n < 0 || n > 100) return undefined;
  return Math.round(n * 10) / 10;
}

function firstNumberNear(text: string, index: number, window = 80): number | undefined {
  const slice = text.slice(Math.max(0, index), index + window);
  const m = slice.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
  if (!m) return undefined;
  return clampPct(Number(m[1]));
}

/** Parse Chinese/English SuperGrok reset phrases into a local datetime string. */
export function parseSuperGrokReset(text: string): { iso?: string; label?: string } {
  // 重設於2026年7月25日 晚上11:02 / 上午11:02
  const zh = text.match(
    /重設[於于]\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(早上|上午|中午|下午|晚上)?\s*(\d{1,2}):(\d{2})/
  );
  if (zh) {
    const year = Number(zh[1]);
    const month = Number(zh[2]);
    const day = Number(zh[3]);
    const period = zh[4] || '';
    let hour = Number(zh[5]);
    const minute = Number(zh[6]);
    if (period === '下午' || period === '晚上') {
      if (hour < 12) hour += 12;
    } else if (period === '上午' || period === '早上') {
      if (hour === 12) hour = 0;
    } else if (period === '中午' && hour < 12) {
      hour = 12;
    }
    const label = zh[0];
    const d = new Date(year, month - 1, day, hour, minute, 0, 0);
    if (!Number.isNaN(d.getTime())) {
      return { iso: d.toISOString(), label };
    }
    return { label };
  }

  // Resets on July 25, 2026 at 11:02 PM / Reset: 2026-07-25 23:02
  const en = text.match(
    /reset[s]?\s*(?:on|at|:)?\s*([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})\s*(?:at\s*)?(\d{1,2}):(\d{2})\s*(AM|PM)?/i
  );
  if (en) {
    const months: Record<string, number> = {
      january: 0,
      february: 1,
      march: 2,
      april: 3,
      may: 4,
      june: 5,
      july: 6,
      august: 7,
      september: 8,
      october: 9,
      november: 10,
      december: 11,
    };
    const mi = months[en[1].toLowerCase()];
    if (mi != null) {
      let hour = Number(en[4]);
      const minute = Number(en[5]);
      const ap = (en[6] || '').toUpperCase();
      if (ap === 'PM' && hour < 12) hour += 12;
      if (ap === 'AM' && hour === 12) hour = 0;
      const d = new Date(Number(en[3]), mi, Number(en[2]), hour, minute, 0, 0);
      if (!Number.isNaN(d.getTime())) {
        return { iso: d.toISOString(), label: en[0] };
      }
    }
  }

  const isoLike = text.match(
    /(\d{4})-(\d{2})-(\d{2})[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?/
  );
  if (isoLike) {
    const parsed = Date.parse(isoLike[0].replace(' ', 'T'));
    if (!Number.isNaN(parsed)) {
      return { iso: new Date(parsed).toISOString(), label: isoLike[0] };
    }
  }

  return {};
}

/**
 * Parse free-form SuperGrok UI text (copy from page or bookmarklet scrape).
 * Supports Traditional Chinese labels from grok.com.
 */
export function parseSuperGrokUsageText(raw: string): SuperGrokUsageSnapshot | null {
  const text = raw.replace(/\u00a0/g, ' ').trim();
  if (!text) return null;

  // JSON payload from bookmarklet
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    if (typeof j.percent === 'number' || typeof j.percent === 'string') {
      const percent = clampPct(Number(j.percent));
      if (percent == null) return null;
      return {
        percent,
        build: j.build != null ? clampPct(Number(j.build)) : undefined,
        conversation: j.conversation != null ? clampPct(Number(j.conversation)) : undefined,
        resetAt: typeof j.resetAt === 'string' ? j.resetAt : undefined,
        source: 'json',
      };
    }
  } catch {
    /* not JSON */
  }

  let build: number | undefined;
  let conversation: number | undefined;
  let percent: number | undefined;

  // Prefer labeled buckets
  const buildIdx = text.search(/Grok\s*Build|Build(?!\s*TUI)/i);
  if (buildIdx >= 0) build = firstNumberNear(text, buildIdx);

  const convIdx = text.search(/對話|对话|Conversation/i);
  if (convIdx >= 0) conversation = firstNumberNear(text, convIdx);

  // Overall SuperGrok weekly limit
  const superIdx = text.search(/SuperGrok|每週\s*SuperGrok|每周\s*SuperGrok|weekly.*limit/i);
  if (superIdx >= 0) {
    percent = firstNumberNear(text, superIdx, 120);
  }

  // Fallback: if Build+Conversation present, sum for overall when missing
  if (percent == null && build != null && conversation != null) {
    percent = clampPct(build + conversation);
  }

  // Fallback: first percentage in document after "已使用" / "used"
  if (percent == null) {
    const used = text.match(/(?:已使用|used)\s*[:：]?\s*(\d{1,3}(?:\.\d+)?)\s*%/i);
    if (used) percent = clampPct(Number(used[1]));
  }

  if (percent == null) {
    // Last resort: largest-looking standalone % near SuperGrok keywords only
    return null;
  }

  const reset = parseSuperGrokReset(text);

  return {
    percent,
    build,
    conversation,
    resetAt: reset.iso,
    resetLabel: reset.label,
    source: 'paste',
  };
}

/** Parse Crewtopus deep-link query (?supergrok=1&percent=61&build=59&conversation=2&reset=...). */
export function parseSuperGrokQuery(
  params: URLSearchParams | Record<string, string>
): SuperGrokUsageSnapshot | null {
  const get = (k: string) =>
    params instanceof URLSearchParams ? params.get(k) : params[k] ?? null;

  if (get('supergrok') !== '1' && get('percent') == null && get('sg') == null) {
    return null;
  }

  const percent = clampPct(Number(get('percent') ?? get('sg') ?? ''));
  if (percent == null) return null;

  const build = get('build') != null ? clampPct(Number(get('build'))) : undefined;
  const conversation =
    get('conversation') != null
      ? clampPct(Number(get('conversation')))
      : get('chat') != null
        ? clampPct(Number(get('chat')))
        : undefined;

  let resetAt: string | undefined;
  const resetRaw = get('reset') || get('resetAt');
  if (resetRaw) {
    const parsed = Date.parse(resetRaw);
    if (!Number.isNaN(parsed)) resetAt = new Date(parsed).toISOString();
    else {
      const fromPhrase = parseSuperGrokReset(resetRaw);
      resetAt = fromPhrase.iso;
    }
  }

  return {
    percent,
    build: build ?? undefined,
    conversation: conversation ?? undefined,
    resetAt,
    source: 'query',
  };
}

/** Build deep-link path for Crewtopus Agents page. */
export function buildSuperGrokDeepLink(
  baseUrl: string,
  snap: SuperGrokUsageSnapshot
): string {
  const u = new URL('/agents', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  u.searchParams.set('supergrok', '1');
  u.searchParams.set('percent', String(snap.percent));
  if (snap.build != null) u.searchParams.set('build', String(snap.build));
  if (snap.conversation != null) u.searchParams.set('conversation', String(snap.conversation));
  if (snap.resetAt) u.searchParams.set('reset', snap.resetAt);
  return u.toString();
}

/** datetime-local value from ISO. */
export function toDatetimeLocalValue(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
