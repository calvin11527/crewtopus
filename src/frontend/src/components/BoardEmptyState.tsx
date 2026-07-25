import { Columns3, Play, Users, Sparkles } from 'lucide-react';

interface BoardEmptyStateProps {
  hasSprint: boolean;
  onMultiAgentDemo?: () => void;
  onStaffTeam?: () => void;
  demoPending?: boolean;
}

/** First-run / empty board CTA — activation over features. */
export default function BoardEmptyState({
  hasSprint,
  onMultiAgentDemo,
  onStaffTeam,
  demoPending,
}: BoardEmptyStateProps) {
  return (
    <div className="board-empty-state card" id="board-empty-state">
      <Columns3 size={28} className="board-empty-state__icon" />
      <h3>Your sprint crew starts here</h3>
      <p className="text-muted">
        {hasSprint
          ? 'No cards in this view yet. Run a mock multi-agent demo (no paid CLIs) or staff a team and add a story.'
          : 'Create or select a sprint, then run the mock demo to see implement → test → review finish as approved.'}
      </p>
      <ol className="board-empty-steps">
        <li>
          <Sparkles size={14} /> Click <strong>Multi-agent demo</strong> (mock pipeline)
        </li>
        <li>
          <Users size={14} /> <strong>Staff team</strong> when you are ready for real adapters
        </li>
        <li>
          <Play size={14} /> Add a story → <strong>Full lifecycle</strong>
        </li>
      </ol>
      <div className="board-empty-actions">
        {onMultiAgentDemo && (
          <button
            type="button"
            className="btn btn--primary"
            disabled={!hasSprint || demoPending}
            onClick={onMultiAgentDemo}
          >
            <Play size={16} /> {demoPending ? 'Running demo…' : 'Run multi-agent demo'}
          </button>
        )}
        {onStaffTeam && (
          <button type="button" className="btn btn--ghost" disabled={!hasSprint} onClick={onStaffTeam}>
            <Users size={16} /> Staff team
          </button>
        )}
      </div>
    </div>
  );
}
