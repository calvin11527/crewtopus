import { Fragment, useState } from 'react';
import { ScrollText } from 'lucide-react';
import { useAuditLog, useAuditStats } from '../api/hooks';
import StatusBadge from '../components/StatusBadge';

function auditContent(entry: { responseMetadata?: Record<string, unknown> }): string | undefined {
  const content = entry.responseMetadata?.content;
  return typeof content === 'string' && content.trim() ? content : undefined;
}

export default function Audit() {
  const { data: entries, isLoading } = useAuditLog();
  const { data: stats } = useAuditStats();
  const [expandedId, setExpandedId] = useState<string | null>(
    typeof window !== 'undefined' && window.location.hash ? window.location.hash.slice(1) : null
  );

  return (
    <div id="page-audit" className="page page--wide">
      <header className="page-header">
        <h2>Audit Log</h2>
        <p className="page-subtitle">Immutable trace of all agent operations — click a row to see agent output</p>
      </header>

      <div className="stats-grid" style={{ marginBottom: 24 }}>
        <div id="audit-stat-entries" className="stat-card">
          <ScrollText size={22} className="stat-icon stat-icon--blue" />
          <div>
            <span className="stat-label">Total Entries</span>
            <span className="stat-value">{stats?.totalEntries ?? 0}</span>
          </div>
        </div>
        <div id="audit-stat-tokens" className="stat-card">
          <ScrollText size={22} className="stat-icon stat-icon--purple" />
          <div>
            <span className="stat-label">Total Tokens</span>
            <span className="stat-value">{stats?.totalTokens?.toLocaleString() ?? 0}</span>
          </div>
        </div>
        <div id="audit-stat-cost" className="stat-card">
          <ScrollText size={22} className="stat-icon stat-icon--green" />
          <div>
            <span className="stat-label">Total Cost</span>
            <span className="stat-value">${(stats?.totalCost ?? 0).toFixed(4)}</span>
          </div>
        </div>
        <div id="audit-stat-blocked" className="stat-card">
          <ScrollText size={22} className="stat-icon stat-icon--amber" />
          <div>
            <span className="stat-label">Blocked</span>
            <span className="stat-value">{stats?.blockedCount ?? 0}</span>
          </div>
        </div>
      </div>

      {isLoading ? (
        <p className="loading-text">Loading audit log...</p>
      ) : entries?.length === 0 ? (
        <div className="card empty-state">
          <p>No audit entries yet. Operations will be logged here automatically.</p>
        </div>
      ) : (
        <div id="audit-table" className="card table-card">
          <table className="data-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Task</th>
                <th>Agent</th>
                <th>Tokens</th>
                <th>Cost</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {entries?.map((entry) => {
                const content = auditContent(entry);
                const isOpen = expandedId === entry.id;
                const agent =
                  (entry.responseMetadata?.adapter as string) ||
                  (entry.responseMetadata?.requestedAgent as string) ||
                  '—';
                return (
                  <Fragment key={entry.id}>
                    <tr
                      id={`audit-row-${entry.id}`}
                      className={content ? 'audit-row--clickable' : undefined}
                      onClick={() => content && setExpandedId(isOpen ? null : entry.id)}
                    >
                      <td className="mono">{new Date(entry.timestamp).toLocaleString()}</td>
                      <td>{entry.task || '—'}</td>
                      <td>{agent}</td>
                      <td className="mono">{entry.tokenCount}</td>
                      <td className="mono">${entry.cost.toFixed(4)}</td>
                      <td>
                        {entry.approvalStatus ? (
                          <StatusBadge status={entry.approvalStatus} />
                        ) : (
                          <span className="badge badge--green">logged</span>
                        )}
                      </td>
                    </tr>
                    {isOpen && content && (
                      <tr key={`${entry.id}-detail`} className="audit-detail-row">
                        <td colSpan={6}>
                          <pre className="agent-output-content">{content}</pre>
                          {typeof entry.responseMetadata?.workItemId === 'string' && (
                            <p className="agent-output-hint">
                              Work item: {entry.responseMetadata.workItemId}
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}