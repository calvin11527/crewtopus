import { ArrowDownToLine, Copy, Download, Pause, Search } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import {
  List,
  useDynamicRowHeight,
  type ListImperativeAPI,
  type RowComponentProps,
} from 'react-window';
import {
  copyConsoleEntriesToClipboard,
  exportConsoleEntriesFile,
  type LogExportFormat,
} from '../utils/log-export';
import {
  filterConsoleEntries,
  formatConsoleTimestamp,
  type ConsoleLogEntry,
  type ConsoleLogSeverity,
  type ConsoleSeverityFilter,
} from '../utils/work-item-console';

const AUTOSCROLL_KEY = 'agenthub.console.autoscroll';
const SCROLL_PIN_THRESHOLD_PX = 24;
const SCROLL_TOP_THRESHOLD_PX = 48;
const DEFAULT_LIST_HEIGHT_PX = 240;
const CONSOLE_LINE_DEFAULT_HEIGHT_PX = 24;
const LIST_OVERSCAN_COUNT = 8;

const SEVERITY_LABEL: Record<ConsoleLogSeverity, string> = {
  info: 'INFO',
  warn: 'WARN',
  error: 'ERR',
};

function readAutoscrollPreference(): boolean {
  try {
    const stored = localStorage.getItem(AUTOSCROLL_KEY);
    if (stored === 'false') return false;
    if (stored === 'true') return true;
  } catch {
    /* ignore */
  }
  return true;
}

function isPinnedToBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_PIN_THRESHOLD_PX;
}

interface ConsoleLogRowData {
  entries: ConsoleLogEntry[];
  selectedEntryId: string | null;
  onSelectLine: (entryId: string) => void;
}

function ConsoleLogRow({
  index,
  style,
  ariaAttributes,
  entries,
  selectedEntryId,
  onSelectLine,
}: RowComponentProps<ConsoleLogRowData>): ReactElement | null {
  const entry = entries[index];
  if (!entry) return null;

  const isSelected = entry.id === selectedEntryId;

  return (
    <div
      style={style}
      className={`streaming-console-line${isSelected ? ' streaming-console-line--selected' : ''}`}
      data-severity={entry.severity}
      data-stream={entry.stream}
      data-partial={entry.partial ? 'true' : undefined}
      role="option"
      aria-selected={isSelected}
      aria-posinset={ariaAttributes['aria-posinset']}
      aria-setsize={ariaAttributes['aria-setsize']}
    >
      <button
        type="button"
        className="streaming-console-line-gutter"
        onClick={() => onSelectLine(entry.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelectLine(entry.id);
          }
        }}
        title="Select line for copy"
      >
        <time className="streaming-console-ts" dateTime={entry.timestamp}>
          {formatConsoleTimestamp(entry.timestamp)}
        </time>
        <span
          className={`streaming-console-badge streaming-console-badge--${entry.severity}`}
          title={SEVERITY_LABEL[entry.severity]}
        >
          {SEVERITY_LABEL[entry.severity]}
        </span>
      </button>
      <span className="streaming-console-msg">{entry.message}</span>
    </div>
  );
}

interface StreamingConsoleProps {
  id: string;
  entries: ConsoleLogEntry[];
  className?: string;
  /** Fired when the user scrolls near the top (e.g. to load older log pages). */
  onReachTop?: () => void;
  loadingMore?: boolean;
  hasMore?: boolean;
  /** Show inline severity/text filters and export controls (default true). */
  showToolbar?: boolean;
  /** Notified when the user selects or clears a line (e.g. parent toolbar copy). */
  onSelectedEntryChange?: (entry: ConsoleLogEntry | null) => void;
  /** Export format for the toolbar download action (default log). */
  exportFormat?: LogExportFormat;
}

/** Real-time log stream with timestamps, severity badges, autoscroll, and selectable lines. */
export default function StreamingConsole({
  id,
  entries,
  className,
  onReachTop,
  loadingMore = false,
  hasMore = false,
  showToolbar = true,
  onSelectedEntryChange,
  exportFormat = 'log',
}: StreamingConsoleProps) {
  const listRef = useRef<ListImperativeAPI | null>(null);
  const logShellRef = useRef<HTMLDivElement>(null);
  const rowCountRef = useRef(0);
  const [listHeight, setListHeight] = useState(0);
  const [autoscroll, setAutoscroll] = useState(readAutoscrollPreference);
  const [pinnedToBottom, setPinnedToBottom] = useState(true);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<ConsoleSeverityFilter>('all');
  const [textFilter, setTextFilter] = useState('');

  const visibleEntries = useMemo(
    () => filterConsoleEntries(entries, { severity: severityFilter, text: textFilter }),
    [entries, severityFilter, textFilter]
  );

  rowCountRef.current = visibleEntries.length;

  // Only reset measured heights when filters change — not on every new line
  // (length-based keys thrash the cache and amplify scroll races during streaming).
  const dynamicRowHeight = useDynamicRowHeight({
    defaultRowHeight: CONSOLE_LINE_DEFAULT_HEIGHT_PX,
    key: `${severityFilter}:${textFilter}`,
  });

  const selectedEntry = visibleEntries.find((e) => e.id === selectedEntryId) ?? null;

  const selectLine = useCallback(
    (entryId: string) => {
      setSelectedEntryId((prev) => {
        const next = prev === entryId ? null : entryId;
        if (onSelectedEntryChange) {
          const entry = visibleEntries.find((e) => e.id === next) ?? null;
          onSelectedEntryChange(entry);
        }
        return next;
      });
    },
    [onSelectedEntryChange, visibleEntries]
  );

  const rowProps = useMemo<ConsoleLogRowData>(
    () => ({
      entries: visibleEntries,
      selectedEntryId,
      onSelectLine: selectLine,
    }),
    [visibleEntries, selectedEntryId, selectLine]
  );

  const effectiveListHeight = listHeight > 0 ? listHeight : DEFAULT_LIST_HEIGHT_PX;

  /**
   * Scroll to the last console line. react-window's scrollToRow throws RangeError when the
   * index is outside its internal itemCount (can lag React state during mount/resize/stream).
   * Guard the index and fall back to raw element scroll when needed.
   */
  const scrollToBottom = useCallback((behavior: 'auto' | 'instant' = 'instant') => {
    const list = listRef.current;
    if (!list) return;

    const rowCount = rowCountRef.current;
    if (rowCount <= 0) return;

    const index = rowCount - 1;
    try {
      list.scrollToRow({
        index,
        align: 'end',
        behavior,
      });
    } catch {
      // Index out of sync with List's internal itemCount, or list not fully committed.
      const el = list.element;
      if (!el) return;
      const top = Math.max(0, el.scrollHeight - el.clientHeight);
      if (typeof el.scrollTo === 'function') {
        el.scrollTo({
          top,
          behavior: behavior === 'instant' ? 'auto' : behavior,
        });
      } else {
        el.scrollTop = top;
      }
    }
  }, []);

  const toggleAutoscroll = useCallback(() => {
    setAutoscroll((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(AUTOSCROLL_KEY, String(next));
      } catch {
        /* ignore */
      }
      if (next) {
        setPinnedToBottom(true);
      }
      return next;
    });
  }, []);

  const handleScroll = useCallback(() => {
    const el = listRef.current?.element;
    if (!el) return;
    setPinnedToBottom(isPinnedToBottom(el));
    if (onReachTop && hasMore && !loadingMore && el.scrollTop <= SCROLL_TOP_THRESHOLD_PX) {
      onReachTop();
    }
  }, [onReachTop, hasMore, loadingMore]);

  const handleListResize = useCallback(() => {
    if (autoscroll && pinnedToBottom) {
      scrollToBottom();
    }
  }, [autoscroll, pinnedToBottom, scrollToBottom]);

  const handleRowsRendered = useCallback(
    (visible: { startIndex: number; stopIndex: number }) => {
      const rowCount = rowCountRef.current;
      if (!autoscroll || !pinnedToBottom || rowCount === 0) return;
      const lastIndex = rowCount - 1;
      // Only nudge when the list itself reports rows short of the last index.
      // Avoid scrolling to an index the List has not accepted yet (throws RangeError).
      if (visible.stopIndex >= 0 && visible.stopIndex < lastIndex) {
        scrollToBottom('instant');
      }
    },
    [autoscroll, pinnedToBottom, scrollToBottom]
  );

  const copySelectedLine = useCallback(async () => {
    if (!selectedEntry) return;
    await copyConsoleEntriesToClipboard([selectedEntry]);
  }, [selectedEntry]);

  const exportVisibleLines = useCallback(() => {
    if (visibleEntries.length === 0) return;
    exportConsoleEntriesFile(visibleEntries, exportFormat);
  }, [visibleEntries, exportFormat]);

  useEffect(() => {
    const el = logShellRef.current;
    if (!el) return;

    const updateHeight = () => {
      setListHeight(el.clientHeight);
    };

    updateHeight();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => updateHeight());
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!autoscroll || !pinnedToBottom) return;
    scrollToBottom();
    const raf = requestAnimationFrame(() => scrollToBottom());
    return () => cancelAnimationFrame(raf);
  }, [entries, autoscroll, pinnedToBottom, scrollToBottom, visibleEntries.length]);

  useEffect(() => {
    if (!visibleEntries.some((e) => e.id === selectedEntryId)) {
      setSelectedEntryId(null);
      onSelectedEntryChange?.(null);
    }
  }, [visibleEntries, selectedEntryId, onSelectedEntryChange]);

  return (
    <div className={className ? `streaming-console ${className}` : 'streaming-console'}>
      {showToolbar && (
        <div className="streaming-console-toolbar">
          <div className="streaming-console-toolbar-start">
            <label className="streaming-console-filter-search" htmlFor={`${id}-filter-text`}>
              <Search size={12} aria-hidden />
              <input
                id={`${id}-filter-text`}
                type="search"
                className="streaming-console-filter-input"
                placeholder="Filter lines…"
                value={textFilter}
                onChange={(e) => setTextFilter(e.target.value)}
                aria-label="Filter console lines by message text"
              />
            </label>
            <div
              className="streaming-console-severity-filters"
              role="group"
              aria-label="Filter by severity"
            >
              {(['all', 'info', 'warn', 'error'] as ConsoleSeverityFilter[]).map((level) => (
                <button
                  key={level}
                  type="button"
                  data-severity={level}
                  className={`streaming-console-severity-btn${
                    severityFilter === level ? ' streaming-console-severity-btn--active' : ''
                  }`}
                  onClick={() => setSeverityFilter(level)}
                  aria-pressed={severityFilter === level}
                >
                  {level === 'all' ? 'All' : SEVERITY_LABEL[level]}
                </button>
              ))}
            </div>
          </div>
          <div className="streaming-console-toolbar-end">
            {selectedEntry && (
              <button
                type="button"
                className="btn btn--ghost btn--sm streaming-console-copy"
                onClick={() => void copySelectedLine()}
                title="Copy selected line"
                aria-label="Copy selected line"
              >
                <Copy size={12} />
                Copy
              </button>
            )}
            <button
              type="button"
              className="btn btn--ghost btn--sm streaming-console-export"
              onClick={exportVisibleLines}
              disabled={visibleEntries.length === 0}
              title={
                exportFormat === 'json'
                  ? 'Export visible lines as JSON'
                  : 'Export visible lines as .log'
              }
              aria-label={
                exportFormat === 'json'
                  ? 'Export visible console lines as JSON'
                  : 'Export visible console lines as log'
              }
            >
              <Download size={12} />
              Export
            </button>
            <button
              type="button"
              className={`btn btn--ghost btn--sm streaming-console-autoscroll${autoscroll ? ' streaming-console-autoscroll--on' : ''}`}
              onClick={toggleAutoscroll}
              aria-pressed={autoscroll}
              aria-label="Toggle autoscroll"
              title={autoscroll ? 'Autoscroll on — click to pause' : 'Autoscroll off — click to resume'}
            >
              {autoscroll ? <ArrowDownToLine size={12} /> : <Pause size={12} />}
              Scroll {autoscroll ? 'on' : 'off'}
            </button>
          </div>
        </div>
      )}
      <div ref={logShellRef} className="streaming-console-log-shell">
        <div
          className="streaming-console-log-live"
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-atomic="false"
        >
          <List
            id={id}
            listRef={listRef}
            className="streaming-console-log streaming-console-lines"
            role="listbox"
            aria-label="Console log lines"
            rowCount={visibleEntries.length}
            rowHeight={dynamicRowHeight}
            rowComponent={ConsoleLogRow}
            rowProps={rowProps}
            overscanCount={LIST_OVERSCAN_COUNT}
            defaultHeight={effectiveListHeight}
            style={{ height: effectiveListHeight, width: '100%' }}
            onScroll={handleScroll}
            onResize={handleListResize}
            onRowsRendered={handleRowsRendered}
          >
            {loadingMore && (
              <p className="streaming-console-loading-more" role="status">
                Loading older lines…
              </p>
            )}
          </List>
        </div>
      </div>
    </div>
  );
}