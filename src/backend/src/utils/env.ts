/** First non-empty env value among keys (Crewtopus names, then AgentHub aliases). */
export function envString(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}
