/** First non-empty env value among keys (Crewtopus names, then AgentHub aliases). */
export function envString(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

export function envNumber(fallback: number, ...keys: string[]): number {
  const raw = envString(...keys);
  if (raw == null) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function envFlag(trueIf: 'true' | 'false', ...keys: string[]): boolean {
  const raw = envString(...keys);
  return raw === trueIf;
}

/** Work-dir env only (no mkdir). Prefer CREWTOPUS_WORK_DIR, then AGENTHUB_WORK_DIR, then GROK_CWD. */
export function envWorkDir(): string | undefined {
  return envString('CREWTOPUS_WORK_DIR', 'AGENTHUB_WORK_DIR', 'GROK_CWD');
}
