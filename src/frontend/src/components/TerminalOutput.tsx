import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface TerminalOutputProps {
  id: string;
  lines: string[];
  className?: string;
  /** When true, skip the default banner (caller seeds lines). */
  skipBanner?: boolean;
}

function safeFit(fit: FitAddon, container: HTMLElement | null): void {
  if (!container || container.clientWidth < 2 || container.clientHeight < 2) return;
  try {
    fit.fit();
  } catch {
    /* xterm FitAddon throws if the container has no dimensions yet */
  }
}

export default function TerminalOutput({ id, lines, className, skipBanner }: TerminalOutputProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const prevLen = useRef(0);

  useEffect(() => {
    if (!containerRef.current || termRef.current) return;

    const container = containerRef.current;
    const term = new Terminal({
      theme: {
        background: '#0d0d1f',
        foreground: '#c8c8e0',
        cursor: '#4f8fff',
        selectionBackground: 'rgba(79, 143, 255, 0.3)',
      },
      fontSize: 13,
      fontFamily: 'JetBrains Mono, monospace',
      cursorBlink: true,
      scrollback: 500,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);

    if (!skipBanner) {
      term.writeln('\x1b[36mAgentHub Terminal\x1b[0m — awaiting workflow output...\r\n');
    }

    termRef.current = term;
    fitRef.current = fit;

    let disposed = false;
    const fitTerminal = () => {
      if (disposed) return;
      const core = (term as unknown as { _core?: { _renderService?: unknown } })._core;
      if (!core?._renderService) {
        requestAnimationFrame(fitTerminal);
        return;
      }
      safeFit(fit, container);
    };

    requestAnimationFrame(fitTerminal);

    const ro = new ResizeObserver(() => fitTerminal());
    ro.observe(container);

    return () => {
      disposed = true;
      ro.disconnect();
      const activeTerm = termRef.current;
      const activeFit = fitRef.current;
      termRef.current = null;
      fitRef.current = null;
      try {
        activeFit?.dispose();
        activeTerm?.dispose();
      } catch {
        /* xterm viewport can race during fast route changes */
      }
    };
  }, [skipBanner]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    if (lines.length < prevLen.current) {
      term.clear();
      prevLen.current = 0;
    }

    const newLines = lines.slice(prevLen.current);
    for (const line of newLines) {
      term.writeln(line);
    }
    prevLen.current = lines.length;
  }, [lines]);

  return <div id={id} ref={containerRef} className={className ?? 'terminal-container'} />;
}