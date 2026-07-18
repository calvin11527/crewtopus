/** Human-readable automation pause reasons (board banner + sprint team panel). */
export const AUTOMATION_PAUSE_LABELS: Record<string, string> = {
  manual: 'Manual mode',
  outside_hours: 'Outside working hours',
  awaiting_shift: 'Awaiting developer shift',
  awaiting_ba: 'Awaiting business analyst',
  awaiting_pm: 'Awaiting project manager',
  budget_exceeded: 'Agent budget exceeded',
  blocked_failures: 'Blocked on failed/escalated work',
};

export const AUTOMATION_PAUSE_HINTS: Record<string, string> = {
  manual:
    'Turn on Autonomous, or click Run sprint queue / Full lifecycle / Grok→Copilot on a story in To Do or Backlog.',
  outside_hours: 'No staffed agents are within their working hours right now.',
  awaiting_shift: 'Developer is not on shift yet. Work resumes when their hours start.',
  awaiting_ba: 'Business analyst is off shift. New stories wait for requirements analysis.',
  awaiting_pm: 'Project manager is off shift. Stories with a BA plan wait for task decomposition.',
  budget_exceeded: 'An agent type exceeded its token budget. Adjust quotas or wait for reset.',
  blocked_failures:
    'Stories failed or need review, but the reviewer/developer is off shift. Assign staffed agents or wait for their hours.',
};

export function automationPauseLabel(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return AUTOMATION_PAUSE_LABELS[reason] ?? reason.replace(/_/g, ' ');
}

export function automationPauseHint(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return AUTOMATION_PAUSE_HINTS[reason] ?? null;
}
