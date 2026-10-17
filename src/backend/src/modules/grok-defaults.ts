/**
 * Grok CLI defaults for crew runs.
 * Model id matches `grok models` on the installed CLI (grok 1.0.60): grok-4.7.
 * grok-4.7-build-fast is faster and costs twice as much, so it is not the default.
 * Effort `medium` is the crew default. `low`, `high`, and `xhigh` stay available per agent.
 * `max` is not a CLI level.
 */

export const DEFAULT_GROK_MODEL = 'grok-4.7';

export const DEFAULT_GROK_EFFORT = 'medium' as const;

/** Old product default and the previous CLI default. Rewritten once by schema v13. */
export const LEGACY_GROK_MODELS = ['grok-4.5', 'grok-4.6'] as const;

/** Inner tool-turn cap for one Grok process. `0` omits `--max-turns`. */
export const DEFAULT_GROK_MAX_TURNS = 30;

function trimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Fill model and effort when a new Grok agent is registered without them. */
export function applyGrokRunDefaults(
  type: string,
  config: Record<string, unknown>
): Record<string, unknown> {
  if (type !== 'grok') return config;
  const next = { ...config };
  const model = trimmedString(next.model);
  if (!model) next.model = DEFAULT_GROK_MODEL;
  else next.model = model;
  const effort = trimmedString(next.effort);
  if (!effort) next.effort = DEFAULT_GROK_EFFORT;
  else next.effort = effort;
  return next;
}

/**
 * One-time config upgrade. Moves legacy default models to grok-4.7 and fills a
 * missing effort. Explicit models (including grok-4.7-build-fast) and explicit
 * effort levels are left alone.
 */
export function upgradeStoredGrokConfig(config: Record<string, unknown>): {
  config: Record<string, unknown>;
  changed: boolean;
} {
  const next = { ...config };
  let changed = false;
  const model = trimmedString(next.model);
  const legacy =
    !model || (LEGACY_GROK_MODELS as readonly string[]).includes(model);
  if (legacy && next.model !== DEFAULT_GROK_MODEL) {
    next.model = DEFAULT_GROK_MODEL;
    changed = true;
  }
  const effort = trimmedString(next.effort);
  if (!effort && next.effort !== DEFAULT_GROK_EFFORT) {
    next.effort = DEFAULT_GROK_EFFORT;
    changed = true;
  }
  return { config: next, changed };
}
