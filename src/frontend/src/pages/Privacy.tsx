import { Shield, Check, X } from 'lucide-react';
import { usePolicies, useApprovals, useApproveRequest, useRejectRequest } from '../api/hooks';
import StatusBadge from '../components/StatusBadge';

export default function Privacy() {
  const { data: policies, isLoading: policiesLoading } = usePolicies();
  const { data: approvals, isLoading: approvalsLoading } = useApprovals();
  const approve = useApproveRequest();
  const reject = useRejectRequest();

  const pending = approvals?.filter((a) => a.status === 'pending') ?? [];

  return (
    <div id="page-privacy" className="page page--wide">
      <header className="page-header">
        <h2>Privacy &amp; Security</h2>
        <p className="page-subtitle">Privacy policies, approval gates, and secret protection</p>
      </header>

      <div className="privacy-grid">
        <div id="privacy-policies" className="card">
          <h3><Shield size={18} /> Privacy Policies</h3>
          {policiesLoading ? (
            <p className="loading-text">Loading...</p>
          ) : policies?.length === 0 ? (
            <p className="text-muted">No custom policies. Default policy is active.</p>
          ) : (
            <div className="policy-list">
              {policies?.map((p) => (
                <div key={p.id} id={`policy-${p.id}`} className="policy-item">
                  <strong>{p.name}</strong>
                  <ul>
                    {p.rules.map((r, i) => (
                      <li key={i}>{r.description || `${r.type}: ${r.value}`}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>

        <div id="approval-gate" className="card">
          <h3>Approval Gate</h3>
          <p className="text-muted" style={{ marginBottom: 16 }}>
            High-sensitivity requests (level ≥ 2) require human approval before outbound execution.
          </p>
          {approvalsLoading ? (
            <p className="loading-text">Loading...</p>
          ) : pending.length === 0 ? (
            <p className="text-muted">No pending approval requests.</p>
          ) : (
            <div className="approval-list">
              {pending.map((req) => (
                <div key={req.id} id={`approval-${req.id}`} className="approval-item">
                  <div className="approval-header">
                    <StatusBadge status={req.status} id={`approval-status-${req.id}`} />
                    <span className="text-muted">Sensitivity: {req.sensitivityLevel}</span>
                  </div>
                  <p className="approval-meta">
                    {req.contextScope.files.length} files, {req.contextScope.maxTokens} max tokens
                  </p>
                  <div className="approval-actions">
                    <button
                      id={`btn-approve-${req.id}`}
                      type="button"
                      className="btn btn--primary btn--sm"
                      onClick={() => approve.mutate(req.id)}
                    >
                      <Check size={14} /> Approve
                    </button>
                    <button
                      id={`btn-reject-${req.id}`}
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => reject.mutate(req.id)}
                    >
                      <X size={14} /> Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div id="privacy-pipeline" className="card">
          <h3>Outbound Pipeline</h3>
          <div className="pipeline-flow">
            <span className="pipeline-step">Task</span>
            <span className="pipeline-arrow">→</span>
            <span className="pipeline-step">ContextScope</span>
            <span className="pipeline-arrow">→</span>
            <span className="pipeline-step">Privacy Guard</span>
            <span className="pipeline-arrow">→</span>
            <span className="pipeline-step">Approval Gate</span>
            <span className="pipeline-arrow">→</span>
            <span className="pipeline-step">Agent</span>
            <span className="pipeline-arrow">→</span>
            <span className="pipeline-step">Audit Logger</span>
          </div>
        </div>
      </div>
    </div>
  );
}