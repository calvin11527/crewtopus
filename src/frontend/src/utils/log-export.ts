import type { LogEvent, LogSeverity } from '../types';
import { formatLogEventMessage } from './log-events';
import type { ConsoleLogEntry } from './work-item-console';

export type LogExportFormat = 'log' | 'json';

export interface LogLineInput {
  timestamp: string;
  severity: string;
  message: string;
}

const LOG_SEVERITY_LABEL: Record<LogSeverity, string> = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
};

const CONSOLE_SEVERITY_LABEL = {
  info: 'INFO',
  warn: 'WARN',
  error: 'ERR',
} as const;

/** ISO timestamp for clipboard and .log exports. */
export function formatLogTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString();
}

/** Single line: `[timestamp] SEVERITY [agent] message` */
export function formatLogLine(line: LogLineInput): string {
  return `[${formatLogTimestamp(line.timestamp)}] ${line.severity.toUpperCase()} ${line.message}`;
}

export function logEventToLine(event: LogEvent): LogLineInput {
  return {
    timestamp: event.createdAt,
    severity: LOG_SEVERITY_LABEL[event.severity],
    message: formatLogEventMessage(event),
  };
}

export function consoleEntryToLine(entry: ConsoleLogEntry): LogLineInput {
  return {
    timestamp: entry.timestamp,
    severity: CONSOLE_SEVERITY_LABEL[entry.severity],
    message: entry.message,
  };
}

/** Plain-text .log body (one line per event). */
export function formatLogLinesAsText(lines: LogLineInput[]): string {
  return lines.map(formatLogLine).join('\n');
}

export function formatLogEventsAsText(events: LogEvent[]): string {
  return formatLogLinesAsText(events.map(logEventToLine));
}

export function formatConsoleEntriesAsText(entries: ConsoleLogEntry[]): string {
  return formatLogLinesAsText(entries.map(consoleEntryToLine));
}

export interface LogExportJsonPayload {
  exportedAt: string;
  count: number;
  filters?: Record<string, string | undefined>;
  items: LogEvent[];
}

/** Structured JSON export with optional filter metadata. */
export function formatLogEventsAsJson(
  events: LogEvent[],
  filters?: Record<string, string | undefined>
): string {
  const payload: LogExportJsonPayload = {
    exportedAt: new Date().toISOString(),
    count: events.length,
    filters: filters && Object.keys(filters).length > 0 ? filters : undefined,
    items: events,
  };
  return JSON.stringify(payload, null, 2);
}

export function formatConsoleEntriesAsJson(entries: ConsoleLogEntry[]): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      count: entries.length,
      items: entries.map((entry) => ({
        id: entry.id,
        timestamp: entry.timestamp,
        severity: entry.severity,
        message: entry.message,
        stream: entry.stream,
        partial: entry.partial,
      })),
    },
    null,
    2
  );
}

/** Trigger a browser download for text content. */
export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function exportLogEventsFile(
  events: LogEvent[],
  format: LogExportFormat,
  filters?: Record<string, string | undefined>
): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  if (format === 'json') {
    downloadTextFile(
      `agenthub-logs-${stamp}.json`,
      formatLogEventsAsJson(events, filters),
      'application/json'
    );
    return;
  }
  downloadTextFile(`agenthub-logs-${stamp}.log`, formatLogEventsAsText(events), 'text/plain');
}

export function exportConsoleEntriesFile(entries: ConsoleLogEntry[], format: LogExportFormat): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  if (format === 'json') {
    downloadTextFile(
      `agenthub-console-${stamp}.json`,
      formatConsoleEntriesAsJson(entries),
      'application/json'
    );
    return;
  }
  downloadTextFile(`agenthub-console-${stamp}.log`, formatConsoleEntriesAsText(entries), 'text/plain');
}

/** Copy formatted lines to the clipboard; returns false when unavailable. */
export async function copyLogLinesToClipboard(lines: LogLineInput[]): Promise<boolean> {
  if (lines.length === 0) return false;
  const text = formatLogLinesAsText(lines);
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export async function copyConsoleEntriesToClipboard(entries: ConsoleLogEntry[]): Promise<boolean> {
  return copyLogLinesToClipboard(entries.map(consoleEntryToLine));
}

/** Active log filters for export metadata (omits empty values). */
export function serializeLogExportFilters(
  filters: Record<string, string | undefined>
): Record<string, string> | undefined {
  const active = Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value != null && value !== '')
  ) as Record<string, string>;
  return Object.keys(active).length > 0 ? active : undefined;
}