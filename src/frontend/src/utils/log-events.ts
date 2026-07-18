import type { LogEvent, LogEventListResponse, LogEventQuery } from '../types';
import type { ConsoleLogEntry, ConsoleLogSeverity } from './work-item-console';

export const LOG_PAGE_SIZE = 50;

/** Build query string for GET /api/logs. */
export function buildLogEventsQuery(params: LogEventQuery): string {
  const sp = new URLSearchParams();
  if (params.agentId) sp.set('agentId', params.agentId);
  if (params.agentType) sp.set('agentType', params.agentType);
  if (params.severity) sp.set('severity', params.severity);
  if (params.text?.trim()) sp.set('text', params.text.trim());
  if (params.from) sp.set('from', params.from);
  if (params.to) sp.set('to', params.to);
  if (params.workItemId) sp.set('workItemId', params.workItemId);
  if (params.limit != null) sp.set('limit', String(params.limit));
  if (params.offset != null) sp.set('offset', String(params.offset));
  const q = sp.toString();
  return q ? `?${q}` : '';
}

function toConsoleSeverity(severity: LogEvent['severity']): ConsoleLogSeverity {
  if (severity === 'warn') return 'warn';
  if (severity === 'error') return 'error';
  return 'info';
}

/** Shared log line message: `[agent] (source) message`; falls back to `[system]` when agent is absent. */
export function formatLogEventMessage(event: LogEvent): string {
  const agentLabel = `[${event.agentType ?? 'system'}] `;
  const sourceLabel = event.source ? `(${event.source}) ` : '';
  return `${agentLabel}${sourceLabel}${event.message}`;
}

/** Map a persisted log event to a console row (oldest-first display). */
export function logEventToConsoleEntry(event: LogEvent): ConsoleLogEntry {
  return {
    id: event.id,
    timestamp: event.createdAt,
    severity: toConsoleSeverity(event.severity),
    message: formatLogEventMessage(event),
  };
}

/** Flatten infinite-query pages into chronological log events (oldest first). */
export function flattenLogEventPages(pages: LogEventListResponse[]): LogEvent[] {
  return pages
    .slice()
    .reverse()
    .flatMap((page) => [...page.items].reverse());
}

/** Flatten infinite-query pages into chronological console entries (oldest first). */
export function flattenLogPages(pages: LogEventListResponse[]): ConsoleLogEntry[] {
  return flattenLogEventPages(pages).map(logEventToConsoleEntry);
}