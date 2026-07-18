/** Shared TypeScript interfaces for AgentHub frontend. */

export interface ContextScope {
  files: string[];
  diffs: string[];
  symbols: string[];
  maxTokens: number;
  sensitivityLevel: number;
}

export type AgentType = 'claude' | 'grok' | 'copilot' | 'antigravity' | 'ollama' | 'mock';
export type AgentStatus = 'idle' | 'running' | 'error' | 'disabled';
export type WorkflowStatus = 'draft' | 'active' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'modified';
export type TriggerType = 'file_changed' | 'git_commit' | 'pr_created' | 'build_failed' | 'dependency_updated' | 'schedule';
export type ConsensusMode = 'majority_vote' | 'weighted_vote' | 'human_review' | 'single_authority';

export interface Workspace {
  id: string;
  name: string;
  description?: string;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Repository {
  id: string;
  workspaceId: string;
  name: string;
  path: string;
  remoteUrl?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface FsDirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isGitRepo: boolean;
}

export interface FsBrowseResult {
  path: string;
  parent: string | null;
  entries: FsDirectoryEntry[];
  isGitRepo: boolean;
  allowedRoots: string[];
}

export interface FsValidateResult {
  valid: boolean;
  path: string;
  name: string;
  isDirectory: boolean;
  isGitRepo: boolean;
  message?: string;
}

export type AgentRole =
  | 'scrum_master'
  | 'project_manager'
  | 'business_analyst'
  | 'developer'
  | 'tester'
  | 'reviewer'
  | 'custom';

export interface AgentSkillDefinition {
  id: string;
  label: string;
  description: string;
  domain: string;
  suggestedRoles: AgentRole[];
}
export type EmploymentStatus = 'active' | 'on_leave' | 'terminated';
export type SprintAutomationMode = 'autonomous' | 'paused';

export interface WorkingHoursBlock {
  dow: number[];
  start: string;
  end: string;
}

export interface AgentEmployment {
  agentId: string;
  displayTitle?: string;
  role: AgentRole;
  customRoleLabel?: string;
  profileDescription?: string;
  skills: string[];
  employmentStatus: EmploymentStatus;
  timezone: string;
  workingHours: WorkingHoursBlock[];
  hiredAt: string;
  notes?: string;
}

export interface RosterAgent extends Agent {
  employment?: AgentEmployment;
  onShift: boolean;
  sprintAssignments: Array<{ sprintId: string; sprintName: string; role: AgentRole }>;
}

export type LocalLlmTier = 'lightweight' | 'balanced' | 'quality';

export interface AgentModelOption {
  id: string;
  label: string;
  description?: string;
  isDefault?: boolean;
  installed?: boolean;
  recommended?: boolean;
  minRamGb?: number;
  tier?: LocalLlmTier;
}

export interface RecommendedLocalModel {
  id: string;
  label: string;
  description: string;
  tier: LocalLlmTier;
  useCase: 'coding' | 'general' | 'reasoning';
  minRamGb: number;
  isDefault?: boolean;
  installed: boolean;
}

export type AgentModelCatalog = Partial<Record<AgentType, AgentModelOption[]>>;

export interface Agent {
  id: string;
  name: string;
  type: AgentType;
  enabled: boolean;
  status: AgentStatus;
  config: Record<string, unknown>;
  createdAt: string;
}

export interface AgentCreditUsage {
  agentId: string;
  agentName: string;
  agentType: AgentType;
  enabled: boolean;
  creditLimit: number;
  creditsUsed: number;
  creditsRemaining: number;
  percentageUsed: number;
  unlimited: boolean;
  overBudget: boolean;
  tokenCount: number;
  requestCount: number;
  providerTokenCount?: number;
  providerSessionCount?: number;
  monthlyTokenQuota?: number;
  providerDashboardPercent?: number;
  providerCalibratedAt?: string;
  trackingSource?: 'provider' | 'agenthub_audit' | 'none';
  trackingNote?: string;
}

export interface SprintTeamMember {
  id: string;
  sprintId: string;
  agentId: string;
  role: AgentRole;
  priority: number;
  automationEnabled: boolean;
  createdAt: string;
  agentName?: string;
  agentType?: AgentType;
  onShift?: boolean;
}

export interface SprintTeamView {
  sprintId: string;
  members: SprintTeamMember[];
  conflicts: string[];
  automation: {
    sprintId: string;
    mode: SprintAutomationMode;
    lastTickAt?: string;
    pausedReason?: string | null;
    activeQueueId?: string;
  };
}

export interface SprintAutomationStatus {
  sprintId: string;
  automation: SprintTeamView['automation'];
  team: SprintTeamView;
  onShiftRoles: AgentRole[];
  queueRunning: boolean;
}

export interface Capability {
  id: string;
  agentId: string;
  name: string;
  description?: string;
}

export interface WorkflowStep {
  name: string;
  agent: AgentType;
  capability?: string;
  config?: Record<string, unknown>;
}

export type WorkflowLoopUntil = 'verdict_approved' | 'step_output_match' | 'eval_pass';
export type WorkflowLoopOnExhausted = 'escalate' | 'fail' | 'human_approval';

export type LoopEvalType = 'verdict_parse' | 'acceptance_criteria' | 'test_command' | 'file_exists' | 'custom';

export interface LoopEval {
  id: string;
  type: LoopEvalType;
  config?: Record<string, unknown>;
}

export interface EvalResult {
  evalId: string;
  type: LoopEvalType;
  passed: boolean;
  score?: number;
  details: string;
  evidence?: Record<string, unknown>;
}

export interface WorkflowLoop {
  id: string;
  steps: WorkflowStep[];
  until: WorkflowLoopUntil;
  maxIterations: number;
  onExhausted: WorkflowLoopOnExhausted;
  verdictParser?: string;
  evals?: LoopEval[];
}

export interface WorkflowDefinition {
  name: string;
  steps: WorkflowStep[];
  loops?: WorkflowLoop[];
}

export interface WorkflowLoopResult {
  loopId: string;
  iterations: number;
  loopStatus: LoopStatus;
  reviewVerdict: 'approved' | 'changes_requested' | 'unknown';
  stepCount: number;
}

export interface Workflow {
  id: string;
  workspaceId?: string;
  name: string;
  definition: WorkflowDefinition;
  status: WorkflowStatus;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  status: WorkflowStatus;
  currentStep: number;
  result?: string;
  loopResults?: WorkflowLoopResult[];
  startedAt?: string;
  completedAt?: string;
}

export interface AuditEntry {
  id: string;
  agentId?: string;
  workflowId?: string;
  task?: string;
  contextHash: string;
  files: string[];
  tokenCount: number;
  cost: number;
  approvalStatus?: ApprovalStatus;
  responseMetadata?: Record<string, unknown>;
  timestamp: string;
}

export interface AuditStats {
  totalEntries: number;
  totalTokens: number;
  totalCost: number;
  blockedCount: number;
}

export interface ApprovalRequest {
  id: string;
  workflowId?: string;
  contextScope: ContextScope;
  sensitivityLevel: number;
  status: ApprovalStatus;
  createdAt: string;
  resolvedAt?: string;
}

export interface PrivacyPolicy {
  id: string;
  workspaceId?: string;
  name: string;
  rules: Array<{ type: string; value: string | number; description?: string }>;
  createdAt: string;
}

export type WorkItemType = 'epic' | 'story' | 'task' | 'bug';
export type WorkItemStatus = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done';
export type WorkItemPriority = 'low' | 'medium' | 'high' | 'critical';
export type LoopStatus =
  | 'idle'
  | 'running'
  | 'approved'
  | 'escalated'
  | 'failed'
  | 'cancelled'
  | 'awaiting_shift';
export type SprintStatus = 'planning' | 'active' | 'completed';

export interface Sprint {
  id: string;
  workspaceId?: string;
  name: string;
  goal?: string;
  status: SprintStatus;
  startDate?: string;
  endDate?: string;
  createdAt: string;
}

export interface WorkItem {
  id: string;
  key: string;
  workspaceId?: string;
  sprintId?: string;
  parentId?: string;
  type: WorkItemType;
  title: string;
  description?: string;
  status: WorkItemStatus;
  priority: WorkItemPriority;
  storyPoints?: number;
  assignedAgentId?: string;
  assignedAgentType?: AgentType;
  workflowId?: string;
  labels: string[];
  acceptanceCriteria: string[];
  loopIteration: number;
  maxLoopIterations: number;
  loopStatus: LoopStatus;
  createdAt: string;
  updatedAt: string;
}

export interface LoopIterationRecord {
  id: string;
  iteration: number;
  verdict?: 'approved' | 'changes_requested' | 'unknown';
  implementAuditId?: string;
  reviewAuditId?: string;
  startedAt: string;
  completedAt?: string;
}

export interface WorkItemLoopHistory {
  workItemId: string;
  loopIteration: number;
  maxLoopIterations: number;
  loopStatus: LoopStatus;
  iterations: LoopIterationRecord[];
}

export interface WorkItemDeliverable {
  name: string;
  path: string;
  size: number;
  modifiedAt: string;
}

export interface WorkItemDeliverables {
  outputDir: string | null;
  files: WorkItemDeliverable[];
}

export interface WorkItemActivity {
  id: string;
  workItemId: string;
  agentId?: string;
  agentType?: AgentType;
  activityType: string;
  summary: string;
  auditId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface WorkBoard {
  sprint?: Sprint;
  columns: Record<WorkItemStatus, WorkItem[]>;
  totals: { items: number; points: number };
}

export interface SupervisorStatus {
  activeTasks: number;
  queuedTasks: number;
  lockedAgents: number;
  totalTasks: number;
}

export type WSMessageType =
  | 'agent:status'
  | 'workflow:update'
  | 'workflow:step'
  | 'audit:entry'
  | 'approval:request'
  | 'proactive:trigger'
  | 'consensus:update'
  | 'work_item:update'
  | 'work_item:activity'
  | 'work_item:pipeline_step'
  | 'work_item:loop_update'
  | 'work_item:cli_output'
  | 'loop:job'
  | 'story_queue:progress'
  | 'shift:update'
  | 'sprint_automation:status'
  | 'system:notification';

export interface WSMessage {
  type: WSMessageType;
  payload: Record<string, unknown>;
  timestamp: string;
}

export type LogSeverity = 'debug' | 'info' | 'warn' | 'error';

export interface LogEvent {
  id: string;
  agentId?: string;
  agentType?: AgentType;
  severity: LogSeverity;
  message: string;
  source?: string;
  workItemId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface LogEventQuery {
  agentId?: string;
  agentType?: AgentType;
  severity?: LogSeverity;
  text?: string;
  from?: string;
  to?: string;
  workItemId?: string;
  limit?: number;
  offset?: number;
}

export interface LogEventListResponse {
  items: LogEvent[];
  total: number;
  limit: number;
  offset: number;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
  uptime: number;
  database: boolean;
}

export interface SystemStatus {
  version: string;
  uptime: number;
  websocketClients: number;
  database: boolean;
}

export interface LiveEvent {
  id: string;
  type: WSMessageType;
  message: string;
  timestamp: string;
}