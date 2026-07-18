import { useEffect, useRef } from 'react';
import { stripAnsi } from '../utils/work-item-console';

interface ScrollTerminalProps {
  id: string;
  lines: string[];
  className?: string;
}

/** Lightweight auto-scrolling log — avoids xterm layout races in drawers. */
export default function ScrollTerminal({ id, lines, className }: ScrollTerminalProps) {
  const containerRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <pre id={id} ref={containerRef} className={className ?? 'scroll-terminal'}>
      {lines.map((line, i) => (
        <span key={`${i}-${line.slice(0, 24)}`} className="scroll-terminal-line">
          {stripAnsi(line)}
          {'\n'}
        </span>
      ))}
    </pre>
  );
}