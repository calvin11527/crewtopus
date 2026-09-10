import type { AgentType } from '../types';
import { isAgentTypeSlug } from '../types';
import type { AgentAdapter } from './base';
import { MockAdapter } from './mock';
import { ClaudeAdapter } from './claude';
import { GrokAdapter } from './grok';
import { CopilotAdapter } from './copilot';
import { AntigravityAdapter } from './antigravity';
import { OllamaAdapter } from './ollama';

const adapters = new Map<string, AgentAdapter>();

function assertTypeSlug(type: string): void {
  if (!isAgentTypeSlug(type)) {
    throw new Error(`Invalid adapter type "${type}" (use a lowercase slug like "grok" or "my-cli")`);
  }
}

/** Register an adapter implementation. Built-ins load at import; plugins call this at startup. */
export function registerAdapter(adapter: AgentAdapter, options: { replace?: boolean } = {}): void {
  assertTypeSlug(adapter.type);
  if (adapters.has(adapter.type) && !options.replace) {
    throw new Error(`Adapter "${adapter.type}" is already registered`);
  }
  adapters.set(adapter.type, adapter);
}

export function unregisterAdapter(type: string): boolean {
  return adapters.delete(type);
}

export function hasAdapter(type: string): boolean {
  return adapters.has(type);
}

export function listAdapterTypes(): AgentType[] {
  return [...adapters.keys()];
}

/** Get the adapter for a given agent type. */
export function getAdapter(type: AgentType): AgentAdapter {
  const adapter = adapters.get(type);
  if (!adapter) throw new Error(`No adapter registered for type "${type}"`);
  return adapter;
}

/** Check availability of all adapters. */
export async function getAdapterAvailability(): Promise<Record<string, boolean>> {
  const result: Record<string, boolean> = {};
  for (const [type, adapter] of adapters) {
    result[type] = await adapter.isAvailable();
  }
  return result;
}

/** Shutdown all adapters. */
export function shutdownAllAdapters(): void {
  for (const adapter of adapters.values()) {
    adapter.shutdown();
  }
}

registerAdapter(new MockAdapter(), { replace: true });
registerAdapter(new ClaudeAdapter(), { replace: true });
registerAdapter(new GrokAdapter(), { replace: true });
registerAdapter(new CopilotAdapter(), { replace: true });
registerAdapter(new AntigravityAdapter(), { replace: true });
registerAdapter(new OllamaAdapter(), { replace: true });

export type { AgentAdapter, AdapterInput, AdapterOutput } from './base';
