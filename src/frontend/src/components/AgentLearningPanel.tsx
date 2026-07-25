import { Lightbulb, Sparkles, Check, X, RefreshCw } from 'lucide-react';
import {
  useCapabilityFacts,
  useImprovementSuggestions,
  useProbeCapabilities,
  useApplySuggestion,
  useDismissSuggestion,
} from '../api/hooks';
import type { ImprovementSuggestion } from '../types';

function SeverityTag({ severity }: { severity: ImprovementSuggestion['severity'] }) {
  const cls =
    severity === 'critical' ? 'tag tag--danger' : severity === 'warn' ? 'tag tag--warn' : 'tag';
  return <span className={cls}>{severity}</span>;
}

export default function AgentLearningPanel() {
  const { data: facts, isLoading: factsLoading } = useCapabilityFacts();
  const { data: suggestions, isLoading: sugLoading } = useImprovementSuggestions('open');
  const probe = useProbeCapabilities();
  const apply = useApplySuggestion();
  const dismiss = useDismissSuggestion();

  const factPreview = (facts ?? []).slice(0, 12);
  const openSuggestions = suggestions ?? [];

  return (
    <div id="agent-learning-panel" className="card agent-learning-panel">
      <div className="agent-learning-header">
        <h3>
          <Sparkles size={18} /> Self-improving agents
        </h3>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={probe.isPending}
          onClick={() => probe.mutate(undefined)}
          title="Probe CLI --help and refresh usage-based suggestions"
        >
          <RefreshCw size={14} className={probe.isPending ? 'spin' : undefined} />{' '}
          {probe.isPending ? 'Learning…' : 'Learn now'}
        </button>
      </div>
      <p className="text-muted agent-learning-intro">
        Crewtopus observes adapter runs, CLI help, and usage signals — then suggests improvements
        (adapter failover, model fixes, auth). Apply is always opt-in.
      </p>

      <div className="agent-learning-grid">
        <section>
          <h4>
            <Lightbulb size={15} /> Open suggestions ({openSuggestions.length})
          </h4>
          {sugLoading ? (
            <p className="loading-text">Loading…</p>
          ) : openSuggestions.length === 0 ? (
            <p className="text-muted">No open suggestions. Run agents or click Learn now.</p>
          ) : (
            <ul className="agent-learning-suggestions">
              {openSuggestions.map((s) => (
                <li key={s.id} className="agent-learning-suggestion">
                  <div className="agent-learning-suggestion-top">
                    <strong>{s.title}</strong>
                    <SeverityTag severity={s.severity} />
                  </div>
                  <p>{s.body}</p>
                  <div className="agent-learning-suggestion-actions">
                    <button
                      type="button"
                      className="btn btn--sm btn--primary"
                      disabled={apply.isPending}
                      onClick={() => apply.mutate(s.id)}
                    >
                      <Check size={14} /> Apply
                    </button>
                    <button
                      type="button"
                      className="btn btn--sm btn--ghost"
                      disabled={dismiss.isPending}
                      onClick={() => dismiss.mutate(s.id)}
                    >
                      <X size={14} /> Dismiss
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h4>Learned facts ({facts?.length ?? 0})</h4>
          {factsLoading ? (
            <p className="loading-text">Loading…</p>
          ) : factPreview.length === 0 ? (
            <p className="text-muted">No facts yet.</p>
          ) : (
            <ul className="agent-learning-facts">
              {factPreview.map((f) => (
                <li key={f.id}>
                  <code>
                    {f.agentType}.{f.factKey}
                  </code>
                  <span className="text-muted"> · {f.source}</span>
                </li>
              ))}
            </ul>
          )}
          {(facts?.length ?? 0) > factPreview.length && (
            <p className="text-muted">+{(facts?.length ?? 0) - factPreview.length} more</p>
          )}
        </section>
      </div>
    </div>
  );
}
