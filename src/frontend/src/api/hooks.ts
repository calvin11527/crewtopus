import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { api } from './client';
import { buildLogEventsQuery, LOG_PAGE_SIZE } from '../utils/log-events';
import type {
  Workspace,
  Repository,
  Agent,
  Workflow,
  WorkflowExecution,
  WorkflowDefinition,
  AuditEntry,
  AuditStats,
  LogEventListResponse,
  LogEventQuery,
  ApprovalRequest,
  PrivacyPolicy,
  SupervisorStatus,
  Capability,
  HealthResponse,
  SystemStatus,
  WorkBoard,
  WorkItem,
  WorkItemActivity,
  WorkItemStatus,
  WorkItemType,
  WorkItemPriority,
  WorkItemLoopHistory,
  WorkItemDeliverables,
  LoopStatus,
  EvalResult,
  Sprint,
  AgentType,
  AgentRole,
  AgentSkillDefinition,
  AgentCreditUsage,
  AgentModelCatalog,
  AgentModelOption,
  RosterAgent,
  SprintTeamView,
  SprintAutomationStatus,
  SprintAutomationMode,
  WorkingHoursBlock,
  FsBrowseResult,
  FsValidateResult,
} from '../types';

export const queryKeys = {
  health: ['health'] as const,
  status: ['status'] as const,
  workspaces: ['workspaces'] as const,
  workspace: (id: string) => ['workspaces', id] as const,
  repos: (wsId: string) => ['workspaces', wsId, 'repos'] as const,
  agents: ['agents'] as const,
  agentCredits: ['agents', 'credits'] as const,
  capabilities: ['capabilities'] as const,
  workflows: ['workflows'] as const,
  executions: (wfId: string) => ['workflows', wfId, 'executions'] as const,
  audit: ['audit'] as const,
  auditStats: ['audit', 'stats'] as const,
  logs: (filters: LogEventQuery) => ['logs', filters] as const,
  approvals: ['approvals'] as const,
  policies: ['policies'] as const,
  supervisor: ['supervisor', 'status'] as const,
  board: (sprintId?: string) => ['work-items', 'board', sprintId ?? 'all'] as const,
  sprints: ['work-items', 'sprints'] as const,
  workItemActivity: (id: string) => ['work-items', id, 'activity'] as const,
  workItemLoop: (id: string) => ['work-items', id, 'loop'] as const,
  workItemDeliverables: (id: string) => ['work-items', id, 'deliverables'] as const,
  fsBrowse: (path?: string) => ['fs', 'browse', path ?? 'home'] as const,
};

export function useHealth() {
  return useQuery<HealthResponse>({ queryKey: queryKeys.health, queryFn: () => api.get<HealthResponse>('/health'), refetchInterval: 30_000 });
}

export function useSystemStatus() {
  return useQuery<SystemStatus>({ queryKey: queryKeys.status, queryFn: () => api.get<SystemStatus>('/status'), refetchInterval: 10_000 });
}

export function useWorkspaces() {
  return useQuery<Workspace[]>({ queryKey: queryKeys.workspaces, queryFn: () => api.get('/workspaces') });
}

export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; description?: string }) => api.post<Workspace>('/workspaces', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.workspaces }),
  });
}

export function useDeleteWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/workspaces/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.workspaces }),
  });
}

export function useRepositories(workspaceId: string) {
  return useQuery<Repository[]>({
    queryKey: queryKeys.repos(workspaceId),
    queryFn: () => api.get(`/workspaces/${workspaceId}/repositories`),
    enabled: !!workspaceId,
  });
}

export function useAddRepository(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name?: string; path: string; remoteUrl?: string; setPrimary?: boolean }) =>
      api.post<Repository>(`/workspaces/${workspaceId}/repositories`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.repos(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.workspaces });
    },
  });
}

export function useSetPrimaryRepository(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) =>
      api.patch<Workspace>(`/workspaces/${workspaceId}/primary-repository`, { repoId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.repos(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.workspaces });
    },
  });
}

export function useRemoveRepository(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) =>
      api.delete(`/workspaces/${workspaceId}/repositories/${repoId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.repos(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.workspaces });
    },
  });
}

export function useBrowseFolder(path?: string, enabled = true) {
  return useQuery<FsBrowseResult>({
    queryKey: queryKeys.fsBrowse(path),
    queryFn: () => {
      const query = path ? `?path=${encodeURIComponent(path)}` : '';
      return api.get<FsBrowseResult>(`/fs/browse${query}`);
    },
    enabled,
    staleTime: 0,
  });
}

export function useValidateFolderPath() {
  return useMutation({
    mutationFn: (folderPath: string) =>
      api.get<FsValidateResult>(`/fs/validate?path=${encodeURIComponent(folderPath)}`),
  });
}

export function useAgents() {
  return useQuery<Agent[]>({ queryKey: queryKeys.agents, queryFn: () => api.get('/agents'), refetchInterval: 15_000 });
}

export function useAgentCredits() {
  return useQuery<AgentCreditUsage[]>({
    queryKey: queryKeys.agentCredits,
    queryFn: () => api.get('/agents/credits'),
    refetchInterval: 15_000,
  });
}

export function useAgentRoster() {
  return useQuery<RosterAgent[]>({
    queryKey: ['agents', 'roster'],
    queryFn: () => api.get('/agents/roster'),
    refetchInterval: 30_000,
  });
}

export function useAgentSkillCatalog() {
  return useQuery<AgentSkillDefinition[]>({
    queryKey: ['agents', 'skills', 'catalog'],
    queryFn: () => api.get('/agents/skills/catalog'),
    staleTime: 60 * 60 * 1000,
  });
}

export function useAgentModelCatalog() {
  return useQuery<AgentModelCatalog>({
    queryKey: ['agents', 'models'],
    queryFn: () => api.get('/agents/models'),
    staleTime: 5 * 60 * 1000,
  });
}

export function useAgentModels(type: AgentType) {
  return useQuery<AgentModelOption[]>({
    queryKey: ['agents', 'models', type],
    queryFn: () => api.get(`/agents/models/${type}`),
    staleTime: 5 * 60 * 1000,
  });
}

export function useUpdateAgentConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...config }: { id: string } & Record<string, unknown>) =>
      api.patch<Agent>(`/agents/${id}/config`, config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.agents });
      qc.invalidateQueries({ queryKey: ['agents', 'roster'] });
      qc.invalidateQueries({ queryKey: ['agents', 'credits'] });
    },
  });
}

/** Update adapter type, name, and/or config (e.g. switch copilot → grok). */
export function useUpdateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      type,
      name,
      model,
      config,
    }: {
      id: string;
      type?: AgentType;
      name?: string;
      model?: string;
      config?: Record<string, unknown>;
    }) => api.patch<Agent>(`/agents/${id}`, { type, name, model, config }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.agents });
      qc.invalidateQueries({ queryKey: ['agents', 'roster'] });
      qc.invalidateQueries({ queryKey: ['agents', 'credits'] });
      qc.invalidateQueries({ queryKey: queryKeys.capabilities });
    },
  });
}

export function useHireAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      name: string;
      type: AgentType;
      role: AgentRole;
      displayTitle?: string;
      customRoleLabel?: string;
      profileDescription?: string;
      skills?: string[];
      timezone?: string;
      workingHours?: WorkingHoursBlock[];
      notes?: string;
      config?: Record<string, unknown>;
    }) => api.post<RosterAgent>('/agents/hire', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.agents });
      qc.invalidateQueries({ queryKey: ['agents', 'roster'] });
      qc.invalidateQueries({ queryKey: queryKeys.capabilities });
    },
  });
}

export function useUpdateEmployment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; employmentStatus?: string; workingHours?: WorkingHoursBlock[]; timezone?: string; role?: AgentRole }) =>
      api.patch(`/agents/${id}/employment`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents', 'roster'] });
    },
  });
}

export function useSprintTeam(sprintId: string | undefined) {
  return useQuery<SprintTeamView>({
    queryKey: ['work-items', 'sprints', sprintId ?? '', 'team'],
    queryFn: () => api.get(`/work-items/sprints/${sprintId}/team`),
    enabled: !!sprintId,
  });
}

export function useSetSprintTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      sprintId,
      members,
      allowConflicts,
    }: {
      sprintId: string;
      members: Array<{ agentId: string; role: AgentRole; priority?: number }>;
      allowConflicts?: boolean;
    }) => api.put<SprintTeamView>(`/work-items/sprints/${sprintId}/team`, { members, allowConflicts }),
    onSuccess: (_d, { sprintId }) => {
      qc.invalidateQueries({ queryKey: ['work-items', 'sprints', sprintId, 'team'] });
      qc.invalidateQueries({ queryKey: ['agents', 'roster'] });
    },
  });
}

export function useSprintAutomation(sprintId: string | undefined) {
  return useQuery<SprintAutomationStatus>({
    queryKey: ['work-items', 'sprints', sprintId ?? '', 'automation'],
    queryFn: () => api.get(`/work-items/sprints/${sprintId}/automation/status`),
    enabled: !!sprintId,
    refetchInterval: 30_000,
  });
}

export function useSetSprintAutomation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sprintId, mode }: { sprintId: string; mode: SprintAutomationMode }) =>
      api.put(`/work-items/sprints/${sprintId}/automation`, { mode }),
    onSuccess: (_d, { sprintId }) => {
      qc.invalidateQueries({ queryKey: ['work-items', 'sprints', sprintId, 'automation'] });
      qc.invalidateQueries({ queryKey: ['work-items', 'sprints', sprintId, 'team'] });
    },
  });
}

export function useToggleAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enable }: { id: string; enable: boolean }) =>
      api.post<Agent>(`/agents/${id}/${enable ? 'enable' : 'disable'}`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.agents }),
  });
}

export function useCapabilities() {
  return useQuery<Capability[]>({ queryKey: queryKeys.capabilities, queryFn: () => api.get('/capabilities') });
}

export function useWorkflows() {
  return useQuery<Workflow[]>({ queryKey: queryKeys.workflows, queryFn: () => api.get('/workflows') });
}

export function useCreateWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; definition: WorkflowDefinition; workspaceId?: string }) =>
      api.post<Workflow>('/workflows', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.workflows }),
  });
}

export function useExecuteWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, filePaths, basePath }: { id: string; filePaths?: string[]; basePath?: string }) =>
      api.post<WorkflowExecution>(`/workflows/${id}/execute`, { filePaths, basePath }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.workflows });
      qc.invalidateQueries({ queryKey: queryKeys.executions(vars.id) });
    },
  });
}

export function useExecutions(workflowId: string) {
  return useQuery<WorkflowExecution[]>({
    queryKey: queryKeys.executions(workflowId),
    queryFn: () => api.get(`/workflows/${workflowId}/executions`),
    enabled: !!workflowId,
    refetchInterval: 5_000,
  });
}

export function useAuditLog() {
  return useQuery<AuditEntry[]>({ queryKey: queryKeys.audit, queryFn: () => api.get('/audit?limit=100') });
}

export function useAuditEntry(id: string | null) {
  return useQuery<AuditEntry>({
    queryKey: [...queryKeys.audit, id],
    queryFn: () => api.get(`/audit/${id}`),
    enabled: !!id,
  });
}

export function useAuditStats() {
  return useQuery<AuditStats>({ queryKey: queryKeys.auditStats, queryFn: () => api.get('/audit/stats'), refetchInterval: 15_000 });
}

export function useLogEvents(filters: LogEventQuery) {
  return useInfiniteQuery({
    queryKey: queryKeys.logs(filters),
    queryFn: ({ pageParam = 0 }) =>
      api.get<LogEventListResponse>(
        `/logs${buildLogEventsQuery({ ...filters, limit: LOG_PAGE_SIZE, offset: pageParam })}`
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const next = lastPage.offset + lastPage.items.length;
      return next < lastPage.total ? next : undefined;
    },
  });
}

export function useApprovals() {
  return useQuery<ApprovalRequest[]>({ queryKey: queryKeys.approvals, queryFn: () => api.get('/approval') });
}

export function useApproveRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<ApprovalRequest>(`/approval/${id}/approve`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.approvals }),
  });
}

export function useRejectRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<ApprovalRequest>(`/approval/${id}/reject`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.approvals }),
  });
}

export function usePolicies() {
  return useQuery<PrivacyPolicy[]>({ queryKey: queryKeys.policies, queryFn: () => api.get('/privacy/policies') });
}

export function useSupervisorStatus() {
  return useQuery<SupervisorStatus>({
    queryKey: queryKeys.supervisor,
    queryFn: () => api.get('/supervisor/status'),
    refetchInterval: 10_000,
  });
}

function boardHasBusyItems(board?: WorkBoard): boolean {
  if (!board) return false;
  return Object.values(board.columns).some((col) =>
    col.some((item) => item.status === 'in_progress' || item.loopStatus === 'running')
  );
}

export function useBoard(sprintId?: string) {
  const qs = sprintId ? `?sprintId=${sprintId}` : '';
  return useQuery<WorkBoard>({
    queryKey: queryKeys.board(sprintId),
    queryFn: () => api.get(`/work-items/board${qs}`),
    refetchInterval: (query) => (boardHasBusyItems(query.state.data) ? 2000 : 10_000),
  });
}

export function useSprints() {
  return useQuery<Sprint[]>({ queryKey: queryKeys.sprints, queryFn: () => api.get('/work-items/sprints') });
}

export function useCreateSprint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      name: string;
      goal?: string;
      workspaceId?: string;
      status?: Sprint['status'];
      startDate?: string;
      endDate?: string;
    }) => api.post<Sprint>('/work-items/sprints', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.sprints });
      qc.invalidateQueries({ queryKey: ['work-items'] });
    },
  });
}

export function useUpdateSprint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      name?: string;
      goal?: string | null;
      workspaceId?: string | null;
      status?: Sprint['status'];
      startDate?: string | null;
      endDate?: string | null;
    }) => api.patch<Sprint>(`/work-items/sprints/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.sprints });
      qc.invalidateQueries({ queryKey: ['work-items'] });
    },
  });
}

export function useDeleteSprint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/work-items/sprints/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.sprints });
      qc.invalidateQueries({ queryKey: ['work-items'] });
    },
  });
}

export function useWorkItemActivity(workItemId: string | null, pollWhileBusy = false) {
  return useQuery<WorkItemActivity[]>({
    queryKey: queryKeys.workItemActivity(workItemId ?? ''),
    queryFn: () => api.get(`/work-items/${workItemId}/activity`),
    enabled: !!workItemId,
    refetchInterval: pollWhileBusy ? 2000 : false,
  });
}

export function useWorkItemLoop(workItemId: string | null, pollWhileBusy = false) {
  return useQuery<WorkItemLoopHistory>({
    queryKey: queryKeys.workItemLoop(workItemId ?? ''),
    queryFn: () => api.get(`/work-items/${workItemId}/loop`),
    enabled: !!workItemId,
    refetchInterval: pollWhileBusy ? 2000 : false,
  });
}

export function useWorkItemDeliverables(workItemId: string | null, pollWhileBusy = false) {
  return useQuery<WorkItemDeliverables>({
    queryKey: queryKeys.workItemDeliverables(workItemId ?? ''),
    queryFn: () => api.get(`/work-items/${workItemId}/deliverables`),
    enabled: !!workItemId,
    refetchInterval: pollWhileBusy ? 3000 : false,
  });
}

export function useCreateWorkItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<WorkItem> & { type: WorkItemType; title: string }) =>
      api.post<WorkItem>('/work-items', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['work-items'] });
    },
  });
}

export function useUpdateWorkItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      status?: WorkItemStatus;
      title?: string;
      description?: string;
      type?: WorkItemType;
      priority?: WorkItemPriority;
      assignedAgentType?: AgentType;
      workspaceId?: string;
    }) => api.patch<WorkItem>(`/work-items/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['work-items'] });
    },
  });
}

export function useDeleteWorkItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/work-items/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['work-items'] });
    },
  });
}

export interface RunAgentOptions {
  id: string;
  async?: boolean;
}

export function useRunWorkItemAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, async: runAsync }: RunAgentOptions) =>
      api.post<
        | { item: WorkItem; result: { content: string; agentType: AgentType; auditId: string } }
        | { jobId: string; status: string; workItemId: string }
      >(`/work-items/${id}/run-agent`, { async: runAsync ?? true }),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['work-items'] });
      qc.invalidateQueries({ queryKey: queryKeys.workItemActivity(id) });
      qc.invalidateQueries({ queryKey: queryKeys.audit });
    },
  });
}

export interface PipelineStepResult {
  phase: 'implementation' | 'review';
  agentType: AgentType;
  content: string;
  auditId: string;
  filesCreated: string[];
  loopIteration: number;
}

export interface RunPipelineOptions {
  id: string;
  maxIterations?: number;
  autoLoop?: boolean;
  async?: boolean;
  /** Use mock implement→test→review loop (no paid CLIs). */
  demo?: boolean;
}

export interface LoopJob {
  id: string;
  workItemId?: string;
  status: string;
  result?: Record<string, unknown>;
  error?: string;
  loopRunId?: string;
  jobType?: string;
}

export interface RerunReviewOptions {
  id: string;
  async?: boolean;
  autoChainFix?: boolean;
}

export function useRerunWorkItemReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, async: runAsync, autoChainFix }: RerunReviewOptions) => {
      if (runAsync !== false) {
        return api.post<{ jobId: string; status: string; workItemId: string }>(
          `/work-items/${id}/rerun-review`,
          { async: true, autoChainFix }
        );
      }
      return api.post<{
        item: WorkItem;
        steps: PipelineStepResult[];
        reviewVerdict: 'approved' | 'changes_requested' | 'unknown';
        iterations: number;
        loopStatus: LoopStatus;
        evalResults?: EvalResult[];
        loopRunId?: string;
        chainedJobId?: string;
      }>(`/work-items/${id}/rerun-review`, { async: false, autoChainFix });
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['work-items'] });
      qc.invalidateQueries({ queryKey: queryKeys.workItemActivity(id) });
      qc.invalidateQueries({ queryKey: queryKeys.workItemLoop(id) });
      qc.invalidateQueries({ queryKey: queryKeys.audit });
      qc.invalidateQueries({ queryKey: queryKeys.workflows });
    },
  });
}

export function useRunWorkItemPipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, maxIterations, autoLoop, async: runAsync, demo }: RunPipelineOptions) => {
      if (runAsync) {
        return api.post<{ jobId: string; status: string; workItemId: string }>(
          `/work-items/${id}/run-pipeline`,
          { maxIterations, autoLoop, async: true, demo }
        );
      }
      return api.post<{
        item: WorkItem;
        steps: PipelineStepResult[];
        reviewVerdict: 'approved' | 'changes_requested' | 'unknown';
        iterations: number;
        loopStatus: LoopStatus;
        evalResults?: EvalResult[];
        loopRunId?: string;
      }>(`/work-items/${id}/run-pipeline`, { maxIterations, autoLoop, demo });
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['work-items'] });
      qc.invalidateQueries({ queryKey: queryKeys.workItemActivity(id) });
      qc.invalidateQueries({ queryKey: queryKeys.workItemLoop(id) });
      qc.invalidateQueries({ queryKey: queryKeys.audit });
      qc.invalidateQueries({ queryKey: queryKeys.workflows });
    },
  });
}

export interface RunLifecycleOptions {
  id: string;
  maxIterations?: number;
  autoLoop?: boolean;
  async?: boolean;
}

export interface RunLifecycleQueuedResult {
  jobId: string;
  status: string;
  workItemId: string;
  storyId?: string;
  step: 'ba' | 'pm' | 'pipeline';
  phase: string;
  message: string;
  alreadyQueued?: boolean;
}

/** BA → PM → developer pipeline (stories); tasks/bugs skip to pipeline. */
export function useRunWorkItemLifecycle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, maxIterations, autoLoop, async: runAsync }: RunLifecycleOptions) => {
      if (runAsync !== false) {
        return api.post<RunLifecycleQueuedResult>(`/work-items/${id}/run-lifecycle`, {
          maxIterations,
          autoLoop,
          async: true,
        });
      }
      return api.post<{
        storyId: string;
        phase: string;
        message: string;
        pipelineWorkItemId?: string;
        skippedSteps: string[];
        pipeline?: {
          item: WorkItem;
          steps: PipelineStepResult[];
          reviewVerdict: 'approved' | 'changes_requested' | 'unknown';
          iterations: number;
          loopStatus: LoopStatus;
          evalResults?: EvalResult[];
        };
      }>(`/work-items/${id}/run-lifecycle`, { maxIterations, autoLoop, async: false });
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['work-items'] });
      qc.invalidateQueries({ queryKey: queryKeys.workItemActivity(id) });
      qc.invalidateQueries({ queryKey: queryKeys.workItemLoop(id) });
      qc.invalidateQueries({ queryKey: queryKeys.audit });
      qc.invalidateQueries({ queryKey: queryKeys.workflows });
    },
  });
}

export function useCancelWorkItemLoop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ workItemId: string; killedProcesses: number; loopStatus: LoopStatus }>(
        `/work-items/${id}/loop/cancel`,
        {}
      ),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['work-items'] });
      qc.invalidateQueries({ queryKey: queryKeys.workItemActivity(id) });
      qc.invalidateQueries({ queryKey: queryKeys.workItemLoop(id) });
    },
  });
}

export function useLoopJob(jobId: string | null) {
  return useQuery<LoopJob>({
    queryKey: ['work-items', 'jobs', jobId ?? ''],
    queryFn: () => api.get(`/work-items/jobs/${jobId}`),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'pending' || status === 'running' ? 1500 : false;
    },
  });
}

export interface StoryQueueResult {
  queueId: string;
  workItemIds: string[];
  status: 'running' | 'completed' | 'failed';
  totals: {
    total: number;
    completed: number;
    approved: number;
    escalated: number;
    failed: number;
    skipped: number;
  };
  durationMs: number;
  results: Array<{
    item: WorkItem;
    pipeline?: { loopStatus: string };
    error?: string;
    skipped?: boolean;
    durationMs?: number;
  }>;
  mode?: 'story_queue' | 'full_lifecycle';
  bootstrapped?: boolean;
  message?: string;
  jobId?: string;
  workItemId?: string;
  storyId?: string;
  step?: 'ba' | 'pm' | 'pipeline';
  phase?: string;
  epicId?: string;
  epicKey?: string;
  seedStoryKey?: string;
}

export function useRunStoryQueue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      sprintId,
      demo,
      async: runAsync,
    }: {
      sprintId: string;
      demo?: boolean;
      async?: boolean;
    }) =>
      api.post<StoryQueueResult>(
        `/work-items/sprints/${sprintId}/run-queue`,
        { demo, maxIterations: 2, autoLoop: true, async: runAsync ?? true }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['work-items'] });
      qc.invalidateQueries({ queryKey: queryKeys.audit });
    },
  });
}

export function useStoryQueueRun(queueId: string | null) {
  return useQuery<StoryQueueResult>({
    queryKey: ['work-items', 'queue', queueId ?? ''],
    queryFn: () => api.get(`/work-items/queue/${queueId}`),
    enabled: !!queueId,
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 2000 : false),
  });
}

export function useCreatePipelineDemo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sprintId?: string) =>
      api.post<{ item: WorkItem; workflowId: string }>('/work-items/pipeline/demo', { sprintId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['work-items'] });
      qc.invalidateQueries({ queryKey: queryKeys.workflows });
    },
  });
}