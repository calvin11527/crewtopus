import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as logExport from '../utils/log-export';
import StreamingConsole from './StreamingConsole';
import type { ConsoleLogEntry } from '../utils/work-item-console';

const sampleEntries: ConsoleLogEntry[] = [
  {
    id: 'log-1',
    timestamp: '2026-06-28T14:30:00.000Z',
    severity: 'info',
    message: '▶ implement — grok running...',
  },
  {
    id: 'log-2',
    timestamp: '2026-06-28T14:30:01.000Z',
    severity: 'warn',
    message: '◷ agent queued for shift',
  },
  {
    id: 'log-3',
    timestamp: '2026-06-28T14:30:02.000Z',
    severity: 'error',
    message: '[stderr] permission denied',
    stream: 'stderr',
  },
];

function installLocalStorageMock(): void {
  const store = new Map<string, string>();
  const mock = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: mock,
    configurable: true,
  });
}

function installScrollToPolyfill(): void {
  if (typeof HTMLElement.prototype.scrollTo === 'function') return;

  HTMLElement.prototype.scrollTo = function scrollTo(
    this: HTMLElement,
    options?: ScrollToOptions | number,
    y?: number
  ): void {
    if (typeof options === 'object' && options !== null) {
      if (options.top != null) this.scrollTop = options.top;
      if (options.left != null) this.scrollLeft = options.left;
    } else if (typeof options === 'number') {
      this.scrollTop = options;
      if (typeof y === 'number') this.scrollLeft = y;
    }
    this.dispatchEvent(new Event('scroll', { bubbles: true }));
  };
}

function installResizeObserverMock(defaultHeight = 320): void {
  class ResizeObserverMock {
    private readonly callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }

    observe(target: Element): void {
      const blockSize =
        (target as HTMLElement).offsetHeight ||
        Number((target as HTMLElement).getAttribute('data-test-height')) ||
        defaultHeight;
      const entry = {
        target,
        contentRect: { height: blockSize, width: 800 } as DOMRectReadOnly,
        borderBoxSize: [{ blockSize, inlineSize: 800 }],
        contentBoxSize: [{ blockSize, inlineSize: 800 }],
        devicePixelContentBoxSize: [{ blockSize, inlineSize: 800 }],
      } as ResizeObserverEntry;
      this.callback([entry], this);
    }

    disconnect(): void {}
    unobserve(): void {}
  }

  Object.defineProperty(globalThis, 'ResizeObserver', {
    value: ResizeObserverMock,
    configurable: true,
  });
}

function buildLargeEntrySet(count: number): ConsoleLogEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `log-${index}`,
    timestamp: '2026-06-28T14:30:00.000Z',
    severity: 'info' as const,
    message: `line ${index}`,
  }));
}

describe('StreamingConsole', () => {
  beforeEach(() => {
    installLocalStorageMock();
    installScrollToPolyfill();
    installResizeObserverMock();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders timestamps and severity badges per line', () => {
    render(<StreamingConsole id="test-console" entries={sampleEntries} />);
    const listbox = screen.getByRole('listbox', { name: 'Console log lines' });
    expect(listbox.querySelectorAll('.streaming-console-badge--info').length).toBeGreaterThanOrEqual(1);
    expect(listbox.querySelector('.streaming-console-badge--warn')?.textContent).toBe('WARN');
    expect(listbox.querySelector('.streaming-console-badge--error')?.textContent).toBe('ERR');
    expect(screen.getByText('▶ implement — grok running...')).toBeTruthy();
    expect(screen.getByText('[stderr] permission denied')).toBeTruthy();
    expect(listbox.querySelectorAll('time').length).toBe(3);
  });

  it('toggles autoscroll label on button click', () => {
    render(<StreamingConsole id="test-console" entries={sampleEntries} />);
    const toggle = screen.getByRole('button', { name: /toggle autoscroll/i });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText(/scroll off/i)).toBeTruthy();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('selects and deselects lines via gutter click', () => {
    render(<StreamingConsole id="test-console" entries={sampleEntries} />);
    const line = screen.getByText('▶ implement — grok running...').closest('[role="option"]');
    expect(line).toBeTruthy();
    expect(line?.getAttribute('aria-selected')).toBe('false');
    const gutter = line!.querySelector('.streaming-console-line-gutter');
    fireEvent.click(gutter!);
    expect(line?.getAttribute('aria-selected')).toBe('true');
    expect(line?.className).toContain('streaming-console-line--selected');
    fireEvent.click(gutter!);
    expect(line?.getAttribute('aria-selected')).toBe('false');
  });

  it('shows copy button when a line is selected', () => {
    render(<StreamingConsole id="test-console" entries={sampleEntries} />);
    const line = screen.getByText('[stderr] permission denied').closest('[role="option"]');
    fireEvent.click(line!.querySelector('.streaming-console-line-gutter')!);
    expect(screen.getByRole('button', { name: /copy selected line/i })).toBeTruthy();
  });

  it('selects lines via gutter keyboard', () => {
    render(<StreamingConsole id="test-console" entries={sampleEntries} />);
    const gutter = screen
      .getByText('▶ implement — grok running...')
      .closest('[role="option"]')!
      .querySelector('.streaming-console-line-gutter')!;
    fireEvent.keyDown(gutter, { key: 'Enter' });
    expect(gutter.closest('[role="option"]')?.getAttribute('aria-selected')).toBe('true');
  });

  it('marks log messages as selectable', () => {
    render(<StreamingConsole id="test-console" entries={sampleEntries} />);
    const msg = screen.getByText('▶ implement — grok running...');
    expect(msg.tagName).toBe('SPAN');
    expect(msg.className).toContain('streaming-console-msg');
  });

  it('persists autoscroll preference in localStorage', () => {
    const { unmount } = render(<StreamingConsole id="test-console" entries={sampleEntries} />);
    const toggle = screen.getByRole('button', { name: /toggle autoscroll/i });
    fireEvent.click(toggle);
    expect(localStorage.getItem('agenthub.console.autoscroll')).toBe('false');
    unmount();

    render(<StreamingConsole id="test-console-remount" entries={sampleEntries} />);
    const restored = screen.getByRole('button', { name: /toggle autoscroll/i });
    expect(restored.getAttribute('aria-pressed')).toBe('false');
  });

  it('marks partial streaming lines with data-partial', () => {
    const partialEntry: ConsoleLogEntry = {
      id: 'log-partial',
      timestamp: '2026-06-28T14:30:04.000Z',
      severity: 'info',
      message: 'streaming',
      stream: 'stdout',
      partial: true,
    };
    render(<StreamingConsole id="test-console" entries={[partialEntry]} />);
    const line = screen.getByText('streaming').closest('[role="option"]');
    expect(line?.getAttribute('data-partial')).toBe('true');
  });

  it('calls onReachTop when scrolled near the top', () => {
    const onReachTop = vi.fn();
    render(
      <StreamingConsole
        id="test-console-scroll"
        entries={sampleEntries}
        onReachTop={onReachTop}
        hasMore
      />
    );
    const log = document.getElementById('test-console-scroll')!;
    Object.defineProperty(log, 'scrollTop', { value: 0, writable: true, configurable: true });
    fireEvent.scroll(log);
    expect(onReachTop).toHaveBeenCalledTimes(1);
  });

  it('filters visible lines by severity and message text', () => {
    render(<StreamingConsole id="test-console-filter" entries={sampleEntries} />);

    fireEvent.click(screen.getByRole('button', { name: 'WARN' }));
    expect(screen.getByText('◷ agent queued for shift')).toBeTruthy();
    expect(screen.queryByText('▶ implement — grok running...')).toBeNull();
    expect(screen.queryByText('[stderr] permission denied')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    fireEvent.change(screen.getByLabelText('Filter console lines by message text'), {
      target: { value: 'stderr' },
    });
    expect(screen.getByText('[stderr] permission denied')).toBeTruthy();
    expect(screen.queryByText('▶ implement — grok running...')).toBeNull();
  });

  it('exports visible lines via export helper', () => {
    const exportSpy = vi.spyOn(logExport, 'exportConsoleEntriesFile').mockImplementation(() => {});

    render(<StreamingConsole id="test-console-export" entries={sampleEntries} />);
    fireEvent.click(screen.getByRole('button', { name: /export visible console lines as log/i }));

    expect(exportSpy).toHaveBeenCalledWith(sampleEntries, 'log');
    exportSpy.mockRestore();
  });

  it('shows loading indicator when fetching older lines', () => {
    render(
      <StreamingConsole
        id="test-console-loading"
        entries={sampleEntries}
        loadingMore
        hasMore
        onReachTop={() => {}}
      />
    );
    expect(screen.getByText('Loading older lines…')).toBeTruthy();
  });

  it('does not force-scroll after user scrolls away from bottom', () => {
    const scrollTo = vi.fn();
    const { rerender } = render(<StreamingConsole id="test-console" entries={sampleEntries} />);
    const log = document.getElementById('test-console')!;

    Object.defineProperty(log, 'scrollHeight', { value: 400, configurable: true });
    Object.defineProperty(log, 'clientHeight', { value: 200, configurable: true });
    Object.defineProperty(log, 'scrollTop', {
      get: () => 10,
      set: () => {},
      configurable: true,
    });
    log.scrollTo = scrollTo;

    fireEvent.scroll(log);
    scrollTo.mockClear();

    const newEntry: ConsoleLogEntry = {
      id: 'log-4',
      timestamp: '2026-06-28T14:30:03.000Z',
      severity: 'info',
      message: 'new streamed line',
    };
    rerender(<StreamingConsole id="test-console" entries={[...sampleEntries, newEntry]} />);

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('virtualizes large entry sets and only mounts a small DOM subset', async () => {
    const largeEntries = buildLargeEntrySet(50_000);
    render(<StreamingConsole id="test-console-large" entries={largeEntries} />);

    await waitFor(() => {
      expect(screen.queryByText('line 49999')).toBeTruthy();
    });

    const listbox = screen.getByRole('listbox', { name: 'Console log lines' });
    const renderedLines = listbox.querySelectorAll('[role="option"]');
    expect(renderedLines.length).toBeLessThan(100);
    expect(renderedLines.length).toBeGreaterThan(0);
    expect(screen.queryByText('line 0')).toBeNull();
  });

  it('does not throw when entries grow rapidly while autoscrolling', () => {
    const { rerender } = render(
      <StreamingConsole id="test-console-stream" entries={sampleEntries.slice(0, 1)} />
    );

    expect(() => {
      for (let i = 2; i <= 20; i++) {
        rerender(
          <StreamingConsole
            id="test-console-stream"
            entries={buildLargeEntrySet(i).map((e, idx) =>
              idx < sampleEntries.length
                ? { ...sampleEntries[idx]!, id: e.id, message: e.message }
                : e
            )}
          />
        );
      }
    }).not.toThrow();

    expect(screen.getByRole('listbox', { name: 'Console log lines' })).toBeTruthy();
  });

  it('tolerates scrollToRow RangeError without crashing the console', () => {
    render(<StreamingConsole id="test-console-range" entries={sampleEntries} />);
    const listbox = screen.getByRole('listbox', { name: 'Console log lines' });

    // Simulate react-window throwing when index is out of range of its internal itemCount.
    const originalScrollTo = listbox.scrollTo?.bind(listbox);
    listbox.scrollTo = vi.fn(() => {
      throw new RangeError('Invalid index specified: 3');
    }) as typeof listbox.scrollTo;

    expect(() => {
      fireEvent.scroll(listbox);
      // Trigger resize path which may re-autoscroll when pinned.
      window.dispatchEvent(new Event('resize'));
    }).not.toThrow();

    if (originalScrollTo) listbox.scrollTo = originalScrollTo;
    expect(screen.getByRole('listbox', { name: 'Console log lines' })).toBeTruthy();
  });
});