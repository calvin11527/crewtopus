/** Shared TypeScript interfaces for AgentHub backend. */

/* ─── Context & Privacy ─── */

/** Minimal context sent to agents (Module F). */
export interface ContextScope {
  files: string[];
  diffs: string[];
  symbols: string[];
  maxTokens: number;
  sensitivityLevel: number;
}

export type SensitivityLevel = 0 | 1 | 2 | 3;

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'modified';

/* ─── Workspace (Module A) ─── */

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

/* ─── Agent Registry (Module B) ─── */

export type AgentType = 'claude' | 'grok' | 'copilot' | 'antigravity' | 'ollama' | 'mock';

export type AgentStatus = 'idle' | 'running' | 'error' | 'disabled';

export type AgentRole =
  | 'scrum_master'
  | 'project_manager'
  | 'business_analyst'
  | 'developer'
  | 'tester'
  | 'reviewer'
  | 'custom';

export type EmploymentStatus = 'active' | 'on_leave' | 'terminated';

export interface WorkingHoursBlock {
  /** 0 = Sunday, 1 = Monday, … 6 = Saturday */
  dow: number[];
  start: string;
  end: string;
}

export interface AgentEmployment {
  agentId: string;
  displayTitle?: string;
  role: AgentRole;
  /** User-defined title when role is `custom`. */
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

export interface Agent {
  id: string;
  name: string;
  type: AgentType;
  enabled: boolean;
  status: AgentStatus;
  config: Record<string, unknown>;
  createdAt: string;
}

export type UsageTrackingSource = 'provider' | 'agenthub_audit' | 'none';

/** Per agent-type usage: provider signals when available, else AgentHub audit totals. */
export interface AgentCreditUsage {
  agentId: string;
  agentName: string;
  agentType: AgentType;
  enabled: boolean;
  /** Legacy internal budget (1 credit ≈ $0.01 estimated cost). */
  creditLimit: number;
  creditsUsed: number;
  creditsRemaining: number;
  /** Primary % — tokens used vs configured monthly token quota. */
  percentageUsed: number;
  unlimited: boolean;
  overBudget: boolean;
  /** Tokens recorded by AgentHub audit log (often under-counts CLI usage). */
  tokenCount: number;
  requestCount: number;
  /** Tokens from provider CLI session signals (Grok ~/.grok/sessions), when available. */
  providerTokenCount?: number;
  providerSessionCount?: number;
  /** User-configured monthly token quota (align with grok.com / provider dashboard). */
  monthlyTokenQuota?: number;
  /** Last dashboard % synced via providerUsagePercent calibration. */
  providerDashboardPercent?: number;
  /** ISO timestamp of the last providerUsagePercent calibration. */
  providerCalibratedAt?: string;
  /** Which token total drives percentageUsed. */
  trackingSource: UsageTrackingSource;
  trackingNote?: string;
}

/* ─── Capability Registry (Module C) ─── */

export interface Capability {
  id: string;
  agentId: string;
  name: string;
  description?: string;
}

/* ─── Workflow Engine (Module D) ─── */

export type WorkflowStatus = 'draft' | 'active' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface WorkflowStep {
  name: string;
  agent: AgentType;
  capability?: string;
  config?: Record<string, unknown>;
}

export type WorkflowLoopUntil = 'verdict_approved' | 'step_output_match' | 'eval_pass';
export type WorkflowLoopOnExhausted = 'escalate' | 'fail' | 'human_approval';
export type WorkflowVerdictParser = 'approved_changes_requested' | 'custom_regex' | 'json_block';
export type OnUnknownVerdict = 'escalate' | 'retry' | 'treat_as_changes_requested';

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
  verdictParser?: WorkflowVerdictParser;
  /** How to treat review output when verdict cannot be parsed. Default: treat_as_changes_requested */
  onUnknownVerdict?: OnUnknownVerdict;
  evals?: LoopEval[];
  /** Abort loop with escalation when cumulative outbound tokens exceed this budget. */
  maxTokensPerLoop?: number;
  /** Abort loop with escalation when wall-clock duration exceeds this limit (ms). */
  maxDurationMs?: number;
}

export interface WorkflowDefinition {
  name: string;
  steps: WorkflowStep[];
  loops?: WorkflowLoop[];
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

export interface WorkflowLoopResult {
  loopId: string;
  iterations: number;
  loopStatus: LoopStatus;
  reviewVerdict: 'approved' | 'changes_requested' | 'unknown';
  stepCount: number;
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

/* ─── Audit Logger (Module I) ─── */

export interface AuditEntry {
  id: string;
  agentId?: string;
  workflowId?: string;
  workItemId?: string;
  loopIteration?: number;
  pipelinePhase?: string;
  agentType?: AgentType;
  task?: string;
  contextHash: string;
  files: string[];
  tokenCount: number;
  cost: number;
  approvalStatus?: ApprovalStatus;
  responseMetadata?: Record<string, unknown>;
  timestamp: string;
}

/* ─── Approval Gate (Module H) ─── */

export interface ApprovalRequest {
  id: string;
  workflowId?: string;
  workItemId?: string;
  loopRunId?: string;
  summary?: string;
  contextScope: ContextScope;
  sensitivityLevel: SensitivityLevel;
  status: ApprovalStatus;
  createdAt: string;
  resolvedAt?: string;
}

/** Retry policy for outbound pipeline transient failures. */
export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number[];
  retryOn: Array<'timeout' | 'exit_nonzero' | 'rate_limit'>;
}

/* ─── Agile / Scrum Work Management ─── */

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

export type SprintAutomationMode = 'autonomous' | 'paused';

export type SprintAutomationPauseReason =
  | 'outside_hours'
  | 'manual'
  | 'awaiting_shift'
  | 'awaiting_ba'
  | 'awaiting_pm'
  | 'blocked_failures'
  | 'budget_exceeded'
  | null;

export interface SprintTeamMember {
  id: string;
  sprintId: string;
  agentId: string;
  role: AgentRole;
  priority: number;
  automationEnabled: boolean;
  createdAt: string;
}

export interface SprintAutomation {
  sprintId: string;
  mode: SprintAutomationMode;
  lastTickAt?: string;
  pausedReason: SprintAutomationPauseReason;
  activeQueueId?: string;
}

export interface SprintTeamView {
  sprintId: string;
  members: Array<SprintTeamMember & { agentName: string; agentType: AgentType; onShift: boolean }>;
  conflicts: string[];
  automation: SprintAutomation;
}

export const DEFAULT_MAX_LOOP_ITERATIONS = 3;
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

export interface WorkItemActivity {
  id: string;
  workItemId: string;
  agentId?: string;
  agentType?: AgentType;
  activityType: 'status_change' | 'agent_started' | 'agent_completed' | 'agent_failed' | 'comment' | 'workflow_linked';
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

/* ─── Events ─── */

export interface Event {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

/* ─── Proactive Engine (Module J) ─── */

export type TriggerType =
  | 'file_changed'
  | 'git_commit'
  | 'pr_created'
  | 'build_failed'
  | 'dependency_updated'
  | 'schedule';

export type ProactiveAction = 'execute_workflow' | 'enqueue_pipeline';

/** Configuration for proactive triggers (stored as JSON in proactive_trigger.config). */
export interface ProactiveTriggerConfig {
  /** Directory to watch (generic file_changed triggers). */
  watchPath?: string;
  /** Work item whose output dir is watched; enables auto pipeline enqueue. */
  workItemId?: string;
  /** What to do when the trigger fires. Default: execute_workflow when workflowId set. */
  action?: ProactiveAction;
  /** Debounce window for file_changed events (ms). Default 2000. */
  debounceMs?: number;
  maxIterations?: number;
  autoLoop?: boolean;
  demo?: boolean;
  cron?: string;
}

export interface ProactiveTrigger {
  id: string;
  workspaceId?: string;
  triggerType: TriggerType;
  workflowId?: string;
  config: ProactiveTriggerConfig;
  enabled: boolean;
  createdAt: string;
}

/* ─── Consensus Engine (Module K) ─── */

export type ConsensusMode = 'majority_vote' | 'weighted_vote' | 'human_review' | 'single_authority';

export type ConsensusStatus = 'open' | 'resolved' | 'escalated';

export interface ConsensusSession {
  id: string;
  workflowId?: string;
  mode: ConsensusMode;
  status: ConsensusStatus;
  question: string;
  config: Record<string, unknown>;
  decision?: string;
  decisionSource?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface ConsensusVote {
  id: string;
  sessionId: string;
  agentId?: string;
  agentType: AgentType;
  opinion: string;
  weight: number;
  createdAt: string;
}

/* ─── WebSocket ─── */

export type WSMessageType =
  | 'agent:status'
  | 'agent:fallback'
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

/* ─── Server Logs ─── */

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

export interface LogEventInput {
  id?: string;
  agentId?: string;
  agentType?: AgentType;
  severity: LogSeverity;
  message: string;
  source?: string;
  workItemId?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
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

/* ─── API ─── */

export interface ApiError {
  message: string;
  code?: string;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
  uptime: number;
  database: boolean;
}