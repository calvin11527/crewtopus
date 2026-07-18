import { create } from 'zustand';
import type { AgentStatus, LiveEvent, WSMessage } from '../types';

export type ConnectionStatus = 'connected' | 'connecting' | 'failed';

interface AppState {
  liveEvents: LiveEvent[];
  agentStatuses: Record<string, AgentStatus>;
  terminalOutput: string[];
  selectedCode: string;
  connectionStatus: ConnectionStatus;
  pendingJobsByWorkItem: Record<string, string>;
  addLiveEvent: (msg: WSMessage) => void;
  setAgentStatus: (agentId: string, status: AgentStatus) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setPendingJob: (workItemId: string, jobId: string) => void;
  clearPendingJob: (workItemId: string) => void;
  appendTerminal: (line: string) => void;
  clearTerminal: () => void;
  setSelectedCode: (code: string) => void;
}

function formatEvent(msg: WSMessage): string {
  const p = msg.payload;
  switch (msg.type) {
    case 'agent:status':
      return `Agent ${p.name || p.agentId}: ${p.status}`;
    case 'workflow:update':
      return `Workflow ${p.status}: ${p.message || p.taskId || ''}`;
    case 'workflow:step':
      return `Step ${p.step} (${p.stepName}): ${p.status}`;
    case 'audit:entry':
      return `Audit: ${p.tokenCount} tokens, hash ${p.contextHash}`;
    case 'approval:request':
      return `Approval required (sensitivity ${p.sensitivityLevel})`;
    case 'proactive:trigger':
      return `Trigger: ${p.triggerType || 'event'}`;
    case 'consensus:update':
      return `Consensus: ${p.status || p.action}`;
    case 'work_item:pipeline_step': {
      const phase = p.phase ?? 'step';
      const agent = p.agentType ?? 'agent';
      const iter = typeof p.loopIteration === 'number' ? ` iter ${p.loopIteration}` : '';
      return `${phase}${iter} · ${agent} · ${p.status ?? 'update'}`;
    }
    case 'work_item:loop_update':
      return `Loop ${p.loopIteration}/${p.maxLoopIterations} · ${p.loopStatus}`;
    case 'work_item:activity': {
      const activity = p.activity as { summary?: string; activityType?: string } | undefined;
      return activity?.summary ?? activity?.activityType ?? 'activity';
    }
    case 'work_item:update':
      return p.deleted ? `Deleted ${p.key}` : `${p.key} → ${p.status}`;
    case 'loop:job':
      return `Job ${String(p.jobId ?? '').slice(0, 8)} · ${p.status}`;
    case 'shift:update':
      return p.action === 'auto_start'
        ? `Shift scheduler started work on sprint ${String(p.sprintId ?? '').slice(0, 8)}`
        : `Shift update: ${p.action ?? 'tick'}`;
    case 'sprint_automation:status': {
      const standup = p.standup as { sprintName?: string; done?: number; inProgress?: number; todo?: number } | undefined;
      if (standup?.sprintName) {
        return `Standup ${standup.sprintName}: ${standup.done ?? 0} done, ${standup.inProgress ?? 0} in progress, ${standup.todo ?? 0} remaining`;
      }
      const roles = Array.isArray(p.onShiftRoles) ? (p.onShiftRoles as string[]).join(', ') : 'none';
      const paused = p.pausedReason ? ` · ${p.pausedReason}` : '';
      return `Sprint automation ${p.mode ?? ''} · on shift: ${roles}${paused}`;
    }
    case 'story_queue:progress':
      return `Sprint queue ${p.status ?? 'update'}: ${p.completed ?? 0}/${p.total ?? '?'} items`;
    case 'work_item:cli_output': {
      const stream = p.stream === 'stderr' ? 'stderr' : 'stdout';
      // Keep full text so Live Activity can expand; list UI truncates with CSS.
      const chunk = typeof p.chunk === 'string' ? p.chunk.replace(/\s+/g, ' ').trim() : '';
      return `CLI ${stream}: ${chunk}`;
    }
    default:
      return (p.message as string) || msg.type;
  }
}

export const useAppStore = create<AppState>((set) => ({
  liveEvents: [],
  agentStatuses: {},
  terminalOutput: [],
  selectedCode: '// Select a workflow execution to view output\n',
  connectionStatus: 'connecting',
  pendingJobsByWorkItem: {},

  addLiveEvent: (msg) =>
    set((s) => {
      const event: LiveEvent = {
        id: `${Date.now()}-${Math.random()}`,
        type: msg.type,
        message: formatEvent(msg),
        timestamp: msg.timestamp,
      };
      const terminalLine = `[${new Date(msg.timestamp).toLocaleTimeString()}] ${event.message}`;
      const events = [event, ...s.liveEvents].slice(0, 50);
      const terminal = [...s.terminalOutput, terminalLine].slice(-200);

      if (msg.type === 'agent:status' && msg.payload.agentId) {
        return {
          liveEvents: events,
          terminalOutput: terminal,
          agentStatuses: {
            ...s.agentStatuses,
            [msg.payload.agentId as string]: msg.payload.status as AgentStatus,
          },
        };
      }

      if (msg.type === 'workflow:update' && msg.payload.result) {
        return {
          liveEvents: events,
          terminalOutput: [...terminal, String(msg.payload.result)].slice(-200),
          selectedCode: String(msg.payload.result),
        };
      }

      return { liveEvents: events, terminalOutput: terminal };
    }),

  setAgentStatus: (agentId, status) =>
    set((s) => ({ agentStatuses: { ...s.agentStatuses, [agentId]: status } })),

  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),

  setPendingJob: (workItemId, jobId) =>
    set((s) => ({
      pendingJobsByWorkItem: { ...s.pendingJobsByWorkItem, [workItemId]: jobId },
    })),

  clearPendingJob: (workItemId) =>
    set((s) => {
      const next = { ...s.pendingJobsByWorkItem };
      delete next[workItemId];
      return { pendingJobsByWorkItem: next };
    }),

  appendTerminal: (line) =>
    set((s) => ({ terminalOutput: [...s.terminalOutput, line].slice(-200) })),

  clearTerminal: () => set({ terminalOutput: [] }),

  setSelectedCode: (code) => set({ selectedCode: code }),
}));