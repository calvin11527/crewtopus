import type {
  AgentType,
  EvalResult,
  LoopStatus,
  SprintStatus,
  WorkItemActivity,
  WorkItemStatus,
  WorkItemType,
} from '../../types';

export const DETAIL_WIDTH_KEY = 'agenthub.board.detailWidth';
export const CONSOLE_HEIGHT_KEY = 'agenthub.board.consoleHeight';
/** Persisted board sprint selection: sprint id, `__all__` = All items, absent = auto active sprint. */
export const SPRINT_SELECTION_KEY = 'agenthub.board.selectedSprint';
export const SPRINT_SELECTION_ALL = '__all__';
export const DEFAULT_DETAIL_WIDTH = 460;
export const DEFAULT_CONSOLE_HEIGHT = 240;

export function readStoredNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function storeNumber(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* ignore */
  }
}

/** `undefined` = auto active sprint; `null` = All items; string = sprint id. */
export function readStoredSprintSelection(): string | null | undefined {
  try {
    const raw = localStorage.getItem(SPRINT_SELECTION_KEY);
    if (raw == null) return undefined;
    if (raw === '' || raw === SPRINT_SELECTION_ALL) return null;
    return raw;
  } catch {
    return undefined;
  }
}

export function storeSprintSelection(value: string | null | undefined): void {
  try {
    if (value === undefined) {
      localStorage.removeItem(SPRINT_SELECTION_KEY);
    } else if (value === null) {
      localStorage.setItem(SPRINT_SELECTION_KEY, SPRINT_SELECTION_ALL);
    } else {
      localStorage.setItem(SPRINT_SELECTION_KEY, value);
    }
  } catch {
    /* ignore */
  }
}

export const COLUMNS: { id: WorkItemStatus; label: string }[] = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'todo', label: 'To Do' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'in_review', label: 'In Review' },
  { id: 'done', label: 'Done' },
];

export const COLUMN_LABEL: Record<WorkItemStatus, string> = Object.fromEntries(
  COLUMNS.map((c) => [c.id, c.label])
) as Record<WorkItemStatus, string>;

export const TYPES: WorkItemType[] = ['epic', 'story', 'task', 'bug'];
export const AGENTS: AgentType[] = ['mock', 'claude', 'grok', 'copilot', 'antigravity', 'ollama'];
export const SPRINT_STATUSES: SprintStatus[] = ['planning', 'active', 'completed'];

export interface SprintFormState {
  name: string;
  goal: string;
  status: SprintStatus;
}

export const emptySprintForm = (): SprintFormState => ({
  name: '',
  goal: '',
  status: 'planning',
});

export const TYPE_COLORS: Record<WorkItemType, string> = {
  epic: 'var(--accent-purple)',
  story: 'var(--accent-blue)',
  task: 'var(--accent-green)',
  bug: 'var(--accent-red)',
};

export function activityContent(activity: WorkItemActivity): string | undefined {
  const content = activity.metadata?.content;
  return typeof content === 'string' && content.trim() ? content : undefined;
}

export function activityWorkDir(activity: WorkItemActivity): string | undefined {
  const workDir = activity.metadata?.workDir;
  return typeof workDir === 'string' && workDir.trim() ? workDir : undefined;
}

export function activityLoopIteration(activity: WorkItemActivity): number | undefined {
  const iter = activity.metadata?.loopIteration;
  return typeof iter === 'number' ? iter : undefined;
}

export function activityEvalResults(activity: WorkItemActivity): EvalResult[] | undefined {
  const raw = activity.metadata?.evalResults;
  if (!Array.isArray(raw)) return undefined;
  return raw as EvalResult[];
}

export function loopBadgeLabel(item: { loopStatus: LoopStatus; loopIteration: number; maxLoopIterations: number }): string | null {
  if (item.loopStatus === 'running') {
    return `${item.loopIteration}/${item.maxLoopIterations}`;
  }
  if (item.loopStatus === 'escalated') return 'needs review';
  if (item.loopStatus === 'awaiting_approval') return 'needs approval';
  if (item.loopIteration > 0 && item.loopStatus === 'approved') {
    return `✓ ${item.loopIteration} iter`;
  }
  return null;
}

export const LOOP_STATUS_LABEL: Record<LoopStatus, string> = {
  idle: 'Idle',
  running: 'Running',
  approved: 'Approved',
  escalated: 'Escalated — needs human review',
  failed: 'Failed',
  cancelled: 'Cancelled',
  awaiting_shift: 'Awaiting next shift',
  awaiting_approval: 'Awaiting approval',
};

export interface ItemFormState {
  title: string;
  type: WorkItemType;
  agent: AgentType;
  description: string;
  workspaceId: string;
}

export const emptyForm = (): ItemFormState => ({
  title: '',
  type: 'story',
  agent: 'mock',
  description: '',
  workspaceId: '',
});
