import { useState } from 'react';
import { Radio, Maximize2, X } from 'lucide-react';
import { useAppStore } from '../stores/useAppStore';
import type { LiveEvent } from '../types';
import Modal from './Modal';

interface LiveFeedProps {
  compact?: boolean;
  /** True when agents/jobs are in progress for the current sprint. */
  isWorking?: boolean;
  /** Short status under the header (e.g. "BA phase · AH-12"). */
  workingLabel?: string | null;
}

function previewMessage(message: string, max = 96): string {
  const oneLine = message.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max)}…`;
}

export default function LiveFeed({
  compact = false,
  isWorking = false,
  workingLabel = null,
}: LiveFeedProps) {
  const events = useAppStore((s) => s.liveEvents);
  const connectionStatus = useAppStore((s) => s.connectionStatus);
  const [selected, setSelected] = useState<LiveEvent | null>(null);
  const limit = compact ? 8 : 12;

  const showLive =
    isWorking ||
    (connectionStatus === 'connected' &&
      events.some((e) => Date.now() - new Date(e.timestamp).getTime() < 15_000));

  return (
    <div
      id="live-feed"
      className={`card live-feed${compact ? ' live-feed--compact' : ''}${
        isWorking ? ' live-feed--working' : ''
      }`}
    >
      <div className="live-feed-header">
        <Radio size={16} className={`live-feed-icon${showLive ? ' live-feed-icon--live' : ''}`} />
        <h3>Live Activity</h3>
        {showLive && (
          <span className="live-feed-live-badge" title="Receiving or running agent activity">
            LIVE
          </span>
        )}
      </div>

      {isWorking && (
        <p className="live-feed-working-line" role="status">
          <span className="live-feed-working-dot" aria-hidden />
          {workingLabel?.trim() || 'Agents are working on this sprint…'}
        </p>
      )}

      <div className="live-feed-list">
        {events.length === 0 ? (
          <p className="live-feed-empty">
            {isWorking
              ? 'Job started — waiting for the first agent events…'
              : 'Waiting for events…'}
          </p>
        ) : (
          events.slice(0, limit).map((e) => {
            const full = e.message;
            const short = previewMessage(full);
            const truncated = short !== full.replace(/\s+/g, ' ').trim() || full.length > 96;
            return (
              <button
                key={e.id}
                type="button"
                id={`event-${e.id}`}
                className="live-feed-item live-feed-item--clickable"
                onClick={() => setSelected(e)}
                title={truncated ? 'Click to view full message' : full}
              >
                <span className="live-feed-time">
                  {new Date(e.timestamp).toLocaleTimeString()}
                </span>
                <span className="live-feed-type">{e.type.replace(/:/g, ' ')}</span>
                <span className="live-feed-msg">
                  <span className="live-feed-msg-text">{short}</span>
                  {truncated && (
                    <span className="live-feed-msg-open" aria-hidden>
                      <Maximize2 size={11} />
                    </span>
                  )}
                </span>
              </button>
            );
          })
        )}
      </div>

      <Modal
        id="modal-live-event"
        title="Live activity detail"
        open={!!selected}
        onClose={() => setSelected(null)}
      >
        {selected && (
          <div className="live-feed-detail">
            <div className="live-feed-detail-meta">
              <span className="live-feed-type">{selected.type.replace(/:/g, ' ')}</span>
              <time dateTime={selected.timestamp}>
                {new Date(selected.timestamp).toLocaleString()}
              </time>
            </div>
            <pre className="live-feed-detail-body">{selected.message}</pre>
            <div className="modal-actions">
              <button type="button" className="btn btn--ghost" onClick={() => setSelected(null)}>
                <X size={14} /> Close
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  void navigator.clipboard?.writeText(selected.message);
                }}
              >
                Copy message
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
