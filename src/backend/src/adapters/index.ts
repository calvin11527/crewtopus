import type { AgentType } from '../types';
import type { AgentAdapter } from './base';
import { MockAdapter } from './mock';
import { ClaudeAdapter } from './claude';
import { GrokAdapter } from './grok';
import { CopilotAdapter } from './copilot';
import { AntigravityAdapter } from './antigravity';
import { OllamaAdapter } from './ollama';

const adapters: Record<AgentType, AgentAdapter> = {
  mock: new MockAdapter(),
  claude: new ClaudeAdapter(),
  grok: new GrokAdapter(),
  copilot: new CopilotAdapter(),
  antigravity: new AntigravityAdapter(),
  ollama: new OllamaAdapter(),
};

/** Get the adapter for a given agent type. */
export function getAdapter(type: AgentType): AgentAdapter {
  const adapter = adapters[type];
  if (!adapter) throw new Error(`No adapter registered for type "${type}"`);
  return adapter;
}

/** Check availability of all adapters. */
export async function getAdapterAvailability(): Promise<Record<AgentType, boolean>> {
  const result = {} as Record<AgentType, boolean>;
  for (const [type, adapter] of Object.entries(adapters) as Array<[AgentType, AgentAdapter]>) {
    result[type] = await adapter.isAvailable();
  }
  return result;
}

/** Shutdown all adapters. */
export function shutdownAllAdapters(): void {
  for (const adapter of Object.values(adapters)) {
    adapter.shutdown();
  }
}

export type { AgentAdapter, AdapterInput, AdapterOutput } from './base';