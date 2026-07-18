import type { AgentEmployment, WorkingHoursBlock } from '../types';

const DEFAULT_WORKING_HOURS: WorkingHoursBlock[] = [
  { dow: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' },
];

export function defaultWorkingHours(): WorkingHoursBlock[] {
  return DEFAULT_WORKING_HOURS.map((b) => ({ ...b, dow: [...b.dow] }));
}

function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + (m || 0);
}

/** Local date/time parts in the given IANA timezone. */
export function getZonedParts(date: Date, timezone: string): {
  dow: number;
  minutes: number;
  isoDate: string;
} {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';

  const weekday = get('weekday');
  const dowMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));

  return {
    dow: dowMap[weekday] ?? 0,
    minutes: hour * 60 + minute,
    isoDate: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

/** True when `date` falls inside any working-hours block for the employment record. */
export function isOnShift(employment: AgentEmployment, date: Date = new Date()): boolean {
  if (employment.employmentStatus !== 'active') return false;

  const hours =
    employment.workingHours.length > 0 ? employment.workingHours : defaultWorkingHours();
  const { dow, minutes } = getZonedParts(date, employment.timezone);

  for (const block of hours) {
    if (!block.dow.includes(dow)) continue;
    const start = parseTimeToMinutes(block.start);
    const end = parseTimeToMinutes(block.end);
    if (start <= end) {
      if (minutes >= start && minutes < end) return true;
    } else if (minutes >= start || minutes < end) {
      return true;
    }
  }
  return false;
}

/** Expand employment blocks to minute ranges for a reference day (for overlap checks). */
function blocksToRanges(
  blocks: WorkingHoursBlock[],
  refDow: number
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  for (const block of blocks) {
    if (!block.dow.includes(refDow)) continue;
    const start = parseTimeToMinutes(block.start);
    const end = parseTimeToMinutes(block.end);
    if (start < end) {
      ranges.push({ start, end });
    } else {
      ranges.push({ start, end: 24 * 60 });
      ranges.push({ start: 0, end });
    }
  }
  return ranges;
}

function rangesOverlap(
  a: Array<{ start: number; end: number }>,
  b: Array<{ start: number; end: number }>
): boolean {
  for (const ra of a) {
    for (const rb of b) {
      if (ra.start < rb.end && rb.start < ra.end) return true;
    }
  }
  return false;
}

/** Detect overlapping working hours between two employments (any shared weekday). */
export function employmentsConflict(a: AgentEmployment, b: AgentEmployment): boolean {
  const hoursA = a.workingHours.length > 0 ? a.workingHours : defaultWorkingHours();
  const hoursB = b.workingHours.length > 0 ? b.workingHours : defaultWorkingHours();

  for (let dow = 0; dow < 7; dow++) {
    const rangesA = blocksToRanges(hoursA, dow);
    const rangesB = blocksToRanges(hoursB, dow);
    if (rangesOverlap(rangesA, rangesB)) return true;
  }
  return false;
}

export function formatShiftWindow(employment: AgentEmployment): string {
  const hours =
    employment.workingHours.length > 0 ? employment.workingHours : defaultWorkingHours();
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return hours
    .map((b) => {
      const days = b.dow.map((d) => dayNames[d]).join(',');
      return `${days} ${b.start}-${b.end}`;
    })
    .join('; ');
}