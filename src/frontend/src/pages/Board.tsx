import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Columns3,
  Plus,
  FileText,
  Pencil,
  Trash2,
  GitBranch,
  Users,
  Clock,
  AlertCircle,
  Search,
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
  useWorkItemLiveJob,
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
  useAdapterCatalog,
  type PipelineStepResult,
  queryKeys,
} from '../api/hooks';
import type {
  WorkItem,
  WorkItemStatus,
  WorkItemType,
  AgentType,
  LoopStatus,
  EvalResult,
  AgentRole,
  Sprint,
  SprintStatus,
} from '../types';
import SprintTeamPanel from '../components/SprintTeamPanel';
import LiveFeed from '../components/LiveFeed';
import BoardEmptyState from '../components/BoardEmptyState';
import { useWorkItemAgentConsole } from '../hooks/useWorkItemAgentConsole';

import { useCliPreviewStore } from '../stores/useCliPreviewStore';
import { useAppStore } from '../stores/useAppStore';
import { useSearchParams } from 'react-router';
import { STAFF_ROLES, emptyStaffDraft } from '../constants/agent-roles';
import {
  automationPauseHint,
  automationPauseLabel,
} from '../constants/sprint-automation';
import { isWorkItemBusy, workItemBusyMessage } from '../utils/work-item-busy';
import { deriveWorkItemNow, useTickingNow } from '../utils/derive-work-item-now';
import { getWorkItemLifecyclePhase } from '../utils/work-item-agent-history';
import {
  AGENTS,
  COLUMNS,
  CONSOLE_HEIGHT_KEY,
  DEFAULT_CONSOLE_HEIGHT,
  DETAIL_EXPANDED_KEY,
  SPRINT_STATUSES,
  TYPES,
  LOOP_STATUS_LABEL,
  activityContent,
  activityWorkDir,
  emptyForm,
  emptySprintForm,
  readStoredBoolean,
  readStoredNumber,
  readStoredSprintSelection,
  storeBoolean,
  storeNumber,
  storeSprintSelection,
  type ItemFormState,
  type SprintFormState,
} from './board/constants';
import { buildBoardSearchParams, parseBoardSearchParams } from './board/board-url';
import { filterWorkItems } from './board/board-filter';
import BoardModals from './board/BoardModals';
import WorkItemCard from './board/WorkItemCard';
import WorkItemDetail, { type PipelineResultState } from './board/WorkItemDetail';

export default function Board() {
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const boardUrl = parseBoardSearchParams(searchParams);
  const pendingJobsByWorkItem = useAppStore((s) => s.pendingJobsByWorkItem);
  const setPendingJob = useAppStore((s) => s.setPendingJob);
  const clearPendingJob = useAppStore((s) => s.clearPendingJob);
  const { data: sprints } = useSprints();
  const activeSprint = sprints?.find((s) => s.status === 'active') ?? sprints?.[0];
  /** `undefined` = auto-select active sprint; `null` = All items; string = explicit sprint id */
  const [sprintId, setSprintIdState] = useState<string | null | undefined>(() =>
    boardUrl.sprintId !== undefined ? boardUrl.sprintId : readStoredSprintSelection()
  );
  const setSprintId = useCallback(
    (value: string | null | undefined) => {
      setSprintIdState(value);
      storeSprintSelection(value);
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);
        if (value === undefined) params.delete('sprint');
        else if (value === null) params.set('sprint', 'all');
        else params.set('sprint', value);
        return params;
      }, { replace: true });
    },
    [setSearchParams]
  );
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
  const { data: selectedLiveJob } = useWorkItemLiveJob(selected?.id ?? null);
  const hasAutoOpenedRef = useRef(false);
  const userDismissedDetailRef = useRef(false);
  const [pipelineResult, setPipelineResult] = useState<PipelineResultState | null>(null);
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
  const [boardQuery, setBoardQuery] = useState('');
  const [dropStatus, setDropStatus] = useState<WorkItemStatus | null>(null);
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
  const [detailExpanded, setDetailExpanded] = useState(() => readStoredBoolean(DETAIL_EXPANDED_KEY, false));
  const [consoleHeight, setConsoleHeight] = useState(() =>
    readStoredNumber(CONSOLE_HEIGHT_KEY, DEFAULT_CONSOLE_HEIGHT)
  );

  const persistConsoleHeight = useCallback((height: number) => storeNumber(CONSOLE_HEIGHT_KEY, height), []);
  const toggleDetailExpanded = useCallback(() => {
    setDetailExpanded((current) => {
      const next = !current;
      storeBoolean(DETAIL_EXPANDED_KEY, next);
      return next;
    });
  }, []);

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
    const itemId = boardUrl.itemId;
    if (!itemId) {
      setSelected((current) => (current ? null : current));
      return;
    }
    if (!board) return;
    userDismissedDetailRef.current = false;
    for (const col of COLUMNS) {
      const found = board.columns[col.id]?.find((i) => i.id === itemId);
      if (found) {
        setSelected((current) => (current?.id === found.id ? current : found));
        return;
      }
    }
  }, [board, boardUrl.itemId]);

  useEffect(() => {
    if (boardUrl.sprintId === undefined || boardUrl.sprintId === sprintId) return;
    setSprintIdState(boardUrl.sprintId);
    storeSprintSelection(boardUrl.sprintId);
  }, [boardUrl.sprintId, sprintId]);

  useEffect(() => {
    if (!board || selected || hasAutoOpenedRef.current || boardUrl.itemId) return;
    if (userDismissedDetailRef.current) return;
    const primary =
      runningItems.find((i) => i.loopStatus === 'running') ?? runningItems[0];
    if (primary) {
      hasAutoOpenedRef.current = true;
      setSelected(primary);
      setLastAgentOutput(null);
      setPipelineResult(null);
      setSearchParams((prev) => buildBoardSearchParams(prev, { item: primary.id }), { replace: true });
    }
  }, [board, selected, runningItems, boardUrl.itemId, setSearchParams]);

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

  const tickNow = useTickingNow(
    Boolean(selected) || runningItems.length > 0 || Object.keys(pendingJobsByWorkItem).length > 0
  );

  const selectedNow = useMemo(() => {
    if (!boardItem) {
      return deriveWorkItemNow({
        item: { key: '', status: 'todo', loopStatus: 'idle', assignedAgentType: undefined },
      });
    }
    const job =
      selectedLiveJob ??
      (activeJobId && polledJob && (polledJob.workItemId === boardItem.id || !polledJob.workItemId)
        ? polledJob
        : null);
    return deriveWorkItemNow({
      item: boardItem,
      job,
      hasCliOutput: agentConsole.entries.some((e) => e.stream === 'stdout' || e.stream === 'stderr'),
      nowMs: tickNow,
    });
  }, [boardItem, selectedLiveJob, activeJobId, polledJob, agentConsole.entries, tickNow]);

  const focusedProjectPath = useMemo(() => {
    if (!boardItem?.workspaceId || !selectedWorkspaceRepos?.length) return null;
    const ws = workspaces?.find((w) => w.id === boardItem.workspaceId);
    const primaryId =
      typeof ws?.config?.primaryRepoId === 'string' ? ws.config.primaryRepoId : selectedWorkspaceRepos[0]?.id;
    return selectedWorkspaceRepos.find((r) => r.id === primaryId)?.path ?? selectedWorkspaceRepos[0]?.path;
  }, [boardItem?.workspaceId, selectedWorkspaceRepos, workspaces]);

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
    setEditItem(null);
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
    setCreateOpen(false);
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

  const applyMove = async (item: WorkItem, toStatus: WorkItemStatus) => {
    if (item.status === toStatus) return;
    const updated = await updateItem.mutateAsync({ id: item.id, status: toStatus });
    if (selected?.id === item.id) setSelected(updated);
  };

  const { data: adapterCatalog } = useAdapterCatalog();
  const agentOptions = adapterCatalog?.types?.length ? adapterCatalog.types : AGENTS;

  const parseDropItemId = (raw: string): string | null => {
    if (raw.startsWith('crewtopus-item:')) return raw.slice('crewtopus-item:'.length);
    return raw.trim() || null;
  };

  const handleColumnDrop = (toStatus: WorkItemStatus, event: DragEvent) => {
    event.preventDefault();
    setDropStatus(null);
    const id = parseDropItemId(event.dataTransfer.getData('text/plain'));
    if (!id || !board) return;
    for (const col of COLUMNS) {
      const found = board.columns[col.id]?.find((row) => row.id === id);
      if (found) {
        void applyMove(found, toStatus);
        return;
      }
    }
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

  const handleRunPipeline = async (item: WorkItem, runAsync = true, demo = false) => {
    const hasJob = itemHasActiveJob(item.id);
    if (isWorkItemBusy(item, hasJob)) {
      notifyBusy(item, hasJob);
      return;
    }
    try {
      const result = await runPipeline.mutateAsync({ id: item.id, async: runAsync, demo });
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
    // Always mock pipeline so first-time users succeed without paid CLIs.
    const { item } = await createDemo.mutateAsync(selectedSprint);
    setActionNotice('Running multi-agent demo with mock adapters (no paid CLIs)…');
    await handleRunPipeline(item, true, true);
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
          setSearchParams((prev) => buildBoardSearchParams(prev, { item: focusId }), { replace: false });
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
        setSearchParams((prev) => buildBoardSearchParams(prev, { item: focusId }), { replace: false });
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
    userDismissedDetailRef.current = false;
    setSelected(item);
    setLastAgentOutput(null);
    setPipelineResult(null);
    setSearchParams((prev) => buildBoardSearchParams(prev, { item: item.id }), { replace: false });
  };

  const closeDetail = useCallback(() => {
    userDismissedDetailRef.current = true;
    setSelected(null);
    setSearchParams((prev) => buildBoardSearchParams(prev, { item: null }), { replace: true });
  }, [setSearchParams]);

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
          {agentOptions.map((a) => (
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
            <label className="board-search">
              <Search size={14} aria-hidden />
              <input
                id="board-search"
                className="input board-search-input"
                type="search"
                value={boardQuery}
                onChange={(e) => setBoardQuery(e.target.value)}
                placeholder="Search cards…"
                aria-label="Search work items"
              />
            </label>
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
              className="btn--board-action"
              disabled={!selectedSprint}
              title="Download sprint success report (markdown)"
              onClick={async () => {
                if (!selectedSprint) return;
                try {
                  const res = await fetch(`/api/work-items/sprints/${selectedSprint}/report`);
                  if (!res.ok) throw new Error('Report failed');
                  const data = (await res.json()) as { markdown?: string; sprint?: { name?: string } };
                  const blob = new Blob([data.markdown ?? JSON.stringify(data, null, 2)], {
                    type: 'text/markdown',
                  });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${(data.sprint?.name || 'sprint').replace(/\s+/g, '-')}-report.md`;
                  a.click();
                  URL.revokeObjectURL(url);
                  setActionNotice('Sprint report downloaded');
                } catch (err) {
                  setActionNotice(err instanceof Error ? err.message : 'Report failed');
                }
              }}
            >
              <FileText size={15} /> Report
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
              title="Mock implement → test → review (no paid CLIs). Use Full lifecycle for real adapters."
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
              {(selectedNow.visible && boardItem ? selectedNow.bannerLine : null) ||
                [
                  stepLabel,
                  focusKey ? `on ${focusKey}` : null,
                  queueResult?.bootstrapped ? 'sprint bootstrap' : null,
                  runningItems.length > 1 ? `${runningItems.length} items in progress` : null,
                ]
                  .filter(Boolean)
                  .join(' · ') ||
                'Live run in progress — open a card or watch Live Activity'}
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
              selectedNow.visible
                ? selectedNow.bannerLine
                : queueResult?.mode === 'full_lifecycle'
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
          ) : (board?.totals?.items ?? 0) === 0 ? (
            <BoardEmptyState
              hasSprint={Boolean(selectedSprint)}
              onMultiAgentDemo={() => void handleMultiAgentDemo()}
              onStaffTeam={() => setStaffOpen(true)}
              demoPending={createDemo.isPending || runPipeline.isPending}
            />
          ) : (
            <div className="kanban-board">
              {COLUMNS.map((col) => {
                const columnItems = filterWorkItems(board?.columns[col.id], boardQuery);
                return (
                <div
                  key={col.id}
                  id={`column-${col.id}`}
                  className={`kanban-column${dropStatus === col.id ? ' kanban-column--drop-target' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    setDropStatus(col.id);
                  }}
                  onDragLeave={(e) => {
                    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                    setDropStatus((current) => (current === col.id ? null : current));
                  }}
                  onDrop={(e) => handleColumnDrop(col.id, e)}
                >
                  <div className="kanban-column-header">
                    <Columns3 size={14} />
                    <span>{col.label}</span>
                    <span className="kanban-count">{columnItems.length}</span>
                  </div>
                  <div className="kanban-cards">
                    {columnItems.map((item) => (
                      <WorkItemCard
                        key={item.id}
                        item={item}
                        selected={selected?.id === item.id}
                        cardHasJob={itemHasActiveJob(item.id)}
                        displayNames={displayNames}
                        cliPreview={cliPreviews[item.id]}
                        runPending={runAgent.isPending || runPipeline.isPending || runLifecycle.isPending}
                        onOpen={openItem}
                        onRunAgent={(next) => void handleRunAgent(next)}
                        onRunPipeline={(next) => void handleRunPipeline(next)}
                        onRunLifecycle={(next) => void handleRunLifecycle(next)}
                        onEdit={openEdit}
                        onDelete={setDeleteTarget}
                        onMove={(next, status) => void applyMove(next, status)}
                        nowLine={
                          selected?.id === item.id && selectedNow.visible
                            ? selectedNow.cardLine
                            : deriveWorkItemNow({
                                item,
                                job: itemHasActiveJob(item.id)
                                  ? {
                                      id: pendingJobsByWorkItem[item.id] ?? 'queued',
                                      status:
                                        item.loopStatus === 'awaiting_approval'
                                          ? 'awaiting_approval'
                                          : 'pending',
                                      jobType:
                                        getWorkItemLifecyclePhase(item) === 'ba_pending'
                                          ? 'story_ba'
                                          : getWorkItemLifecyclePhase(item) === 'pm_pending'
                                            ? 'story_pm'
                                            : 'work_item_pipeline',
                                      createdAt: item.updatedAt,
                                    }
                                  : item.loopStatus === 'awaiting_approval' ||
                                      item.loopStatus === 'failed'
                                    ? { id: item.id, status: item.loopStatus, jobType: 'story_ba' }
                                    : null,
                                nowMs: tickNow,
                              }).cardLine
                        }
                      />
                    ))}
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>

        {selected && boardItem && (
          <WorkItemDetail
            boardItem={boardItem}
            expanded={detailExpanded}
            onToggleExpanded={toggleDetailExpanded}
            onClose={closeDetail}
            detailBusy={detailBusy}
            onRerunReview={(next) => void handleRerunReview(next)}
            onRunLifecycle={(next) => void handleRunLifecycle(next)}
            onRunPipeline={(next) => void handleRunPipeline(next)}
            onCancelLoop={(id) => cancelLoop.mutate(id)}
            onEdit={openEdit}
            onMove={(next, status) => void applyMove(next, status)}
            onDelete={setDeleteTarget}
            rerunPending={rerunReview.isPending}
            lifecyclePending={runLifecycle.isPending}
            pipelinePending={runPipeline.isPending}
            cancelPending={cancelLoop.isPending}
            activeJobId={activeJobId}
            jobBanner={
              activeJobId && polledJob
                ? `Background job ${polledJob.status}${polledJob.error ? ` — ${polledJob.error}` : ''}`
                : null
            }
            agentConsole={agentConsole}
            consoleHeight={consoleHeight}
            onConsoleHeight={setConsoleHeight}
            onCommitConsoleHeight={persistConsoleHeight}
            activity={activity}
            loopHistory={loopHistory}
            displayNames={displayNames}
            deliverables={deliverables}
            workspaces={workspaces}
            focusedProjectPath={focusedProjectPath}
            pipelineResult={pipelineResult}
            latestAgentResult={latestAgentResult}
            latestCompleted={latestCompleted}
            now={selectedNow}
            onRetry={(next) =>
              next.type === 'story' ? void handleRunLifecycle(next) : void handleRunPipeline(next)
            }
          />
        )}
      </div>

      <BoardModals
        staffOpen={staffOpen}
        onCloseStaff={() => setStaffOpen(false)}
        roster={roster}
        staffDraft={staffDraft}
        onStaffDraftChange={(role, agentId) => setStaffDraft((d) => ({ ...d, [role]: agentId }))}
        staffError={staffError}
        sprintTeam={sprintTeam}
        onSaveTeam={() => void handleSaveTeam()}
        saveTeamPending={setSprintTeam.isPending}
        createOpen={createOpen}
        onCloseCreate={() => setCreateOpen(false)}
        editItem={editItem}
        onCloseEdit={() => setEditItem(null)}
        itemForm={renderItemForm(editItem ? 'edit' : 'create')}
        deleteTarget={deleteTarget}
        onCloseDelete={() => setDeleteTarget(null)}
        onConfirmDelete={() => void handleDelete()}
        deletePending={deleteItem.isPending}
        sprintCreateOpen={sprintCreateOpen}
        onCloseSprintCreate={() => setSprintCreateOpen(false)}
        sprintEditOpen={sprintEditOpen}
        onCloseSprintEdit={() => setSprintEditOpen(false)}
        currentSprint={currentSprint}
        sprintForm={renderSprintForm(sprintEditOpen ? 'edit' : 'create')}
        sprintDeleteOpen={sprintDeleteOpen}
        onCloseSprintDelete={() => setSprintDeleteOpen(false)}
        onConfirmSprintDelete={() => void handleDeleteSprint()}
        sprintDeletePending={deleteSprint.isPending}
      />
    </div>
  );
}

