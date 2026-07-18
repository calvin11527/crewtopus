import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Columns3,
  Plus,
  Play,
  Bot,
  FileText,
  Pencil,
  Trash2,
  ArrowRightLeft,
  GitBranch,
  GripVertical,
  Layers,
  PanelRightClose,
  PanelRightOpen,
  Square,
  Users,
  Clock,
  Lock,
  AlertCircle,
} from 'lucide-react';
import {
  useBoard,
  useSprints,
  useCreateSprint,
  useUpdateSprint,
  useDeleteSprint,
  useWorkItemActivity,
  useCreateWorkItem,
  useUpdateWorkItem,
  useDeleteWorkItem,
  useRunWorkItemAgent,
  useRunWorkItemPipeline,
  useRunWorkItemLifecycle,
  useRerunWorkItemReview,
  useCancelWorkItemLoop,
  useLoopJob,
  useCreatePipelineDemo,
  useRunStoryQueue,
  useStoryQueueRun,
  type StoryQueueResult,
  useWorkItemLoop,
  useWorkItemDeliverables,
  useWorkspaces,
  useRepositories,
  useAuditEntry,
  useAgentRoster,
  useSprintTeam,
  useSetSprintTeam,
  useSprintAutomation,
  useSetSprintAutomation,
  type PipelineStepResult,
  queryKeys,
} from '../api/hooks';
import type {
  WorkItem,
  WorkItemActivity,
  WorkItemStatus,
  WorkItemType,
  AgentType,
  LoopStatus,
  EvalResult,
  AgentRole,
  Sprint,
  SprintStatus,
} from '../types';
import StatusBadge from '../components/StatusBadge';
import Modal from '../components/Modal';
import AgentConsole from '../components/AgentConsole';
import WorkItemAgentHistory from '../components/WorkItemAgentHistory';
import KanbanCliPreview from '../components/KanbanCliPreview';
import SprintTeamPanel from '../components/SprintTeamPanel';
import LiveFeed from '../components/LiveFeed';
import { useWorkItemAgentConsole } from '../hooks/useWorkItemAgentConsole';
import { useDragResize } from '../hooks/useDragResize';
import { useCliPreviewStore } from '../stores/useCliPreviewStore';
import { useAppStore } from '../stores/useAppStore';
import { AGENT_ROLE_LABELS, STAFF_ROLES, emptyStaffDraft } from '../constants/agent-roles';
import {
  automationPauseHint,
  automationPauseLabel,
} from '../constants/sprint-automation';
import { isWorkItemBusy, workItemBusyMessage } from '../utils/work-item-busy';
import { workItemLifecycleChip } from '../utils/work-item-agent-history';
import {
  displayWorkItemTitle,
  isOversizedTitle,
  titleOverflowBody,
} from '../utils/work-item-display';

const DETAIL_WIDTH_KEY = 'agenthub.board.detailWidth';
const CONSOLE_HEIGHT_KEY = 'agenthub.board.consoleHeight';
/** Persisted board sprint selection: sprint id, `__all__` = All items, absent = auto active sprint. */
const SPRINT_SELECTION_KEY = 'agenthub.board.selectedSprint';
const SPRINT_SELECTION_ALL = '__all__';
const DEFAULT_DETAIL_WIDTH = 460;
const DEFAULT_CONSOLE_HEIGHT = 240;

function readStoredNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function storeNumber(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* ignore */
  }
}

/** `undefined` = auto active sprint; `null` = All items; string = sprint id. */
function readStoredSprintSelection(): string | null | undefined {
  try {
    const raw = localStorage.getItem(SPRINT_SELECTION_KEY);
    if (raw == null) return undefined;
    if (raw === '' || raw === SPRINT_SELECTION_ALL) return null;
    return raw;
  } catch {
    return undefined;
  }
}

function storeSprintSelection(value: string | null | undefined): void {
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

const COLUMNS: { id: WorkItemStatus; label: string }[] = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'todo', label: 'To Do' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'in_review', label: 'In Review' },
  { id: 'done', label: 'Done' },
];

const COLUMN_LABEL: Record<WorkItemStatus, string> = Object.fromEntries(
  COLUMNS.map((c) => [c.id, c.label])
) as Record<WorkItemStatus, string>;

const TYPES: WorkItemType[] = ['epic', 'story', 'task', 'bug'];
const AGENTS: AgentType[] = ['mock', 'claude', 'grok', 'copilot', 'antigravity', 'ollama'];
const SPRINT_STATUSES: SprintStatus[] = ['planning', 'active', 'completed'];

interface SprintFormState {
  name: string;
  goal: string;
  status: SprintStatus;
}

const emptySprintForm = (): SprintFormState => ({
  name: '',
  goal: '',
  status: 'planning',
});

const TYPE_COLORS: Record<WorkItemType, string> = {
  epic: 'var(--accent-purple)',
  story: 'var(--accent-blue)',
  task: 'var(--accent-green)',
  bug: 'var(--accent-red)',
};

function activityContent(activity: WorkItemActivity): string | undefined {
  const content = activity.metadata?.content;
  return typeof content === 'string' && content.trim() ? content : undefined;
}

function activityWorkDir(activity: WorkItemActivity): string | undefined {
  const workDir = activity.metadata?.workDir;
  return typeof workDir === 'string' && workDir.trim() ? workDir : undefined;
}

function activityLoopIteration(activity: WorkItemActivity): number | undefined {
  const iter = activity.metadata?.loopIteration;
  return typeof iter === 'number' ? iter : undefined;
}

function activityEvalResults(activity: WorkItemActivity): EvalResult[] | undefined {
  const raw = activity.metadata?.evalResults;
  if (!Array.isArray(raw)) return undefined;
  return raw as EvalResult[];
}

function loopBadgeLabel(item: WorkItem): string | null {
  if (item.loopStatus === 'running') {
    return `${item.loopIteration}/${item.maxLoopIterations}`;
  }
  if (item.loopStatus === 'escalated') return 'needs review';
  if (item.loopIteration > 0 && item.loopStatus === 'approved') {
    return `✓ ${item.loopIteration} iter`;
  }
  return null;
}

const LOOP_STATUS_LABEL: Record<LoopStatus, string> = {
  idle: 'Idle',
  running: 'Running',
  approved: 'Approved',
  escalated: 'Escalated — needs human review',
  failed: 'Failed',
  cancelled: 'Cancelled',
  awaiting_shift: 'Awaiting next shift',
};

interface ItemFormState {
  title: string;
  type: WorkItemType;
  agent: AgentType;
  description: string;
  workspaceId: string;
}

const emptyForm = (): ItemFormState => ({
  title: '',
  type: 'story',
  agent: 'mock',
  description: '',
  workspaceId: '',
});

export default function Board() {
  const qc = useQueryClient();
  const pendingJobsByWorkItem = useAppStore((s) => s.pendingJobsByWorkItem);
  const setPendingJob = useAppStore((s) => s.setPendingJob);
  const clearPendingJob = useAppStore((s) => s.clearPendingJob);
  const { data: sprints } = useSprints();
  const activeSprint = sprints?.find((s) => s.status === 'active') ?? sprints?.[0];
  /** `undefined` = auto-select active sprint; `null` = All items; string = explicit sprint id */
  const [sprintId, setSprintIdState] = useState<string | null | undefined>(() =>
    readStoredSprintSelection()
  );
  const setSprintId = useCallback((value: string | null | undefined) => {
    setSprintIdState(value);
    storeSprintSelection(value);
  }, []);
  const selectedSprint = sprintId === null ? undefined : (sprintId ?? activeSprint?.id);
  const currentSprint: Sprint | undefined = sprints?.find((s) => s.id === selectedSprint);

  // Drop stale stored sprint ids (deleted sprint) so we don't show an empty board forever
  useEffect(() => {
    if (!sprints || typeof sprintId !== 'string') return;
    if (!sprints.some((s) => s.id === sprintId)) {
      setSprintId(undefined);
    }
  }, [sprints, sprintId, setSprintId]);
  const { data: board, isLoading } = useBoard(selectedSprint);
  const createSprint = useCreateSprint();
  const updateSprint = useUpdateSprint();
  const deleteSprint = useDeleteSprint();
  const createItem = useCreateWorkItem();
  const updateItem = useUpdateWorkItem();
  const deleteItem = useDeleteWorkItem();
  const runAgent = useRunWorkItemAgent();
  const runPipeline = useRunWorkItemPipeline();
  const runLifecycle = useRunWorkItemLifecycle();
  const rerunReview = useRerunWorkItemReview();
  const cancelLoop = useCancelWorkItemLoop();
  const runStoryQueue = useRunStoryQueue();
  const [queueResult, setQueueResult] = useState<StoryQueueResult | null>(null);
  const [activeQueueId, setActiveQueueId] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const { data: polledQueue } = useStoryQueueRun(activeQueueId);
  const { data: polledJob } = useLoopJob(activeJobId);
  const createDemo = useCreatePipelineDemo();
  const { data: roster } = useAgentRoster();
  const { data: sprintTeam } = useSprintTeam(selectedSprint);
  const { data: sprintAutomation } = useSprintAutomation(selectedSprint);
  const setSprintTeam = useSetSprintTeam();
  const setSprintAutomation = useSetSprintAutomation();
  const [staffOpen, setStaffOpen] = useState(false);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [staffDraft, setStaffDraft] = useState<Record<AgentRole, string>>(emptyStaffDraft);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const [selected, setSelected] = useState<WorkItem | null>(null);
  const hasAutoOpenedRef = useRef(false);
  const [pipelineResult, setPipelineResult] = useState<{
    steps: PipelineStepResult[];
    reviewVerdict: string;
    iterations: number;
    loopStatus: LoopStatus;
    evalResults?: EvalResult[];
  } | null>(null);
  const selectedHasPendingJob = selected ? Boolean(pendingJobsByWorkItem[selected.id]) : false;
  const isSelectedBusy =
    !!activeJobId ||
    selectedHasPendingJob ||
    selected?.status === 'in_progress' ||
    selected?.loopStatus === 'running';
  const { data: activity } = useWorkItemActivity(selected?.id ?? null, isSelectedBusy);
  const { data: loopHistory } = useWorkItemLoop(selected?.id ?? null, isSelectedBusy);
  const { data: deliverables } = useWorkItemDeliverables(selected?.id ?? null, isSelectedBusy);
  const { data: workspaces } = useWorkspaces();
  const { data: selectedWorkspaceRepos } = useRepositories(selected?.workspaceId ?? '');
  const [lastAgentOutput, setLastAgentOutput] = useState<{
    content: string;
    agentType: AgentType;
    auditId?: string;
    workDir?: string;
  } | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<WorkItem | null>(null);
  const [form, setForm] = useState<ItemFormState>(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<WorkItem | null>(null);
  const [moveTarget, setMoveTarget] = useState<{ item: WorkItem; toStatus: WorkItemStatus } | null>(null);
  const [sprintCreateOpen, setSprintCreateOpen] = useState(false);
  const [sprintEditOpen, setSprintEditOpen] = useState(false);
  const [sprintDeleteOpen, setSprintDeleteOpen] = useState(false);
  const [sprintForm, setSprintForm] = useState<SprintFormState>(emptySprintForm);
  const [sprintFormError, setSprintFormError] = useState<string | null>(null);
  const [renamingSprint, setRenamingSprint] = useState(false);
  const [sprintNameDraft, setSprintNameDraft] = useState('');
  const [sprintGoalExpanded, setSprintGoalExpanded] = useState(false);
  const sprintNameInputRef = useRef<HTMLInputElement>(null);
  /** When true, blur must not commit (Escape cancel). */
  const skipSprintRenameCommitRef = useRef(false);
  const cliPreviews = useCliPreviewStore((s) => s.previews);
  const agentStatuses = useAppStore((s) => s.agentStatuses);
  const [detailWidth, setDetailWidth] = useState(() => readStoredNumber(DETAIL_WIDTH_KEY, DEFAULT_DETAIL_WIDTH));
  const [consoleHeight, setConsoleHeight] = useState(() =>
    readStoredNumber(CONSOLE_HEIGHT_KEY, DEFAULT_CONSOLE_HEIGHT)
  );

  const persistDetailWidth = useCallback((width: number) => storeNumber(DETAIL_WIDTH_KEY, width), []);
  const persistConsoleHeight = useCallback((height: number) => storeNumber(CONSOLE_HEIGHT_KEY, height), []);

  const setDetailWidthPersisted = useCallback(
    (width: number) => {
      const clamped = Math.min(960, Math.max(320, width));
      setDetailWidth(clamped);
      persistDetailWidth(clamped);
    },
    [persistDetailWidth]
  );

  const detailResize = useDragResize({
    axis: 'horizontal',
    min: 320,
    max: Math.min(typeof window !== 'undefined' ? window.innerWidth * 0.88 : 900, 960),
    onResize: setDetailWidth,
    onCommit: persistDetailWidth,
  });

  const latestCompleted = useMemo(
    () => activity?.find((a) => a.activityType === 'agent_completed'),
    [activity]
  );
  const { data: linkedAudit } = useAuditEntry(
    latestCompleted?.auditId && !activityContent(latestCompleted) ? latestCompleted.auditId : null
  );

  const boardItem = useMemo(() => {
    if (!selected || !board) return null;
    for (const col of COLUMNS) {
      const found = board.columns[col.id]?.find((i) => i.id === selected.id);
      if (found) return found;
    }
    return selected;
  }, [selected, board]);

  const itemHasActiveJob = useCallback(
    (itemId: string) =>
      Boolean(pendingJobsByWorkItem[itemId]) ||
      (activeJobId != null && selected?.id === itemId),
    [pendingJobsByWorkItem, activeJobId, selected?.id]
  );

  const detailBusy = useMemo(() => {
    if (!boardItem) return { busy: false, message: '' };
    const hasJob = itemHasActiveJob(boardItem.id);
    return {
      busy: isWorkItemBusy(boardItem, hasJob),
      message: workItemBusyMessage(boardItem, hasJob),
    };
  }, [boardItem, itemHasActiveJob]);

  const displayNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const r of roster ?? []) {
      map[r.id] = r.employment?.displayTitle ?? r.name;
    }
    return map;
  }, [roster]);

  const runningItems = useMemo(() => {
    if (!board) return [];
    const items: WorkItem[] = [];
    for (const col of COLUMNS) {
      for (const item of board.columns[col.id] ?? []) {
        if (item.loopStatus === 'running' || item.status === 'in_progress') {
          items.push(item);
        }
      }
    }
    return items;
  }, [board]);

  useEffect(() => {
    if (!board || selected || hasAutoOpenedRef.current) return;
    const primary =
      runningItems.find((i) => i.loopStatus === 'running') ?? runningItems[0];
    if (primary) {
      hasAutoOpenedRef.current = true;
      setSelected(primary);
      setLastAgentOutput(null);
      setPipelineResult(null);
    }
  }, [board, selected, runningItems]);

  useEffect(() => {
    if (boardItem && selected && boardItem.id === selected.id) {
      if (
        boardItem.loopStatus !== selected.loopStatus ||
        boardItem.loopIteration !== selected.loopIteration ||
        boardItem.status !== selected.status
      ) {
        setSelected(boardItem);
      }
    }
  }, [boardItem, selected]);

  const agentConsole = useWorkItemAgentConsole({
    workItem: boardItem,
    activity,
  });

  const focusedProjectPath = useMemo(() => {
    if (!boardItem?.workspaceId || !selectedWorkspaceRepos?.length) return null;
    const ws = workspaces?.find((w) => w.id === boardItem.workspaceId);
    const primaryId =
      typeof ws?.config?.primaryRepoId === 'string' ? ws.config.primaryRepoId : selectedWorkspaceRepos[0]?.id;
    return selectedWorkspaceRepos.find((r) => r.id === primaryId)?.path ?? selectedWorkspaceRepos[0]?.path;
  }, [boardItem?.workspaceId, selectedWorkspaceRepos, workspaces]);

  const activityByIteration = useMemo(() => {
    if (!activity?.length) return [];
    const groups = new Map<number, WorkItemActivity[]>();
    for (const a of activity) {
      const iter = activityLoopIteration(a) ?? 0;
      const list = groups.get(iter) ?? [];
      list.push(a);
      groups.set(iter, list);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => b - a)
      .map(([iteration, entries]) => ({ iteration, entries }));
  }, [activity]);

  const latestAgentResult = useMemo(() => {
    if (!activity?.length) return lastAgentOutput;
    const completed = activity.find((a) => a.activityType === 'agent_completed');
    if (!completed) return lastAgentOutput;

    const fromActivity = activityContent(completed);
    const fromAudit =
      typeof linkedAudit?.responseMetadata?.content === 'string'
        ? linkedAudit.responseMetadata.content
        : undefined;
    const content = fromActivity || fromAudit;
    if (!content) return lastAgentOutput;

    return {
      content,
      agentType:
        (completed.metadata?.agentType as AgentType) ||
        (linkedAudit?.responseMetadata?.adapter as AgentType) ||
        completed.agentType ||
        'mock',
      auditId: completed.auditId,
      workDir:
        activityWorkDir(completed) ||
        (typeof linkedAudit?.responseMetadata?.cwd === 'string' ? linkedAudit.responseMetadata.cwd : undefined),
    };
  }, [activity, lastAgentOutput, linkedAudit]);

  const openCreate = () => {
    setForm(emptyForm());
    setCreateOpen(true);
  };

  const notifyBusy = useCallback((item: WorkItem, hasActiveJob = false) => {
    const message = workItemBusyMessage(item, hasActiveJob);
    setActionNotice(message);
    window.setTimeout(() => setActionNotice(null), 6000);
  }, []);

  const openEdit = (item: WorkItem) => {
    const hasJob = itemHasActiveJob(item.id);
    if (isWorkItemBusy(item, hasJob)) {
      notifyBusy(item, hasJob);
      return;
    }
    setEditItem(item);
    setForm({
      title: item.title,
      type: item.type,
      agent: item.assignedAgentType || 'mock',
      description: item.description || '',
      workspaceId: item.workspaceId || '',
    });
  };

  const handleCreate = async () => {
    if (!form.title.trim()) return;
    await createItem.mutateAsync({
      type: form.type,
      title: form.title.trim(),
      description: form.type === 'task' && form.description.trim() ? form.description.trim() : undefined,
      assignedAgentType: form.agent,
      workspaceId: form.workspaceId || undefined,
      sprintId: selectedSprint,
      status: 'backlog',
    });
    setCreateOpen(false);
    setForm(emptyForm());
  };

  const handleEdit = async () => {
    if (!editItem || !form.title.trim()) return;
    const updated = await updateItem.mutateAsync({
      id: editItem.id,
      title: form.title.trim(),
      type: form.type,
      description: form.description.trim() || undefined,
      assignedAgentType: form.agent,
      workspaceId: form.workspaceId || undefined,
    });
    if (selected?.id === editItem.id) setSelected(updated);
    setEditItem(null);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await deleteItem.mutateAsync(deleteTarget.id);
    if (selected?.id === deleteTarget.id) closeDetail();
    setDeleteTarget(null);
  };

  const requestMove = (item: WorkItem, toStatus: WorkItemStatus) => {
    if (item.status === toStatus) return;
    setMoveTarget({ item, toStatus });
  };

  const confirmMove = async () => {
    if (!moveTarget) return;
    const updated = await updateItem.mutateAsync({ id: moveTarget.item.id, status: moveTarget.toStatus });
    if (selected?.id === moveTarget.item.id) setSelected(updated);
    setMoveTarget(null);
  };

  const handleRunAgent = async (item: WorkItem) => {
    const hasJob = itemHasActiveJob(item.id);
    if (isWorkItemBusy(item, hasJob)) {
      notifyBusy(item, hasJob);
      return;
    }
    const result = await runAgent.mutateAsync({ id: item.id, async: true });
    if ('jobId' in result) {
      setActiveJobId(result.jobId);
      setPendingJob(item.id, result.jobId);
      setSelected({ ...item, status: 'in_progress' });
      setPipelineResult(null);
      return;
    }
    setSelected(result.item);
    setPipelineResult(null);
    setLastAgentOutput({
      content: result.result.content,
      agentType: result.result.agentType,
      auditId: result.result.auditId,
    });
  };

  const handleRerunReview = async (item: WorkItem, runAsync = true) => {
    const hasJob = itemHasActiveJob(item.id);
    if (isWorkItemBusy(item, hasJob)) {
      notifyBusy(item, hasJob);
      return;
    }
    try {
      const result = await rerunReview.mutateAsync({ id: item.id, async: runAsync });
      if ('jobId' in result) {
        setActiveJobId(result.jobId);
        setPendingJob(item.id, result.jobId);
        setSelected({ ...item, status: 'in_progress', loopStatus: 'running' });
        setPipelineResult(null);
        return;
      }
      setActiveJobId(null);
      clearPendingJob(item.id);
      setSelected(result.item);
      setPipelineResult({
        steps: result.steps,
        reviewVerdict: result.reviewVerdict,
        iterations: result.iterations,
        loopStatus: result.loopStatus,
        evalResults: result.evalResults,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Review retry failed';
      if (message.includes('busy') || message.includes('in progress') || message.includes('review')) {
        setActionNotice(message);
      }
      throw err;
    }
  };

  const handleRunPipeline = async (item: WorkItem, runAsync = true) => {
    const hasJob = itemHasActiveJob(item.id);
    if (isWorkItemBusy(item, hasJob)) {
      notifyBusy(item, hasJob);
      return;
    }
    try {
      const result = await runPipeline.mutateAsync({ id: item.id, async: runAsync });
      if ('jobId' in result) {
        setActiveJobId(result.jobId);
        setPendingJob(item.id, result.jobId);
        setSelected({ ...item, status: 'in_progress', loopStatus: 'running' });
        setPipelineResult(null);
        return;
      }
      setActiveJobId(null);
      clearPendingJob(item.id);
      setSelected(result.item);
      setPipelineResult({
        steps: result.steps,
        reviewVerdict: result.reviewVerdict,
        iterations: result.iterations,
        loopStatus: result.loopStatus,
        evalResults: result.evalResults,
      });
      const review = result.steps.find((s) => s.phase === 'review');
      setLastAgentOutput({
        content: result.steps.map((s) => `## ${s.phase} (${s.agentType})\n${s.content}`).join('\n\n'),
        agentType: review?.agentType ?? 'copilot',
        auditId: review?.auditId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Pipeline failed';
      if (message.includes('pipeline') || message.includes('busy') || message.includes('in progress')) {
        setActionNotice(message);
      }
      throw err;
    }
  };

  /** BA → PM → developer pipeline from current story phase (tasks skip to pipeline). */
  const handleRunLifecycle = async (item: WorkItem) => {
    const hasJob = itemHasActiveJob(item.id);
    if (isWorkItemBusy(item, hasJob)) {
      notifyBusy(item, hasJob);
      return;
    }
    try {
      const result = await runLifecycle.mutateAsync({ id: item.id, async: true });
      if ('jobId' in result) {
        setActiveJobId(result.jobId);
        setPendingJob(result.workItemId, result.jobId);
        if (result.storyId && result.storyId !== result.workItemId) {
          setPendingJob(result.storyId, result.jobId);
        }
        setSelected({
          ...item,
          status: 'in_progress',
          loopStatus: result.step === 'pipeline' ? 'running' : item.loopStatus,
        });
        setPipelineResult(null);
        setActionNotice(result.message);
        return;
      }
      setActionNotice(result.message);
      if (result.pipeline) {
        setSelected(result.pipeline.item);
        setPipelineResult({
          steps: result.pipeline.steps,
          reviewVerdict: result.pipeline.reviewVerdict,
          iterations: result.pipeline.iterations,
          loopStatus: result.pipeline.loopStatus,
          evalResults: result.pipeline.evalResults,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Full lifecycle failed';
      setActionNotice(message);
      throw err;
    }
  };

  const handleMultiAgentDemo = async () => {
    const { item } = await createDemo.mutateAsync(selectedSprint);
    await handleRunPipeline(item);
  };

  useEffect(() => {
    if (!sprintTeam) return;
    const draft = emptyStaffDraft();
    for (const m of sprintTeam.members) {
      draft[m.role] = m.agentId;
    }
    setStaffDraft(draft);
  }, [sprintTeam]);

  const handleSaveTeam = async () => {
    if (!selectedSprint) return;
    setStaffError(null);
    const members = STAFF_ROLES.filter((role) => staffDraft[role]).map((role) => ({
      agentId: staffDraft[role],
      role,
    }));
    try {
      await setSprintTeam.mutateAsync({ sprintId: selectedSprint, members });
      setStaffOpen(false);
    } catch (err) {
      setStaffError((err as Error).message);
    }
  };

  const handleToggleAutomation = async () => {
    if (!selectedSprint || !sprintAutomation) return;
    const next = sprintAutomation.automation.mode === 'autonomous' ? 'paused' : 'autonomous';
    await setSprintAutomation.mutateAsync({ sprintId: selectedSprint, mode: next });
  };

  const handleRunSprintQueue = async () => {
    if (!selectedSprint) return;
    try {
      const result = await runStoryQueue.mutateAsync({
        sprintId: selectedSprint,
        demo: false,
        async: true,
      });

      if (result.message) {
        setActionNotice(result.message);
        window.setTimeout(() => setActionNotice(null), 10_000);
      }

      // Empty-sprint bootstrap starts BA→PM→pipeline as a loop job
      if (result.mode === 'full_lifecycle' && result.jobId) {
        setActiveJobId(result.jobId);
        if (result.workItemId) setPendingJob(result.workItemId, result.jobId);
        if (result.storyId && result.storyId !== result.workItemId) {
          setPendingJob(result.storyId, result.jobId);
        }
        setActiveQueueId(null);
        setQueueResult(result);

        // Open seed story so Agent history + console are visible immediately
        const focusId = result.storyId ?? result.workItemId;
        if (focusId) {
          setSelected({
            id: focusId,
            key: result.seedStoryKey ?? '…',
            type: 'story',
            title: result.bootstrapped
              ? 'Sprint bootstrap — agents planning…'
              : 'Lifecycle running…',
            status: 'in_progress',
            priority: 'high',
            labels: result.bootstrapped ? ['sprint-bootstrap', 'lifecycle'] : [],
            acceptanceCriteria: [],
            loopIteration: 0,
            maxLoopIterations: 3,
            loopStatus: result.step === 'pipeline' ? 'running' : 'idle',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            sprintId: selectedSprint,
          });
        }
        return;
      }

      setQueueResult(result);
      if (result.status === 'running' && result.queueId) setActiveQueueId(result.queueId);

      // Bootstrapped into story queue (no BA/PM) — still open the seed story if known
      if (result.bootstrapped && result.workItemIds?.[0]) {
        const focusId = result.workItemIds[0];
        setSelected({
          id: focusId,
          key: result.seedStoryKey ?? '…',
          type: 'story',
          title: 'Sprint bootstrap — developer pipeline…',
          status: 'in_progress',
          priority: 'high',
          labels: ['sprint-bootstrap'],
          acceptanceCriteria: [],
          loopIteration: 0,
          maxLoopIterations: 3,
          loopStatus: 'running',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          sprintId: selectedSprint,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sprint queue failed';
      setActionNotice(message);
      throw err;
    }
  };

  const openSprintCreate = () => {
    setSprintForm(emptySprintForm());
    setSprintFormError(null);
    setSprintCreateOpen(true);
  };

  const openSprintEdit = () => {
    if (!currentSprint) return;
    setSprintForm({
      name: currentSprint.name,
      goal: currentSprint.goal ?? '',
      status: currentSprint.status,
    });
    setSprintFormError(null);
    setSprintEditOpen(true);
  };

  const handleCreateSprint = async () => {
    const name = sprintForm.name.trim();
    if (!name) {
      setSprintFormError('Sprint name is required');
      return;
    }
    try {
      setSprintFormError(null);
      const sprint = await createSprint.mutateAsync({
        name,
        goal: sprintForm.goal.trim() || undefined,
        status: sprintForm.status,
      });
      setSprintId(sprint.id);
      setSprintCreateOpen(false);
      setActionNotice(`Created sprint “${sprint.name}”`);
    } catch (err) {
      setSprintFormError((err as Error).message);
    }
  };

  const handleUpdateSprint = async () => {
    if (!currentSprint) return;
    const name = sprintForm.name.trim();
    if (!name) {
      setSprintFormError('Sprint name is required');
      return;
    }
    try {
      setSprintFormError(null);
      const sprint = await updateSprint.mutateAsync({
        id: currentSprint.id,
        name,
        goal: sprintForm.goal.trim() || null,
        status: sprintForm.status,
      });
      setSprintEditOpen(false);
      setActionNotice(`Updated sprint “${sprint.name}”`);
    } catch (err) {
      setSprintFormError((err as Error).message);
    }
  };

  const beginSprintRename = () => {
    if (!currentSprint) return;
    skipSprintRenameCommitRef.current = false;
    setSprintNameDraft(currentSprint.name);
    setRenamingSprint(true);
  };

  const cancelSprintRename = () => {
    skipSprintRenameCommitRef.current = true;
    if (currentSprint) setSprintNameDraft(currentSprint.name);
    setRenamingSprint(false);
  };

  useEffect(() => {
    if (renamingSprint) {
      sprintNameInputRef.current?.focus();
      sprintNameInputRef.current?.select();
    }
  }, [renamingSprint]);

  const commitSprintRename = async () => {
    if (skipSprintRenameCommitRef.current) {
      skipSprintRenameCommitRef.current = false;
      setRenamingSprint(false);
      return;
    }
    if (!currentSprint) {
      setRenamingSprint(false);
      return;
    }
    const name = sprintNameDraft.trim();
    if (!name) {
      setSprintNameDraft(currentSprint.name);
      setRenamingSprint(false);
      setActionNotice('Sprint name cannot be empty');
      return;
    }
    if (name === currentSprint.name) {
      setRenamingSprint(false);
      return;
    }
    try {
      await updateSprint.mutateAsync({ id: currentSprint.id, name });
      setRenamingSprint(false);
    } catch (err) {
      setActionNotice((err as Error).message);
      setSprintNameDraft(currentSprint.name);
      setRenamingSprint(false);
    }
  };

  const handleDeleteSprint = async () => {
    if (!currentSprint) return;
    const deletedId = currentSprint.id;
    const deletedName = currentSprint.name;
    try {
      await deleteSprint.mutateAsync(deletedId);
      setSprintDeleteOpen(false);
      // After delete, show All items so the user clearly sees the sprint is gone
      setSprintId(null);
      setRenamingSprint(false);
      setActionNotice(`Deleted sprint “${deletedName}”. Work items were unassigned from the sprint.`);
    } catch (err) {
      setActionNotice((err as Error).message);
      setSprintDeleteOpen(false);
    }
  };

  const renderSprintForm = (mode: 'create' | 'edit') => (
    <div className="form-stack">
      <label>
        Name
        <input
          id={mode === 'create' ? 'sprint-create-name' : 'sprint-edit-name'}
          className="input"
          value={sprintForm.name}
          onChange={(e) => setSprintForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="Sprint name"
          autoFocus
        />
      </label>
      <label>
        Goal
        <textarea
          className="input textarea"
          rows={3}
          value={sprintForm.goal}
          onChange={(e) => setSprintForm((f) => ({ ...f, goal: e.target.value }))}
          placeholder="Sprint goal (optional)"
        />
      </label>
      <label>
        Status
        <select
          className="input"
          value={sprintForm.status}
          onChange={(e) => setSprintForm((f) => ({ ...f, status: e.target.value as SprintStatus }))}
        >
          {SPRINT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      {sprintFormError ? <p className="form-error">{sprintFormError}</p> : null}
      <div className="modal-actions">
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => (mode === 'create' ? setSprintCreateOpen(false) : setSprintEditOpen(false))}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={mode === 'create' ? handleCreateSprint : handleUpdateSprint}
          disabled={mode === 'create' ? createSprint.isPending : updateSprint.isPending}
        >
          {mode === 'create' ? (createSprint.isPending ? 'Creating…' : 'Create sprint') : updateSprint.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );

  useEffect(() => {
    if (!polledQueue) return;
    setQueueResult(polledQueue);
    if (polledQueue.status !== 'running') setActiveQueueId(null);
  }, [polledQueue]);

  useEffect(() => {
    if (!polledJob || !activeJobId) return;
    const workItemId = polledJob.workItemId;

    if (polledJob.status === 'completed' && polledJob.result) {
      const result = polledJob.result;
      if (result.item && Array.isArray(result.steps)) {
        const item = result.item as WorkItem;
        setSelected(item);
        setPipelineResult({
          steps: result.steps as PipelineStepResult[],
          reviewVerdict: String(result.reviewVerdict ?? 'unknown'),
          iterations: Number(result.iterations ?? 0),
          loopStatus: (result.loopStatus as LoopStatus) ?? 'idle',
          evalResults: result.evalResults as EvalResult[] | undefined,
        });
        const review = (result.steps as PipelineStepResult[]).find((s) => s.phase === 'review');
        setLastAgentOutput({
          content: (result.steps as PipelineStepResult[])
            .map((s) => `## ${s.phase} (${s.agentType})\n${s.content}`)
            .join('\n\n'),
          agentType: review?.agentType ?? 'copilot',
          auditId: review?.auditId,
        });
      } else if (result.item && result.result) {
        const agentResult = result.result as { content: string; agentType: AgentType; auditId: string };
        setSelected(result.item as WorkItem);
        setLastAgentOutput({
          content: agentResult.content,
          agentType: agentResult.agentType,
          auditId: agentResult.auditId,
        });
      }
      if (workItemId) {
        clearPendingJob(workItemId);
        qc.invalidateQueries({ queryKey: queryKeys.workItemActivity(workItemId) });
        qc.invalidateQueries({ queryKey: queryKeys.workItemLoop(workItemId) });
        qc.invalidateQueries({ queryKey: queryKeys.workItemDeliverables(workItemId) });
      }
      qc.invalidateQueries({ queryKey: ['work-items'] });
      setActiveJobId(null);
    } else if (polledJob.status === 'failed') {
      if (workItemId) clearPendingJob(workItemId);
      setActionNotice(polledJob.error ?? 'Background job failed');
      setActiveJobId(null);
    }
  }, [polledJob, activeJobId, clearPendingJob, qc]);

  const openItem = (item: WorkItem) => {
    setSelected(item);
    setLastAgentOutput(null);
    setPipelineResult(null);
  };

  const closeDetail = () => {
    setSelected(null);
  };

  const renderItemForm = (mode: 'create' | 'edit') => (
    <div className="form-stack">
      <label>
        Title
        <input
          className="input"
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          placeholder="As a user I can..."
        />
      </label>
      <label>
        Type
        <select
          className="input"
          value={form.type}
          onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as WorkItemType }))}
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      {(mode === 'edit' || form.type === 'task') && (
        <label>
          Description / requirements
          <textarea
            className="input textarea"
            rows={5}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="Detailed requirements for the agent or team..."
          />
        </label>
      )}
      <label>
        Assign agent
        <select
          className="input"
          value={form.agent}
          onChange={(e) => setForm((f) => ({ ...f, agent: e.target.value as AgentType }))}
        >
          {AGENTS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>
      <label>
        Workspace (repo context)
        <select
          className="input"
          value={form.workspaceId}
          onChange={(e) => setForm((f) => ({ ...f, workspaceId: e.target.value }))}
        >
          <option value="">None — work dir only</option>
          {workspaces?.map((ws) => (
            <option key={ws.id} value={ws.id}>
              {ws.name}
            </option>
          ))}
        </select>
      </label>
      <div className="modal-actions">
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => (mode === 'create' ? setCreateOpen(false) : setEditItem(null))}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={mode === 'create' ? handleCreate : handleEdit}
          disabled={mode === 'create' ? createItem.isPending : updateItem.isPending}
        >
          {mode === 'create' ? 'Create' : 'Save'}
        </button>
      </div>
    </div>
  );

  return (
    <div id="page-board" className="page page--wide">
      <header className="page-header page-header--row">
        <div className="board-header-subject">
          <p className="board-header-kicker">Scrum Board</p>
          {currentSprint ? (
            renamingSprint ? (
              <input
                ref={sprintNameInputRef}
                id="sprint-name-inline"
                className="input board-sprint-title-input"
                value={sprintNameDraft}
                onChange={(e) => setSprintNameDraft(e.target.value)}
                onBlur={() => void commitSprintRename()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void commitSprintRename();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelSprintRename();
                  }
                }}
                aria-label="Rename sprint"
                disabled={updateSprint.isPending}
              />
            ) : (
              <button
                type="button"
                id="sprint-name-header"
                className="board-sprint-title-btn"
                onClick={beginSprintRename}
                title="Click to rename sprint"
              >
                <h2 className="board-sprint-title">{currentSprint.name}</h2>
                <Pencil size={16} className="board-sprint-title-edit" aria-hidden />
              </button>
            )
          ) : (
            <h2>All items</h2>
          )}
          {currentSprint ? (
            <div className="board-sprint-meta">
              <div className="board-sprint-meta-row">
                <span className={`board-sprint-status board-sprint-status--${currentSprint.status}`}>
                  {currentSprint.status}
                </span>
                {board?.totals ? (
                  <span className="board-sprint-stats">
                    {board.totals.items} items · {board.totals.points} pts
                  </span>
                ) : null}
              </div>
              {currentSprint.goal?.trim() ? (
                <div className="board-sprint-goal">
                  <span className="board-sprint-goal-label">Goal</span>
                  <p
                    className={`board-sprint-goal-text${
                      sprintGoalExpanded ? ' board-sprint-goal-text--expanded' : ''
                    }`}
                    title={currentSprint.goal.trim()}
                  >
                    {currentSprint.goal.trim()}
                  </p>
                  {currentSprint.goal.trim().length > 120 && (
                    <button
                      type="button"
                      className="board-sprint-goal-toggle"
                      onClick={() => setSprintGoalExpanded((v) => !v)}
                      aria-expanded={sprintGoalExpanded}
                    >
                      {sprintGoalExpanded ? 'Show less' : 'Show more'}
                    </button>
                  )}
                </div>
              ) : (
                <p className="board-sprint-goal-empty text-muted">
                  No sprint goal yet — edit the sprint or set one when agents plan work.
                </p>
              )}
            </div>
          ) : (
            <p className="page-subtitle">
              Jira-style stories & tasks — see what each agent is doing
              {board?.totals ? ` · ${board.totals.items} items · ${board.totals.points} pts` : ''}
            </p>
          )}
        </div>
        <div className="board-toolbar">
          <div className="board-sprint-crud" role="group" aria-label="Sprint selection and management">
            <select
              id="sprint-select"
              className="input board-toolbar-sprint"
              value={sprintId === null ? '' : (selectedSprint ?? '')}
              onChange={(e) => {
                setRenamingSprint(false);
                setSprintGoalExpanded(false);
                const value = e.target.value;
                setSprintId(value ? value : null);
              }}
            >
              <option value="">All items</option>
              {sprints?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.status})
                </option>
              ))}
            </select>
            <div className="board-action-group" role="group" aria-label="Sprint CRUD">
              <button
                id="btn-create-sprint"
                type="button"
                className="btn--board-action"
                onClick={openSprintCreate}
                title="Create a new sprint"
              >
                <Plus size={15} /> New sprint
              </button>
              <button
                id="btn-edit-sprint"
                type="button"
                className="btn--board-action"
                onClick={openSprintEdit}
                disabled={!currentSprint}
                title="Edit sprint name, goal, and status"
              >
                <Pencil size={15} /> Edit
              </button>
              <button
                id="btn-delete-sprint"
                type="button"
                className="btn--board-action btn--board-action--danger"
                onClick={() => setSprintDeleteOpen(true)}
                disabled={!currentSprint || deleteSprint.isPending}
                title="Delete this sprint"
              >
                <Trash2 size={15} /> Delete
              </button>
            </div>
          </div>
          <div className="board-action-group" role="group" aria-label="Sprint automation actions">
            <button
              type="button"
              className="btn--board-action"
              onClick={() => setStaffOpen(true)}
              disabled={!selectedSprint}
              title="Assign hired agents to sprint roles"
            >
              <Users size={15} /> Staff team
            </button>
            <button
              type="button"
              className={`btn--board-action${sprintAutomation?.automation.mode === 'autonomous' ? ' btn--board-action--active' : ''}`}
              onClick={handleToggleAutomation}
              disabled={!selectedSprint || setSprintAutomation.isPending}
              title="Autonomous shifts: auto-run stories during agent working hours"
              aria-pressed={sprintAutomation?.automation.mode === 'autonomous'}
            >
              <Clock size={15} />{' '}
              {sprintAutomation?.automation.mode === 'autonomous' ? 'Autonomous' : 'Manual'}
            </button>
            <button
              id="btn-run-sprint-queue"
              type="button"
              className="btn--board-action"
              onClick={handleRunSprintQueue}
              disabled={
                !selectedSprint ||
                runStoryQueue.isPending ||
                runPipeline.isPending ||
                runLifecycle.isPending
              }
              title="Run sprint work serially. Empty sprints auto-create an epic + seed story and start BA → PM → developer agents."
            >
              <GitBranch size={15} /> Run sprint queue
            </button>
            <button
              id="btn-multi-agent-demo"
              type="button"
              className="btn--board-action btn--board-action--demo"
              onClick={handleMultiAgentDemo}
              disabled={createDemo.isPending || runPipeline.isPending}
              title="Grok implements, Copilot reviews, loops until approved or escalated"
            >
              <GitBranch size={15} /> Multi-agent demo
            </button>
          </div>
          <button id="btn-create-story" type="button" className="btn--board-create" onClick={openCreate}>
            <Plus size={15} /> New Item
          </button>
        </div>
      </header>

      {sprintAutomation && selectedSprint && (
        <div
          className={`board-queue-banner${
            sprintAutomation.automation.pausedReason &&
            sprintAutomation.automation.pausedReason !== 'manual'
              ? ' board-queue-banner--pause'
              : ''
          }`}
        >
          <p className="board-queue-banner-line">
            Automation: <strong>{sprintAutomation.automation.mode}</strong>
            {sprintAutomation.onShiftRoles.length > 0
              ? ` · On shift: ${sprintAutomation.onShiftRoles.map((r) => r.replace(/_/g, ' ')).join(', ')}`
              : ' · Outside working hours'}
            {automationPauseLabel(sprintAutomation.automation.pausedReason)
              ? ` · ${automationPauseLabel(sprintAutomation.automation.pausedReason)}`
              : ''}
          </p>
          {automationPauseHint(sprintAutomation.automation.pausedReason) && (
            <p className="board-queue-banner-hint">
              {automationPauseHint(sprintAutomation.automation.pausedReason)}
            </p>
          )}
        </div>
      )}

      {queueResult && (
        <div
          className={`board-queue-banner board-queue-banner--queue${
            queueResult.bootstrapped ? ' board-queue-banner--bootstrap' : ''
          }`}
        >
          <p className="board-queue-banner-line">
            {queueResult.mode === 'full_lifecycle' ? (
              <>
                <strong>Full lifecycle</strong>
                {queueResult.bootstrapped ? ' · sprint was empty — epic + seed story created' : ''}
                {queueResult.step ? ` · step: ${queueResult.step}` : ''}
                {queueResult.seedStoryKey ? ` · ${queueResult.seedStoryKey}` : ''}
                {queueResult.epicKey ? ` under ${queueResult.epicKey}` : ''}
              </>
            ) : (
              <>
                Sprint queue <strong>{queueResult.status}</strong>
                {queueResult.bootstrapped ? ' · bootstrapped from empty sprint' : ''}
                {': '}
                {queueResult.totals?.approved ?? 0}/{queueResult.totals?.total ?? 0} approved
                {queueResult.durationMs ? ` · ${(queueResult.durationMs / 1000).toFixed(1)}s` : ''}
              </>
            )}
          </p>
          {queueResult.message && (
            <p className="board-queue-banner-hint">{queueResult.message}</p>
          )}
        </div>
      )}

      {(() => {
        const jobStatus = polledJob?.status;
        const jobStillActive =
          Boolean(activeJobId) &&
          (jobStatus == null || jobStatus === 'pending' || jobStatus === 'running');
        const lifecycleJobActive =
          queueResult?.mode === 'full_lifecycle' &&
          Boolean(queueResult?.jobId) &&
          activeJobId === queueResult.jobId &&
          (jobStatus == null || jobStatus === 'pending' || jobStatus === 'running');
        const jobRunning = Boolean(
          jobStillActive ||
            Object.keys(pendingJobsByWorkItem).length > 0 ||
            queueResult?.status === 'running' ||
            lifecycleJobActive
        );
        const agentsWorking =
          runningItems.length > 0 ||
          jobRunning ||
          Object.values(agentStatuses).some((s) => s === 'running');

        if (!selectedSprint || !agentsWorking) return null;

        const stepLabel =
          queueResult?.mode === 'full_lifecycle' && queueResult.step
            ? queueResult.step === 'ba'
              ? 'Business analyst'
              : queueResult.step === 'pm'
                ? 'Project manager'
                : 'Developer pipeline'
            : null;
        const focusKey =
          queueResult?.seedStoryKey ||
          runningItems[0]?.key ||
          (selected?.key ?? null);

        return (
          <div className="board-agents-working-banner" role="status" aria-live="polite">
            <span className="board-agents-working-banner-label">
              <span className="board-agents-working-pulse" aria-hidden />
              Agents working
            </span>
            <span className="board-agents-working-banner-meta">
              {[
                stepLabel,
                focusKey ? `on ${focusKey}` : null,
                queueResult?.bootstrapped ? 'sprint bootstrap' : null,
                runningItems.length > 1 ? `${runningItems.length} items in progress` : null,
              ]
                .filter(Boolean)
                .join(' · ') || 'Live run in progress — open a card or watch Live Activity'}
            </span>
            {focusKey && boardItem?.key !== focusKey && runningItems[0] && (
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                onClick={() => openItem(runningItems[0]!)}
              >
                Open {runningItems[0]!.key}
              </button>
            )}
          </div>
        );
      })()}

      {selectedSprint && (
        <div className="board-activity-row">
          <SprintTeamPanel
            team={sprintTeam}
            automation={sprintAutomation}
            runningItems={runningItems}
            agentStatuses={agentStatuses}
            displayNames={displayNames}
            onSelectItem={openItem}
            onEnableAutonomous={handleToggleAutomation}
          />
          <LiveFeed
            compact
            isWorking={
              runningItems.length > 0 ||
              (Boolean(activeJobId) &&
                (polledJob?.status == null ||
                  polledJob.status === 'pending' ||
                  polledJob.status === 'running')) ||
              queueResult?.status === 'running' ||
              Object.values(agentStatuses).some((s) => s === 'running')
            }
            workingLabel={
              queueResult?.mode === 'full_lifecycle'
                ? [
                    queueResult.bootstrapped ? 'Empty sprint bootstrap' : 'Full lifecycle',
                    queueResult.step === 'ba'
                      ? 'BA planning'
                      : queueResult.step === 'pm'
                        ? 'PM decomposition'
                        : queueResult.step === 'pipeline'
                          ? 'Dev pipeline'
                          : null,
                    queueResult.seedStoryKey,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : queueResult?.status === 'running'
                  ? `Sprint queue running · ${queueResult.totals?.completed ?? 0}/${queueResult.totals?.total ?? '?'}`
                  : runningItems[0]
                    ? `${runningItems[0].key} · ${LOOP_STATUS_LABEL[runningItems[0].loopStatus] ?? runningItems[0].status}`
                    : null
            }
          />
        </div>
      )}

      <Modal id="modal-staff-team" open={staffOpen} title="Staff sprint team" onClose={() => setStaffOpen(false)}>
        <div className="form-stack">
          {!roster?.length ? (
            <p className="text-muted">Hire agents on the Agents page first.</p>
          ) : (
            STAFF_ROLES.map((role) => (
              <label key={role}>
                {AGENT_ROLE_LABELS[role]}
                <select
                  className="input"
                  value={staffDraft[role]}
                  onChange={(e) => setStaffDraft((d) => ({ ...d, [role]: e.target.value }))}
                >
                  <option value="">— Unassigned —</option>
                  {roster.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.employment?.displayTitle ?? r.name} ({r.employment?.role})
                      {r.onShift ? ' · on shift' : ''}
                    </option>
                  ))}
                </select>
              </label>
            ))
          )}
          {staffError ? (
            <p className="form-error">{staffError}</p>
          ) : sprintTeam?.conflicts.length ? (
            <p className="text-muted" style={{ color: 'var(--color-warning)' }}>
              Conflicts: {sprintTeam.conflicts.join('; ')}
            </p>
          ) : null}
          <div className="modal-actions">
            <button type="button" className="btn btn--ghost" onClick={() => setStaffOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={handleSaveTeam}
              disabled={setSprintTeam.isPending || !roster?.length}
            >
              Save team
            </button>
          </div>
        </div>
      </Modal>

      {actionNotice && (
        <div className="board-action-notice" role="status">
          <AlertCircle size={16} />
          <span>{actionNotice}</span>
        </div>
      )}

      <div className="board-layout">
        <div className="board-layout-main">
          {isLoading ? (
            <p className="loading-text">Loading board...</p>
          ) : (
            <div className="kanban-board">
              {COLUMNS.map((col) => (
                <div key={col.id} id={`column-${col.id}`} className="kanban-column">
                  <div className="kanban-column-header">
                    <Columns3 size={14} />
                    <span>{col.label}</span>
                    <span className="kanban-count">{board?.columns[col.id]?.length ?? 0}</span>
                  </div>
                  <div className="kanban-cards">
                    {board?.columns[col.id]?.map((item) => {
                      const cardHasJob = itemHasActiveJob(item.id);
                      const cardBusy = isWorkItemBusy(item, cardHasJob);
                      const busyTitle = cardBusy ? workItemBusyMessage(item, cardHasJob) : undefined;
                      const desc = item.description?.trim() ?? '';
                      return (
                      <div
                        key={item.id}
                        id={`card-${item.key}`}
                        className={`kanban-card${selected?.id === item.id ? ' kanban-card--selected' : ''}${item.loopStatus === 'escalated' ? ' kanban-card--escalated' : ''}${item.loopStatus === 'running' ? ' kanban-card--loop-running' : ''}${cardBusy ? ' kanban-card--busy' : ''}`}
                        onClick={() => openItem(item)}
                        onKeyDown={(e) => e.key === 'Enter' && openItem(item)}
                        role="button"
                        tabIndex={0}
                        title={`${item.key}: ${displayWorkItemTitle(item.title, 160)}`}
                      >
                        <div className="kanban-card-top">
                          <div className="kanban-card-ids">
                            <span className="kanban-key">{item.key}</span>
                            <span className="kanban-type" style={{ color: TYPE_COLORS[item.type] }}>
                              {item.type}
                            </span>
                          </div>
                          <div className="kanban-card-badges">
                            {loopBadgeLabel(item) && (
                              <span
                                className={`loop-badge${item.loopStatus === 'escalated' ? ' loop-badge--escalated' : ''}${item.loopStatus === 'running' ? ' loop-badge--running' : ''}`}
                                title={LOOP_STATUS_LABEL[item.loopStatus]}
                              >
                                {loopBadgeLabel(item)}
                              </span>
                            )}
                            {(() => {
                              const chip = workItemLifecycleChip(item);
                              if (!chip) return null;
                              return (
                                <span
                                  className={`lifecycle-chip lifecycle-chip--${chip.phase}`}
                                  title={chip.label}
                                >
                                  {chip.short}
                                </span>
                              );
                            })()}
                          </div>
                        </div>
                        <h4 className="kanban-title">{displayWorkItemTitle(item.title)}</h4>
                        {desc ? <p className="kanban-desc">{desc}</p> : null}
                        {cardBusy && (
                          <p className="kanban-busy-hint">
                            <Lock size={12} /> Agents working — run and edit locked
                          </p>
                        )}
                        {item.loopStatus === 'running' && cliPreviews[item.id]?.length ? (
                          <KanbanCliPreview lines={cliPreviews[item.id]} />
                        ) : null}
                        <div className="kanban-card-meta">
                          {item.storyPoints != null && <span className="kanban-points">{item.storyPoints}pt</span>}
                          {(item.assignedAgentId || item.assignedAgentType) && (
                            <span className="kanban-agent">
                              <Bot size={12} />{' '}
                              {item.assignedAgentId
                                ? displayNames[item.assignedAgentId] ?? item.assignedAgentType
                                : item.assignedAgentType}
                            </span>
                          )}
                          {item.labels?.includes('sprint-bootstrap') && (
                            <span className="kanban-bootstrap-tag" title="Created by empty-sprint queue">
                              bootstrap
                            </span>
                          )}
                        </div>
                        <div className="kanban-card-actions" onClick={(e) => e.stopPropagation()}>
                          {item.status !== 'done' && (
                            <button
                              type="button"
                              className="btn btn--sm btn--ghost"
                              onClick={() => handleRunAgent(item)}
                              disabled={
                                cardBusy ||
                                runAgent.isPending ||
                                runPipeline.isPending ||
                                runLifecycle.isPending
                              }
                              title={busyTitle ?? 'Run single agent'}
                            >
                              <Play size={12} /> Run
                            </button>
                          )}
                          {item.status !== 'done' && (
                            <button
                              type="button"
                              className="btn btn--sm btn--ghost"
                              onClick={() => handleRunPipeline(item)}
                              disabled={
                                cardBusy ||
                                runAgent.isPending ||
                                runPipeline.isPending ||
                                runLifecycle.isPending
                              }
                              title={busyTitle ?? 'Grok → Copilot loop until approved'}
                            >
                              <GitBranch size={12} />
                            </button>
                          )}
                          {item.status !== 'done' && item.type === 'story' && (
                            <button
                              type="button"
                              className="btn btn--sm btn--ghost"
                              onClick={() => handleRunLifecycle(item)}
                              disabled={
                                cardBusy ||
                                runAgent.isPending ||
                                runPipeline.isPending ||
                                runLifecycle.isPending
                              }
                              title={
                                busyTitle ??
                                'Full lifecycle: BA → PM → developer pipeline (from current phase)'
                              }
                            >
                              <Layers size={12} />
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn--sm btn--ghost"
                            onClick={() => openEdit(item)}
                            disabled={cardBusy}
                            title={busyTitle ?? 'Edit'}
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            type="button"
                            className="btn btn--sm btn--ghost"
                            onClick={() => setDeleteTarget(item)}
                            title="Delete"
                          >
                            <Trash2 size={12} />
                          </button>
                          <select
                            className="input input--sm kanban-move-select"
                            value={item.status}
                            onChange={(e) => requestMove(item, e.target.value as WorkItemStatus)}
                            aria-label={`Move ${item.key}`}
                          >
                            {COLUMNS.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {selected && boardItem && (
          <>
            <button
              type="button"
              className="board-detail-backdrop"
              aria-label="Close work item detail"
              onClick={closeDetail}
            />
            <aside
              id="work-item-detail"
              className="card work-item-detail board-detail-pane"
              style={{ width: detailWidth }}
            >
              <div
                className="board-detail-resize-handle"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize work item detail panel"
                onPointerDown={(e) => detailResize.startDrag(e, detailWidth)}
                onPointerMove={detailResize.onDrag}
                onPointerUp={detailResize.endDrag}
                onPointerCancel={detailResize.endDrag}
              >
                <GripVertical size={14} />
              </div>
              <div className="board-detail-inner">
          <div className="work-item-detail-header">
            <div className="work-item-detail-heading">
              <span className="kanban-key">{boardItem.key}</span>
              <h3 className="work-item-detail-title" title={displayWorkItemTitle(boardItem.title, 200)}>
                {displayWorkItemTitle(boardItem.title, 140)}
              </h3>
              {isOversizedTitle(boardItem.title) && (
                <details className="work-item-title-overflow">
                  <summary>Full title document ({boardItem.title.length.toLocaleString()} chars)</summary>
                  <pre className="work-item-title-overflow-body">
                    {titleOverflowBody(boardItem.title) || boardItem.title}
                  </pre>
                </details>
              )}
              <div className="work-item-detail-status-row">
                <StatusBadge status={boardItem.status} id={`detail-status-${boardItem.id}`} />
                {(() => {
                  const chip = workItemLifecycleChip(boardItem);
                  if (!chip) return null;
                  return (
                    <span
                      className={`lifecycle-chip lifecycle-chip--detail lifecycle-chip--${chip.phase}`}
                      title={chip.label}
                    >
                      {chip.short} · {chip.label}
                    </span>
                  );
                })()}
                {boardItem.loopIteration > 0 || boardItem.loopStatus !== 'idle' ? (
                  <span
                    className={`loop-badge loop-badge--detail${boardItem.loopStatus === 'escalated' ? ' loop-badge--escalated' : ''}${boardItem.loopStatus === 'running' ? ' loop-badge--running' : ''}`}
                  >
                    Loop {boardItem.loopIteration}/{boardItem.maxLoopIterations} ·{' '}
                    {LOOP_STATUS_LABEL[boardItem.loopStatus]}
                  </span>
                ) : null}
                {boardItem.labels?.includes('sprint-bootstrap') && (
                  <span className="kanban-bootstrap-tag">sprint bootstrap</span>
                )}
              </div>
            </div>
            <div className="work-item-detail-actions">
              {(boardItem.loopStatus === 'escalated' || boardItem.loopStatus === 'failed') && (
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={() => handleRerunReview(boardItem)}
                  disabled={detailBusy.busy || rerunReview.isPending}
                  title={
                    detailBusy.busy
                      ? detailBusy.message
                      : 'Reviewer harness re-assesses deliverables; auto-chains fix loop if needed'
                  }
                >
                  <GitBranch size={14} /> Re-run review
                </button>
              )}
              {boardItem.status !== 'done' && boardItem.type === 'story' && (
                <button
                  type="button"
                  className={`btn btn--sm${
                    boardItem.loopStatus === 'escalated' || boardItem.loopStatus === 'failed'
                      ? ' btn--ghost'
                      : ' btn--primary'
                  }`}
                  onClick={() => handleRunLifecycle(boardItem)}
                  disabled={detailBusy.busy || runLifecycle.isPending || runPipeline.isPending}
                  title={
                    detailBusy.busy
                      ? detailBusy.message
                      : 'BA → PM → developer pipeline from current lifecycle phase'
                  }
                >
                  <Layers size={14} /> Full lifecycle
                </button>
              )}
              {boardItem.status !== 'done' && (
                <button
                  type="button"
                  className={`btn btn--sm${
                    boardItem.type === 'story' ||
                    boardItem.loopStatus === 'escalated' ||
                    boardItem.loopStatus === 'failed'
                      ? ' btn--ghost'
                      : ' btn--primary'
                  }`}
                  onClick={() => handleRunPipeline(boardItem)}
                  disabled={detailBusy.busy || runPipeline.isPending || runLifecycle.isPending}
                  title={detailBusy.busy ? detailBusy.message : 'Run Grok → Copilot pipeline only'}
                >
                  <GitBranch size={14} /> Grok → Copilot
                </button>
              )}
              {boardItem.loopStatus === 'running' && (
                <button
                  id="btn-cancel-loop"
                  type="button"
                  className="btn btn--ghost btn--sm btn--danger"
                  onClick={() => cancelLoop.mutate(boardItem.id)}
                  disabled={cancelLoop.isPending}
                  title="Cancel running loop and kill CLI processes"
                >
                  <Square size={14} /> Cancel loop
                </button>
              )}
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => openEdit(boardItem)}
                disabled={detailBusy.busy}
                title={detailBusy.busy ? detailBusy.message : 'Edit work item'}
              >
                <Pencil size={14} /> Edit
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setMoveTarget({ item: boardItem, toStatus: boardItem.status })}
              >
                <ArrowRightLeft size={14} /> Move
              </button>
              <button type="button" className="btn btn--ghost btn--sm btn--danger" onClick={() => setDeleteTarget(boardItem)}>
                <Trash2 size={14} /> Delete
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                title="Narrow panel"
                onClick={() => setDetailWidthPersisted(380)}
              >
                <PanelRightClose size={14} />
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                title="Wide panel"
                onClick={() => setDetailWidthPersisted(640)}
              >
                <PanelRightOpen size={14} />
              </button>
              <button type="button" className="btn btn--ghost" onClick={closeDetail}>
                Close
              </button>
            </div>
          </div>

          {activeJobId && polledJob && (
            <p className="board-job-banner">
              Background job {polledJob.status}
              {polledJob.error ? ` — ${polledJob.error}` : ''}
            </p>
          )}

          {detailBusy.busy && (
            <div className="work-item-busy-banner" role="status">
              <Lock size={16} />
              <div>
                <strong>Item locked while agents are working</strong>
                <p>{detailBusy.message}</p>
              </div>
            </div>
          )}

          <AgentConsole
            workItemKey={boardItem.key}
            entries={agentConsole.entries}
            status={agentConsole.status}
            sessionKey={agentConsole.sessionKey}
            height={consoleHeight}
            onResizeHeight={setConsoleHeight}
            onCommitHeight={persistConsoleHeight}
            idleHint={agentConsole.idleHint}
            onClear={agentConsole.clearConsole}
          />

          <div className="board-detail-body">
          <WorkItemAgentHistory
            workItem={boardItem}
            activity={activity}
            loopHistory={loopHistory}
            isBusy={detailBusy.busy}
            agentNames={displayNames}
          />

          {boardItem.status !== 'done' &&
            (boardItem.loopStatus === 'escalated' ||
              boardItem.loopStatus === 'failed' ||
              (deliverables?.files.length ?? 0) > 0) && (
              <div className="deliverables-banner">
                {boardItem.loopStatus === 'escalated' || boardItem.loopStatus === 'failed' ? (
                  <p>
                    <strong>Loop exhausted — harness escalated for review.</strong> The staffed reviewer
                    will auto re-assess when on shift (Autonomous mode). Use <strong>Re-run review</strong>{' '}
                    for an immediate harness pass, or move to Done if you accept the deliverables.
                  </p>
                ) : (
                  <p>
                    <strong>Agent output is ready.</strong> Files are saved under the work directory below
                    (not applied to <code>src/</code> automatically).
                  </p>
                )}
              </div>
            )}

          {deliverables && deliverables.files.length > 0 && (
            <div className="deliverables-panel card">
              <h4>Deliverables ({deliverables.files.length})</h4>
              {deliverables.outputDir && (
                <p className="text-muted deliverables-dir">
                  <code>{deliverables.outputDir}</code>
                </p>
              )}
              <ul className="deliverables-list">
                {deliverables.files.map((f) => (
                  <li key={f.path}>
                    <strong>{f.name}</strong>
                    <span className="text-muted">
                      {' '}
                      · {(f.size / 1024).toFixed(1)} KB · {new Date(f.modifiedAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {boardItem.description?.trim() ? (
            <details className="work-item-desc-block" open={boardItem.description.trim().length < 280}>
              <summary className="work-item-desc-summary">
                Description
                <span className="work-item-desc-preview">
                  {boardItem.description.trim().replace(/\s+/g, ' ').slice(0, 120)}
                  {boardItem.description.trim().length > 120 ? '…' : ''}
                </span>
              </summary>
              <div className="work-item-desc">{boardItem.description.trim()}</div>
            </details>
          ) : null}
          <div className="work-item-detail-meta">
            <span>Type: {boardItem.type}</span>
            <span>Priority: {boardItem.priority}</span>
            <span>Column: {COLUMN_LABEL[boardItem.status]}</span>
            {boardItem.assignedAgentType && <span>Agent: {boardItem.assignedAgentType}</span>}
            {boardItem.workspaceId && (
              <span>
                Workspace: {workspaces?.find((w) => w.id === boardItem.workspaceId)?.name ?? boardItem.workspaceId}
                {focusedProjectPath ? ` · ${focusedProjectPath}` : ''}
              </span>
            )}
          </div>
          {boardItem.acceptanceCriteria.length > 0 && (
            <div className="work-item-criteria">
              <h4>Acceptance criteria</h4>
              <ul>
                {boardItem.acceptanceCriteria.map((c, index) => (
                  <li key={`${index}-${c}`}>{c}</li>
                ))}
              </ul>
            </div>
          )}

          {pipelineResult && (
            <div className="pipeline-result-panel">
              <h4>
                <GitBranch size={16} /> Multi-agent pipeline
              </h4>
              <p className="pipeline-verdict">
                Review verdict: <strong>{pipelineResult.reviewVerdict}</strong>
                {' · '}
                {pipelineResult.iterations} iteration(s) · {LOOP_STATUS_LABEL[pipelineResult.loopStatus]}
              </p>
              {pipelineResult.evalResults && pipelineResult.evalResults.length > 0 && (
                <ul className="eval-checklist">
                  {pipelineResult.evalResults.map((e) => (
                    <li key={e.evalId} className={e.passed ? 'eval-pass' : 'eval-fail'}>
                      {e.passed ? '✓' : '✗'} {e.evalId}: {e.details}
                    </li>
                  ))}
                </ul>
              )}
              {pipelineResult.steps.map((step, index) => (
                <div
                  key={step.auditId ?? `${step.loopIteration}-${step.phase}-${index}`}
                  className="pipeline-step-block"
                >
                  <div className="pipeline-step-header">
                    <span className="pipeline-iteration">iter {step.loopIteration}</span>
                    <span className="pipeline-phase">{step.phase}</span>
                    <span className="kanban-agent">
                      <Bot size={12} /> {step.agentType}
                    </span>
                    {step.filesCreated.length > 0 && (
                      <span className="pipeline-files">Files: {step.filesCreated.join(', ')}</span>
                    )}
                  </div>
                  <pre className="activity-output-preview">{step.content}</pre>
                </div>
              ))}
            </div>
          )}

          {latestAgentResult && !pipelineResult ? (
            <div className="agent-output-panel">
              <div className="agent-output-header">
                <h4>
                  <FileText size={16} /> Agent output
                </h4>
                <span className="kanban-agent">
                  <Bot size={12} /> {latestAgentResult.agentType}
                </span>
              </div>
              <pre className="agent-output-content">{latestAgentResult.content}</pre>
              {latestAgentResult.workDir && (
                <p className="agent-output-hint">
                  Work directory: <code>{latestAgentResult.workDir}</code>
                </p>
              )}
              {Array.isArray(latestCompleted?.metadata?.filesCreated) &&
                (latestCompleted.metadata.filesCreated as string[]).length > 0 && (
                  <p className="agent-output-hint agent-output-success">
                    Files created: {(latestCompleted.metadata.filesCreated as string[]).join(', ')}
                  </p>
                )}
              {typeof latestCompleted?.metadata?.fileWarning === 'string' && (
                <p className="agent-output-warning">{latestCompleted.metadata.fileWarning}</p>
              )}
              {latestAgentResult.auditId && (
                <p className="agent-output-hint">
                  Full trace: <a href={`/audit#${latestAgentResult.auditId}`}>Audit entry</a>
                </p>
              )}
            </div>
          ) : !pipelineResult ? (
            <p className="text-muted agent-output-empty">
              No agent output yet. Use Run (single agent) or the pipeline button (Grok → Copilot).
            </p>
          ) : null}

          <details className="agent-history-raw-details">
            <summary>Raw activity log</summary>
            <div className="activity-feed">
              {activity?.length === 0 && <p className="text-muted">No activity yet.</p>}
              {activityByIteration.map(({ iteration, entries }) => (
                <div
                  key={entries[0]?.id ?? `iteration-${iteration}`}
                  className="activity-iteration-group"
                >
                  {iteration > 0 && (
                    <div className="activity-iteration-header">Iteration {iteration}</div>
                  )}
                  {entries.map((a) => {
                    const output = activityContent(a);
                    const error =
                      typeof a.metadata?.error === 'string' ? a.metadata.error : undefined;
                    const workDir = activityWorkDir(a);
                    return (
                      <div key={a.id} className="activity-row activity-row--stacked">
                        <div className="activity-row-main">
                          <span className="activity-type">{a.activityType}</span>
                          <span>
                            {typeof a.metadata?.pipelinePhase === 'string' && (
                              <span className="pipeline-phase">
                                {a.metadata.pipelinePhase} ·{' '}
                              </span>
                            )}
                            {a.summary}
                          </span>
                          {a.agentType && <span className="kanban-agent">{a.agentType}</span>}
                          <time>{new Date(a.createdAt).toLocaleString()}</time>
                        </div>
                        {output && <pre className="activity-output-preview">{output}</pre>}
                        {error && <p className="activity-error">{error}</p>}
                        {activityEvalResults(a)?.map((e) => (
                          <div
                            key={e.evalId}
                            className={`eval-row ${e.passed ? 'eval-pass' : 'eval-fail'}`}
                          >
                            {e.passed ? '✓' : '✗'} <strong>{e.evalId}</strong> ({e.type}):{' '}
                            {e.details}
                          </div>
                        ))}
                        {workDir && a.activityType === 'agent_completed' && (
                          <p className="activity-output-hint">
                            Work directory: <code>{workDir}</code>
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </details>
          </div>
              </div>
            </aside>
          </>
        )}
      </div>

      <Modal id="modal-create-work-item" open={createOpen} onClose={() => setCreateOpen(false)} title="Create work item">
        {renderItemForm('create')}
      </Modal>

      <Modal
        id="modal-create-sprint"
        open={sprintCreateOpen}
        onClose={() => setSprintCreateOpen(false)}
        title="Create sprint"
      >
        {renderSprintForm('create')}
      </Modal>

      <Modal
        id="modal-edit-sprint"
        open={sprintEditOpen}
        onClose={() => setSprintEditOpen(false)}
        title={currentSprint ? `Edit sprint · ${currentSprint.name}` : 'Edit sprint'}
      >
        {currentSprint && renderSprintForm('edit')}
      </Modal>

      <Modal
        id="modal-delete-sprint"
        open={sprintDeleteOpen}
        onClose={() => setSprintDeleteOpen(false)}
        title="Delete sprint"
      >
        {currentSprint && (
          <div className="form-stack">
            <p>
              Delete sprint <strong>{currentSprint.name}</strong>? Work items stay on the board but are unassigned
              from this sprint. This cannot be undone.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn btn--ghost" onClick={() => setSprintDeleteOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => void handleDeleteSprint()}
                disabled={deleteSprint.isPending}
              >
                {deleteSprint.isPending ? 'Deleting…' : 'Delete sprint'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        id="modal-edit-work-item"
        open={!!editItem}
        onClose={() => setEditItem(null)}
        title={editItem ? `Edit ${editItem.key}` : 'Edit work item'}
      >
        {editItem && renderItemForm('edit')}
      </Modal>

      <Modal
        id="modal-delete-work-item"
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete work item"
      >
        {deleteTarget && (
          <div className="form-stack">
            <p>
              Delete <strong>{deleteTarget.key}</strong> — {deleteTarget.title}? This cannot be undone.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn btn--ghost" onClick={() => setDeleteTarget(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={handleDelete}
                disabled={deleteItem.isPending}
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        id="modal-move-work-item"
        open={!!moveTarget}
        onClose={() => setMoveTarget(null)}
        title="Move work item"
      >
        {moveTarget && (
          <div className="form-stack">
            <p>
              Move <strong>{moveTarget.item.key}</strong> from{' '}
              <strong>{COLUMN_LABEL[moveTarget.item.status]}</strong> to:
            </p>
            <label>
              Destination column
              <select
                className="input"
                value={moveTarget.toStatus}
                onChange={(e) =>
                  setMoveTarget((m) => (m ? { ...m, toStatus: e.target.value as WorkItemStatus } : m))
                }
              >
                {COLUMNS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            {moveTarget.item.status === moveTarget.toStatus ? (
              <p className="text-muted">Select a different column to move this item.</p>
            ) : (
              <p className="move-confirm-text">
                Confirm moving to <strong>{COLUMN_LABEL[moveTarget.toStatus]}</strong>?
              </p>
            )}
            <div className="modal-actions">
              <button type="button" className="btn btn--ghost" onClick={() => setMoveTarget(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={confirmMove}
                disabled={moveTarget.item.status === moveTarget.toStatus || updateItem.isPending}
              >
                Confirm move
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}