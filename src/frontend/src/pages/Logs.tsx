import { useCallback, useMemo, useState } from 'react';
import { Copy, Download, FileJson, Terminal } from 'lucide-react';
import { useAgents, useLogEvents } from '../api/hooks';
import ConsoleFilters, { type ConsoleFilterState } from '../components/ConsoleFilters';
import StreamingConsole from '../components/StreamingConsole';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { flattenLogEventPages, flattenLogPages } from '../utils/log-events';
import {
  copyConsoleEntriesToClipboard,
  exportLogEventsFile,
  serializeLogExportFilters,
} from '../utils/log-export';
import type { ConsoleLogEntry } from '../utils/work-item-console';

export default function Logs() {
  const [filters, setFilters] = useState<ConsoleFilterState>({});
  const [selectedEntry, setSelectedEntry] = useState<ConsoleLogEntry | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const debouncedText = useDebouncedValue(filters.text ?? '', 300);
  const { data: agents } = useAgents();

  const queryFilters = useMemo(
    () => ({
      agentId: filters.agentId,
      agentType: filters.agentType,
      severity: filters.severity,
      text: debouncedText.trim() || undefined,
      from: filters.from,
      to: filters.to,
    }),
    [
      filters.agentId,
      filters.agentType,
      filters.severity,
      debouncedText,
      filters.from,
      filters.to,
    ]
  );

  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage, isError, error } =
    useLogEvents(queryFilters);

  const logEvents = useMemo(
    () => flattenLogEventPages(data?.pages ?? []),
    [data?.pages]
  );

  const entries = useMemo(
    () => flattenLogPages(data?.pages ?? []),
    [data?.pages]
  );

  const exportFilters = useMemo(
    () =>
      serializeLogExportFilters({
        agentId: queryFilters.agentId,
        agentType: queryFilters.agentType,
        severity: queryFilters.severity,
        text: queryFilters.text,
        from: queryFilters.from,
        to: queryFilters.to,
      }),
    [queryFilters]
  );

  const total = data?.pages[0]?.total ?? 0;
  const showing = entries.length;

  const handleCopySelected = useCallback(async () => {
    if (!selectedEntry) return;
    const ok = await copyConsoleEntriesToClipboard([selectedEntry]);
    if (ok) {
      setCopyFeedback('Copied');
      window.setTimeout(() => setCopyFeedback(null), 2000);
    }
  }, [selectedEntry]);

  const handleExport = useCallback(
    (format: 'log' | 'json') => {
      if (logEvents.length === 0) return;
      exportLogEventsFile(logEvents, format, exportFilters);
    },
    [logEvents, exportFilters]
  );

  return (
    <div id="page-logs" className="page page--wide">
      <header className="page-header">
        <h2>Server Logs</h2>
        <p className="page-subtitle">
          Filter, search, and browse persisted log events from the backend API
        </p>
      </header>

      <ConsoleFilters value={filters} onChange={setFilters} agents={agents} />

      <div className="log-console-panel card">
        <div className="log-console-panel-header">
          <div className="log-console-panel-title">
            <Terminal size={16} />
            <span>Log console</span>
          </div>
          <div className="log-console-panel-actions">
            <span className="log-console-panel-meta">
              {isLoading
                ? 'Loading…'
                : `${showing.toLocaleString()} shown${total > showing ? ` of ${total.toLocaleString()}` : ''}`}
            </span>
            {copyFeedback && (
              <span className="log-console-copy-feedback" role="status">
                {copyFeedback}
              </span>
            )}
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => void handleCopySelected()}
              disabled={!selectedEntry}
              title="Copy selected line with timestamp and severity"
              aria-label="Copy selected log line"
            >
              <Copy size={12} />
              Copy
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => handleExport('log')}
              disabled={logEvents.length === 0}
              title="Download filtered logs as .log"
              aria-label="Export filtered logs as log file"
            >
              <Download size={12} />
              .log
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => handleExport('json')}
              disabled={logEvents.length === 0}
              title="Download filtered logs as JSON"
              aria-label="Export filtered logs as JSON"
            >
              <FileJson size={12} />
              .json
            </button>
          </div>
        </div>

        {isError ? (
          <p className="log-console-error" role="alert">
            {(error as Error).message || 'Failed to load logs'}
          </p>
        ) : isLoading && entries.length === 0 ? (
          <p className="loading-text log-console-loading">Loading logs…</p>
        ) : entries.length === 0 ? (
          <div className="empty-state log-console-empty">
            <p>No log events match the current filters.</p>
          </div>
        ) : (
          <div className="log-console-body">
            <StreamingConsole
              id="server-log-terminal"
              entries={entries}
              className="streaming-console--logs"
              showToolbar={false}
              onSelectedEntryChange={setSelectedEntry}
              onReachTop={hasNextPage ? () => void fetchNextPage() : undefined}
              loadingMore={isFetchingNextPage}
              hasMore={hasNextPage}
            />
          </div>
        )}
      </div>
    </div>
  );
}