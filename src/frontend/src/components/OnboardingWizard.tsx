import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, X, ArrowRight, CheckCircle2 } from 'lucide-react';

const STORAGE_KEY = 'crewtopus.onboarding.v1';

const STEPS = [
  {
    title: 'Welcome to Crewtopus',
    body: 'One agent is a tool. A crew is a process — board, roles, lifecycle, audit.',
  },
  {
    title: '60-second mock demo',
    body: 'No API keys needed. Open the board and click Multi-agent demo, or run npm run demo / ./demo.sh.',
  },
  {
    title: 'Staff real adapters',
    body: 'Agents page: Grok, Copilot, Claude, Ollama. Over quota? Switch adapter or enable auto-failover.',
  },
  {
    title: 'Keep SuperGrok honest',
    body: 'Grok SuperGrok is weekly (Build + Conversation). Use the bookmarklet or paste panel text under Credit Usage.',
  },
];

export default function OnboardingWizard() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setOpen(true);
    } catch {
      /* ignore */
    }
  }, []);

  const dismiss = (permanent: boolean) => {
    setOpen(false);
    if (permanent) {
      try {
        localStorage.setItem(STORAGE_KEY, new Date().toISOString());
      } catch {
        /* ignore */
      }
    }
  };

  if (!open) return null;

  const current = STEPS[step];
  const last = step >= STEPS.length - 1;

  return (
    <div className="onboarding-overlay" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <div className="onboarding-card card">
        <button
          type="button"
          className="onboarding-close btn btn--ghost btn--sm"
          onClick={() => dismiss(true)}
          aria-label="Close onboarding"
        >
          <X size={16} />
        </button>
        <div className="onboarding-icon">
          <Sparkles size={22} />
        </div>
        <p className="onboarding-step-meta text-muted">
          Step {step + 1} of {STEPS.length}
        </p>
        <h2 id="onboarding-title">{current.title}</h2>
        <p className="onboarding-body">{current.body}</p>
        <div className="onboarding-actions">
          {step > 0 && (
            <button type="button" className="btn btn--ghost" onClick={() => setStep((s) => s - 1)}>
              Back
            </button>
          )}
          {!last ? (
            <button type="button" className="btn btn--primary" onClick={() => setStep((s) => s + 1)}>
              Next <ArrowRight size={16} />
            </button>
          ) : (
            <>
              <Link to="/board" className="btn btn--primary" onClick={() => dismiss(true)}>
                <CheckCircle2 size={16} /> Go to board
              </Link>
              <button type="button" className="btn btn--ghost" onClick={() => dismiss(true)}>
                Done
              </button>
            </>
          )}
        </div>
        <button type="button" className="onboarding-skip text-muted" onClick={() => dismiss(true)}>
          Skip tour
        </button>
      </div>
    </div>
  );
}
