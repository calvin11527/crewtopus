import { getDatabase } from '../database';
import type {
  AgentType,
  LogEvent,
  LogEventInput,
  LogEventListResponse,
  LogEventQuery,
  LogSeverity,
} from '../types';
import { generateId, now, parseJson } from '../utils/helpers';

const LOG_SEVERITIES: LogSeverity[] = ['debug', 'info', 'warn', 'error'];
const LOG_AGENT_TYPES: AgentType[] = ['claude', 'grok', 'copilot', 'antigravity', 'ollama', 'mock'];
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const MAX_TEXT_LENGTH = 500;

interface LogEventRow {
  id: string;
  agent_id: string | null;
  agent_type: string | null;
  severity: string;
  message: string;
  source: string | null;
  work_item_id: string | null;
  metadata: string | null;
  created_at: string;
}

function mapLogEvent(row: LogEventRow): LogEvent {
  return {
    id: row.id,
    agentId: row.agent_id ?? undefined,
    agentType: (row.agent_type as AgentType) ?? undefined,
    severity: row.severity as LogSeverity,
    message: row.message,
    source: row.source ?? undefined,
    workItemId: row.work_item_id ?? undefined,
    metadata: row.metadata ? parseJson<Record<string, unknown>>(row.metadata, {}) : undefined,
    createdAt: row.created_at,
  };
}

/** Escape SQL LIKE wildcards so user text is matched literally. */
export function escapeLikePattern(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/** Validate severity and message for log ingestion. */
export function validateLogEventInput(input: LogEventInput): string | null {
  if (!input.message || typeof input.message !== 'string' || !input.message.trim()) {
    return 'message is required';
  }
  if (input.severity === undefined || input.severity === null) {
    return 'severity is required';
  }
  if (!LOG_SEVERITIES.includes(input.severity)) {
    return `severity must be one of: ${LOG_SEVERITIES.join(', ')}`;
  }
  return null;
}

/** Persist a single log event to the database. */
export function persistLogEvent(input: LogEventInput): LogEvent {
  const error = validateLogEventInput(input);
  if (error) {
    throw new Error(error);
  }

  const id = input.id ?? generateId();
  const createdAt = input.createdAt ?? now();

  getDatabase()
    .prepare(
      `INSERT INTO log_event
       (id, agent_id, agent_type, severity, message, source, work_item_id, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.agentId ?? null,
      input.agentType ?? null,
      input.severity,
      input.message.trim(),
      input.source ?? null,
      input.workItemId ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      createdAt
    );

  return {
    id,
    agentId: input.agentId,
    agentType: input.agentType,
    severity: input.severity,
    message: input.message.trim(),
    source: input.source,
    workItemId: input.workItemId,
    metadata: input.metadata,
    createdAt,
  };
}

/** Persist multiple log events in one transaction. */
export function persistLogEvents(inputs: LogEventInput[]): LogEvent[] {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new Error('events array is required');
  }

  const db = getDatabase();
  const created: LogEvent[] = [];
  const tx = db.transaction((items: LogEventInput[]) => {
    for (const input of items) {
      created.push(persistLogEvent(input));
    }
  });

  tx(inputs);
  return created;
}

function clampLimit(limit?: number): number {
  if (limit === undefined || Number.isNaN(limit)) return DEFAULT_LIMIT;
  return Math.min(Math.max(1, Math.floor(limit)), MAX_LIMIT);
}

function clampOffset(offset?: number): number {
  if (offset === undefined || Number.isNaN(offset)) return 0;
  return Math.max(0, Math.floor(offset));
}

function buildLogQuery(options: LogEventQuery): {
  whereSql: string;
  params: unknown[];
  limit: number;
  offset: number;
} {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.agentId) {
    conditions.push('agent_id = ?');
    params.push(options.agentId);
  }
  if (options.agentType) {
    if (!LOG_AGENT_TYPES.includes(options.agentType)) {
      throw new Error(`agentType must be one of: ${LOG_AGENT_TYPES.join(', ')}`);
    }
    conditions.push('agent_type = ?');
    params.push(options.agentType);
  }
  if (options.severity) {
    if (!LOG_SEVERITIES.includes(options.severity)) {
      throw new Error(`severity must be one of: ${LOG_SEVERITIES.join(', ')}`);
    }
    conditions.push('severity = ?');
    params.push(options.severity);
  }
  if (options.workItemId) {
    conditions.push('work_item_id = ?');
    params.push(options.workItemId);
  }
  if (options.text?.trim()) {
    const trimmed = options.text.trim();
    if (trimmed.length > MAX_TEXT_LENGTH) {
      throw new Error(`text search must be at most ${MAX_TEXT_LENGTH} characters`);
    }
    conditions.push("LOWER(message) LIKE ? ESCAPE '\\'");
    params.push(`%${escapeLikePattern(trimmed.toLowerCase())}%`);
  }
  if (options.from) {
    conditions.push('created_at >= ?');
    params.push(options.from);
  }
  if (options.to) {
    conditions.push('created_at <= ?');
    params.push(options.to);
  }

  const whereSql = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
  return {
    whereSql,
    params,
    limit: clampLimit(options.limit),
    offset: clampOffset(options.offset),
  };
}

/** Query persisted log events with filters and pagination. */
export function queryLogEvents(options: LogEventQuery = {}): LogEventListResponse {
  const db = getDatabase();
  const { whereSql, params, limit, offset } = buildLogQuery(options);

  const totalRow = db
    .prepare(`SELECT COUNT(*) as c FROM log_event${whereSql}`)
    .get(...params) as { c: number };

  const rows = db
    .prepare(
      `SELECT * FROM log_event${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as LogEventRow[];

  return {
    items: rows.map(mapLogEvent),
    total: totalRow.c,
    limit,
    offset,
  };
}

/** Get a single log event by ID. */
export function getLogEvent(id: string): LogEvent | null {
  const row = getDatabase()
    .prepare('SELECT * FROM log_event WHERE id = ?')
    .get(id) as LogEventRow | undefined;
  return row ? mapLogEvent(row) : null;
}