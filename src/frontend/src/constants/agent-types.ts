import type { AgentType } from '../types';
import { BUILTIN_AGENT_TYPES } from '../types';

export const AGENT_TYPES: AgentType[] = [...BUILTIN_AGENT_TYPES];

export const AGENT_TYPE_LABELS: Record<string, string> = {
  grok: 'Grok',
  copilot: 'Copilot',
  claude: 'Claude',
  ollama: 'Ollama',
  antigravity: 'Antigravity',
  mock: 'Mock',
};

export const AGENT_TYPE_COLORS: Record<string, string> = {
  claude: '#d97706',
  grok: '#ef4444',
  copilot: '#4f8fff',
  antigravity: '#a855f7',
  ollama: '#22c55e',
  mock: '#6868a0',
};

export function formatAgentType(type: AgentType | string): string {
  return AGENT_TYPE_LABELS[type] ?? type;
}
