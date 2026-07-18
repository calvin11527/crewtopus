import { FilterX, Search } from 'lucide-react';
import type { Agent, AgentType, LogSeverity } from '../types';

export interface ConsoleFilterState {
  agentId?: string;
  agentType?: AgentType;
  severity?: LogSeverity;
  text?: string;
  from?: string;
  to?: string;
}

interface ConsoleFiltersProps {
  value: ConsoleFilterState;
  onChange: (next: ConsoleFilterState) => void;
  agents?: Agent[];
}

const AGENT_TYPES: AgentType[] = ['claude', 'grok', 'copilot', 'antigravity', 'ollama', 'mock'];
const SEVERITIES: LogSeverity[] = ['debug', 'info', 'warn', 'error'];

function isoToLocalDatetime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localDatetimeToIso(value: string): string | undefined {
  if (!value.trim()) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function hasActiveFilters(value: ConsoleFilterState): boolean {
  return Boolean(
    value.agentId ||
      value.agentType ||
      value.severity ||
      value.text?.trim() ||
      value.from ||
      value.to
  );
}

export default function ConsoleFilters({ value, onChange, agents }: ConsoleFiltersProps) {
  const patch = (partial: Partial<ConsoleFilterState>) => onChange({ ...value, ...partial });

  return (
    <div id="console-filters" className="console-filters" role="search" aria-label="Log filters">
      <label className="console-filters-field console-filters-field--search">
        <Search size={14} aria-hidden />
        <span className="sr-only">Search logs</span>
        <input
          type="search"
          className="console-filters-input"
          placeholder="Search messages…"
          value={value.text ?? ''}
          onChange={(e) => patch({ text: e.target.value || undefined })}
        />
      </label>

      <label className="console-filters-field">
        <span className="console-filters-label">Agent type</span>
        <select
          className="console-filters-select"
          value={value.agentType ?? ''}
          onChange={(e) =>
            patch({ agentType: (e.target.value as AgentType) || undefined })
          }
        >
          <option value="">All types</option>
          {AGENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>

      <label className="console-filters-field">
        <span className="console-filters-label">Agent</span>
        <select
          className="console-filters-select"
          value={value.agentId ?? ''}
          onChange={(e) => patch({ agentId: e.target.value || undefined })}
        >
          <option value="">All agents</option>
          {(agents ?? []).map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name} ({agent.type})
            </option>
          ))}
        </select>
      </label>

      <label className="console-filters-field">
        <span className="console-filters-label">Severity</span>
        <select
          className="console-filters-select"
          value={value.severity ?? ''}
          onChange={(e) =>
            patch({ severity: (e.target.value as LogSeverity) || undefined })
          }
        >
          <option value="">All levels</option>
          {SEVERITIES.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
      </label>

      <label className="console-filters-field">
        <span className="console-filters-label">From</span>
        <input
          type="datetime-local"
          className="console-filters-input console-filters-input--datetime"
          value={isoToLocalDatetime(value.from)}
          onChange={(e) => patch({ from: localDatetimeToIso(e.target.value) })}
        />
      </label>

      <label className="console-filters-field">
        <span className="console-filters-label">To</span>
        <input
          type="datetime-local"
          className="console-filters-input console-filters-input--datetime"
          value={isoToLocalDatetime(value.to)}
          onChange={(e) => patch({ to: localDatetimeToIso(e.target.value) })}
        />
      </label>

      {hasActiveFilters(value) && (
        <button
          type="button"
          className="btn btn--ghost btn--sm console-filters-clear"
          onClick={() => onChange({})}
        >
          <FilterX size={14} />
          Clear
        </button>
      )}
    </div>
  );
}