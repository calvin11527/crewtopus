import { Bot, GripHorizontal, Radio, Terminal, Trash2, Wifi, WifiOff } from 'lucide-react';
import { useDragResize } from '../hooks/useDragResize';
import { useAppStore } from '../stores/useAppStore';
import type { LoopStatus } from '../types';
import type { AgentConsoleStatus } from '../utils/work-item-console';
import StreamingConsole from './StreamingConsole';
import type { ConsoleLogEntry } from '../utils/work-item-console';

const LOOP_STATUS_LABEL: Record<LoopStatus, string> = {
  idle: 'Idle',
  running: 'Running',
  approved: 'Approved',
  escalated: 'Escalated',
  failed: 'Failed',
  cancelled: 'Cancelled',
  awaiting_shift: 'Awaiting shift',
};

interface AgentConsoleProps {
  workItemKey: string;
  entries: ConsoleLogEntry[];
  status: AgentConsoleStatus;
  sessionKey: number;
  height: number;
  onResizeHeight: (height: number) => void;
  onCommitHeight?: (height: number) => void;
  idleHint?: string | null;
  onClear: () => void;
}

export default function AgentConsole({
  workItemKey,
  entries,
  status,
  sessionKey,
  height,
  onResizeHeight,
  onCommitHeight,
  idleHint,
  onClear,
}: AgentConsoleProps) {
  const connectionStatus = useAppStore((s) => s.connectionStatus);
  const showPulse =
    connectionStatus === 'connected' && (status.isLive || status.loopStatus === 'running');

  const consoleResize = useDragResize({
    axis: 'vertical',
    min: 120,
    max: 520,
    onResize: onResizeHeight,
    onCommit: onCommitHeight,
  });

  return (
    <div id="agent-console" className="agent-console" style={{ height }}>
      <div className="agent-console-header">
        <div className="agent-console-title">
          <Terminal size={16} />
          <h4>Agent console</h4>
          <span
            className={`agent-console-ws agent-console-ws--${connectionStatus}`}
            title={
              connectionStatus === 'connected'
                ? 'WebSocket connected'
                : connectionStatus === 'connecting'
                  ? 'WebSocket reconnecting'
                  : 'WebSocket disconnected'
            }
          >
            {connectionStatus === 'connected' ? <Wifi size={12} /> : <WifiOff size={12} />}
            {connectionStatus === 'connected'
              ? 'Connected'
              : connectionStatus === 'connecting'
                ? 'Connecting…'
                : 'Offline'}
          </span>
          {showPulse && (
            <span className="agent-console-live" title="Receiving live events">
              <Radio size={12} /> LIVE
            </span>
          )}
        </div>
        <div className="agent-console-meta">
          {status.phase && (
            <span className="agent-console-chip agent-console-chip--phase">{status.phase}</span>
          )}
          {status.agentType && (
            <span className="agent-console-chip">
              <Bot size={12} /> {status.agentType}
            </span>
          )}
          {(status.loopIteration != null && status.loopIteration > 0) || status.loopStatus ? (
            <span className="agent-console-chip agent-console-chip--loop">
              {status.loopIteration != null && status.loopIteration > 0
                ? `iter ${status.loopIteration}${status.maxLoopIterations ? `/${status.maxLoopIterations}` : ''}`
                : null}
              {status.loopStatus ? ` · ${LOOP_STATUS_LABEL[status.loopStatus]}` : null}
            </span>
          ) : null}
          <button
            type="button"
            className="btn btn--ghost btn--sm agent-console-clear"
            onClick={onClear}
            title="Clear console"
          >
            <Trash2 size={12} /> Clear
          </button>
        </div>
      </div>
      {idleHint && <p className="agent-console-idle">{idleHint}</p>}
      <div className="agent-console-log">
        <StreamingConsole
          key={`${workItemKey}-${sessionKey}`}
          id="work-item-agent-terminal"
          entries={entries}
          className="streaming-console--board"
        />
      </div>
      <div
        className="agent-console-resize-handle"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize agent console"
        onPointerDown={(e) => consoleResize.startDrag(e, height)}
        onPointerMove={consoleResize.onDrag}
        onPointerUp={consoleResize.endDrag}
        onPointerCancel={consoleResize.endDrag}
      >
        <GripHorizontal size={14} />
      </div>
    </div>
  );
}