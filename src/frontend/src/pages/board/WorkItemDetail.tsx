import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRightLeft,
  Bot,
  FileText,
  GitBranch,
  Layers,
  Lock,
  Maximize2,
  Minimize2,
  Pencil,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import AgentConsole from '../../components/AgentConsole';
import StatusBadge from '../../components/StatusBadge';
import WorkItemAgentHistory from '../../components/WorkItemAgentHistory';
import type { PipelineStepResult } from '../../api/hooks';
import type { useWorkItemAgentConsole } from '../../hooks/useWorkItemAgentConsole';
import { workItemLifecycleChip } from '../../utils/work-item-agent-history';
import type { WorkItemNow } from '../../utils/derive-work-item-now';
import { displayWorkItemTitle, isOversizedTitle, titleOverflowBody } from '../../utils/work-item-display';
import type {
  AgentType,
  EvalResult,
  LoopStatus,
  WorkItem,
  WorkItemActivity,
  WorkItemDeliverables,
  WorkItemLoopHistory,
  WorkItemStatus,
  Workspace,
} from '../../types';
import {
  COLUMN_LABEL,
  COLUMNS,
  LOOP_STATUS_LABEL,
  activityContent,
  activityEvalResults,
  activityLoopIteration,
  activityWorkDir,
} from './constants';

type AgentConsoleModel = ReturnType<typeof useWorkItemAgentConsole>;
type DetailTab = 'overview' | 'run' | 'history' | 'files';

export interface PipelineResultState {
  steps: PipelineStepResult[];
  reviewVerdict: string;
  iterations: number;
  loopStatus: LoopStatus;
  evalResults?: EvalResult[];
}

export interface AgentOutputState {
  content: string;
  agentType: AgentType;
  auditId?: string;
  workDir?: string;
}

interface WorkItemDetailProps {
  boardItem: WorkItem;
  expanded: boolean;
  onToggleExpanded: () => void;
  onClose: () => void;
  detailBusy: { busy: boolean; message: string };
  onRerunReview: (item: WorkItem) => void;
  onRunLifecycle: (item: WorkItem) => void;
  onRunPipeline: (item: WorkItem) => void;
  onCancelLoop: (id: string) => void;
  onEdit: (item: WorkItem) => void;
  onMove: (item: WorkItem, toStatus: WorkItemStatus) => void;
  onDelete: (item: WorkItem) => void;
  rerunPending: boolean;
  lifecyclePending: boolean;
  pipelinePending: boolean;
  cancelPending: boolean;
  activeJobId: string | null;
  jobBanner?: string | null;
  agentConsole: AgentConsoleModel;
  consoleHeight: number;
  onConsoleHeight: (height: number) => void;
  onCommitConsoleHeight: (height: number) => void;
  activity?: WorkItemActivity[];
  loopHistory?: WorkItemLoopHistory;
  displayNames: Record<string, string>;
  deliverables?: WorkItemDeliverables;
  workspaces?: Workspace[];
  focusedProjectPath: string | null;
  pipelineResult: PipelineResultState | null;
  latestAgentResult: AgentOutputState | null;
  latestCompleted?: WorkItemActivity;
  now: WorkItemNow;
  onRetry?: (item: WorkItem) => void;
}

function OverviewSection({
  boardItem,
  workspaces,
  focusedProjectPath,
}: {
  boardItem: WorkItem;
  workspaces?: Workspace[];
  focusedProjectPath: string | null;
}) {
  return (
    <div className="board-detail-section">
      {boardItem.description?.trim() ? (
        <section className="board-detail-block">
          <h4>Description</h4>
          <div className="work-item-desc">{boardItem.description.trim()}</div>
        </section>
      ) : null}

      <dl className="board-detail-facts">
        <div>
          <dt>Type</dt>
          <dd>{boardItem.type}</dd>
        </div>
        <div>
          <dt>Priority</dt>
          <dd>{boardItem.priority}</dd>
        </div>
        <div>
          <dt>Column</dt>
          <dd>{COLUMN_LABEL[boardItem.status]}</dd>
        </div>
        {boardItem.assignedAgentType && (
          <div>
            <dt>Agent</dt>
            <dd>{boardItem.assignedAgentType}</dd>
          </div>
        )}
        {boardItem.workspaceId && (
          <div className="board-detail-facts--wide">
            <dt>Workspace</dt>
            <dd>
              {workspaces?.find((w) => w.id === boardItem.workspaceId)?.name ?? boardItem.workspaceId}
              {focusedProjectPath ? ` · ${focusedProjectPath}` : ''}
            </dd>
          </div>
        )}
      </dl>

      {boardItem.acceptanceCriteria.length > 0 && (
        <section className="board-detail-block work-item-criteria">
          <h4>Acceptance criteria</h4>
          <ul>
            {boardItem.acceptanceCriteria.map((c, index) => (
              <li key={`${index}-${c}`}>{c}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function FilesSection({
  boardItem,
  deliverables,
}: {
  boardItem: WorkItem;
  deliverables?: WorkItemDeliverables;
}) {
  const escalated = boardItem.loopStatus === 'escalated' || boardItem.loopStatus === 'failed';
  const hasFiles = (deliverables?.files.length ?? 0) > 0;

  if (!hasFiles && !escalated) {
    return <p className="text-muted board-detail-empty">No deliverable files yet.</p>;
  }

  return (
    <div className="board-detail-section">
      {boardItem.status !== 'done' && (escalated || hasFiles) && (
        <div className="deliverables-banner">
          {escalated ? (
            <p>
              <strong>Loop exhausted — harness escalated for review.</strong> Re-run review for an
              immediate harness pass, or move to Done if you accept the deliverables.
            </p>
          ) : (
            <p>
              <strong>Agent output is ready.</strong> Files are saved under the work directory (not
              applied to the repo automatically).
            </p>
          )}
        </div>
      )}

      {hasFiles && deliverables && (
        <div className="deliverables-panel">
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
    </div>
  );
}

function RunSection({
  boardItem,
  agentConsole,
  consoleHeight,
  onConsoleHeight,
  onCommitConsoleHeight,
  pipelineResult,
  latestAgentResult,
  latestCompleted,
  now,
}: {
  boardItem: WorkItem;
  agentConsole: AgentConsoleModel;
  consoleHeight: number;
  onConsoleHeight: (height: number) => void;
  onCommitConsoleHeight: (height: number) => void;
  pipelineResult: PipelineResultState | null;
  latestAgentResult: AgentOutputState | null;
  latestCompleted?: WorkItemActivity;
  now: WorkItemNow;
}) {
  return (
    <div className="board-detail-run">
      <AgentConsole
        workItemKey={boardItem.key}
        entries={agentConsole.entries}
        status={agentConsole.status}
        sessionKey={agentConsole.sessionKey}
        height={consoleHeight}
        onResizeHeight={onConsoleHeight}
        onCommitHeight={onCommitConsoleHeight}
        idleHint={agentConsole.idleHint}
        onClear={agentConsole.clearConsole}
      />

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
              {step.content ? <pre className="activity-output-preview">{step.content}</pre> : null}
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
          {now.visible && (now.jobStatus === 'pending' || now.jobStatus === 'running')
            ? `${now.title}${now.elapsedLabel ? ` · ${now.elapsedLabel}` : ''}. ${now.detail}`
            : 'No agent output yet. Start a run from the header to see live CLI output here.'}
        </p>
      ) : null}
    </div>
  );
}

export default function WorkItemDetail({
  boardItem,
  expanded,
  onToggleExpanded,
  onClose,
  detailBusy,
  onRerunReview,
  onRunLifecycle,
  onRunPipeline,
  onCancelLoop,
  onEdit,
  onMove,
  onDelete,
  rerunPending,
  lifecyclePending,
  pipelinePending,
  cancelPending,
  activeJobId,
  jobBanner,
  agentConsole,
  consoleHeight,
  onConsoleHeight,
  onCommitConsoleHeight,
  activity,
  loopHistory,
  displayNames,
  deliverables,
  workspaces,
  focusedProjectPath,
  pipelineResult,
  latestAgentResult,
  latestCompleted,
  now,
  onRetry,
}: WorkItemDetailProps) {
  const chip = workItemLifecycleChip(boardItem);
  const [tab, setTab] = useState<DetailTab>('overview');
  const userPickedTab = useRef(false);

  useEffect(() => {
    userPickedTab.current = false;
    setTab(
      now.jobStatus === 'pending' || now.jobStatus === 'running' || boardItem.loopStatus === 'running'
        ? 'run'
        : 'overview'
    );
  }, [boardItem.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (userPickedTab.current) return;
    if (now.jobStatus === 'pending' || now.jobStatus === 'running') {
      setTab('run');
    }
  }, [now.jobStatus]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        return;
      }
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

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

  const fileCount = deliverables?.files.length ?? 0;
  const needsReview = boardItem.loopStatus === 'escalated' || boardItem.loopStatus === 'failed';
  const canLifecycle = boardItem.status !== 'done' && boardItem.type === 'story';
  const canPipeline = boardItem.status !== 'done';

  return (
    <div className="board-detail-root">
      <button type="button" className="board-detail-backdrop" aria-label="Close work item" onClick={onClose} />
      <aside
        id="work-item-detail"
        className={`card work-item-detail board-detail-pane${expanded ? ' board-detail-pane--expanded' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="work-item-detail-title"
      >
        <div className="board-detail-inner">
          <header className="board-detail-chrome">
            <div className="board-detail-identity">
              <div className="board-detail-identity-row">
                <span className="kanban-key">{boardItem.key}</span>
                {boardItem.labels?.includes('sprint-bootstrap') && (
                  <span className="kanban-bootstrap-tag">sprint bootstrap</span>
                )}
              </div>
              <h3
                id="work-item-detail-title"
                className="work-item-detail-title"
                title={displayWorkItemTitle(boardItem.title, 200)}
              >
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
                {chip ? (
                  <span
                    className={`lifecycle-chip lifecycle-chip--detail lifecycle-chip--${chip.phase}`}
                    title={chip.label}
                  >
                    {chip.short} · {chip.label}
                  </span>
                ) : null}
                {boardItem.loopIteration > 0 || boardItem.loopStatus !== 'idle' ? (
                  <span
                    className={`loop-badge loop-badge--detail${boardItem.loopStatus === 'escalated' || boardItem.loopStatus === 'awaiting_approval' ? ' loop-badge--escalated' : ''}${boardItem.loopStatus === 'running' ? ' loop-badge--running' : ''}`}
                  >
                    {LOOP_STATUS_LABEL[boardItem.loopStatus]}
                    {boardItem.loopIteration > 0
                      ? ` · ${boardItem.loopIteration}/${boardItem.maxLoopIterations}`
                      : ''}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="board-detail-chrome-actions">
              {needsReview && (
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={() => onRerunReview(boardItem)}
                  disabled={detailBusy.busy || rerunPending}
                  title={detailBusy.busy ? detailBusy.message : 'Reviewer harness re-assesses deliverables'}
                >
                  <GitBranch size={14} /> Re-run review
                </button>
              )}
              {canLifecycle && (
                <button
                  type="button"
                  className={`btn btn--sm${needsReview ? ' btn--ghost' : ' btn--primary'}`}
                  onClick={() => onRunLifecycle(boardItem)}
                  disabled={detailBusy.busy || lifecyclePending || pipelinePending}
                  title={detailBusy.busy ? detailBusy.message : 'BA → PM → developer pipeline'}
                >
                  <Layers size={14} /> Full lifecycle
                </button>
              )}
              {canPipeline && !canLifecycle && (
                <button
                  type="button"
                  className={`btn btn--sm${needsReview ? ' btn--ghost' : ' btn--primary'}`}
                  onClick={() => onRunPipeline(boardItem)}
                  disabled={detailBusy.busy || pipelinePending || lifecyclePending}
                  title={detailBusy.busy ? detailBusy.message : 'Run Grok → Copilot pipeline'}
                >
                  <GitBranch size={14} /> Run pipeline
                </button>
              )}
              {boardItem.loopStatus === 'running' && (
                <button
                  id="btn-cancel-loop"
                  type="button"
                  className="btn btn--ghost btn--sm btn--danger"
                  onClick={() => onCancelLoop(boardItem.id)}
                  disabled={cancelPending}
                  title="Cancel running loop and kill CLI processes"
                >
                  <Square size={14} /> Cancel
                </button>
              )}
              <button
                type="button"
                className="btn btn--ghost btn--icon"
                title={expanded ? 'Compact inspector' : 'Widen inspector'}
                aria-pressed={expanded}
                onClick={onToggleExpanded}
              >
                {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--icon"
                onClick={onClose}
                aria-label="Close work item"
                title="Close (Esc)"
              >
                <X size={16} />
              </button>
            </div>
          </header>

          {now.visible && (
            <div
              className={`board-now-strip board-now-strip--${now.severity}`}
              role="status"
              aria-live="polite"
            >
              <span className="board-now-strip-pulse" aria-hidden />
              <div className="board-now-strip-copy">
                <strong>{now.title}</strong>
                <p>
                  {now.detail}
                  {now.elapsedLabel ? ` · ${now.elapsedLabel}` : ''}
                </p>
              </div>
              {now.cta === 'approve' && (
                <a className="btn btn--sm btn--primary" href="/privacy">
                  Approve
                </a>
              )}
              {now.cta === 'retry' && onRetry && (
                <button type="button" className="btn btn--sm btn--primary" onClick={() => onRetry(boardItem)}>
                  Retry
                </button>
              )}
              {now.cta === 'cancel' && boardItem.loopStatus === 'running' && (
                <button
                  type="button"
                  className="btn btn--sm btn--ghost btn--danger"
                  onClick={() => onCancelLoop(boardItem.id)}
                  disabled={cancelPending}
                >
                  Cancel
                </button>
              )}
            </div>
          )}

          {activeJobId && jobBanner ? <p className="board-job-banner">{jobBanner}</p> : null}

          {detailBusy.busy && (
            <div className="work-item-busy-banner" role="status">
              <Lock size={16} />
              <div>
                <strong>Item locked while agents are working</strong>
                <p>{detailBusy.message}</p>
              </div>
            </div>
          )}

          <div className="board-detail-tabs" role="tablist" aria-label="Work item sections">
            {(
              [
                ['overview', 'Overview'],
                ['run', 'Run'],
                ['history', 'History'],
                ['files', `Files${fileCount ? ` (${fileCount})` : ''}`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={`board-detail-tab${tab === id ? ' board-detail-tab--active' : ''}`}
                onClick={() => {
                  userPickedTab.current = true;
                  setTab(id);
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="board-detail-body">
            {expanded ? (
              <div className="board-detail-split">
                <OverviewSection
                  boardItem={boardItem}
                  workspaces={workspaces}
                  focusedProjectPath={focusedProjectPath}
                />
                <div className="board-detail-split-main">
                  {tab === 'history' ? (
                    <HistorySection
                      boardItem={boardItem}
                      activity={activity}
                      loopHistory={loopHistory}
                      detailBusy={detailBusy}
                      displayNames={displayNames}
                      activityByIteration={activityByIteration}
                      liveWaitLabel={
                        now.visible && (now.jobStatus === 'pending' || now.jobStatus === 'running')
                          ? `${now.waitReason}${now.elapsedLabel ? ` · ${now.elapsedLabel}` : ''}`
                          : null
                      }
                    />
                  ) : tab === 'files' ? (
                    <FilesSection boardItem={boardItem} deliverables={deliverables} />
                  ) : (
                    <RunSection
                      boardItem={boardItem}
                      agentConsole={agentConsole}
                      consoleHeight={consoleHeight}
                      onConsoleHeight={onConsoleHeight}
                      onCommitConsoleHeight={onCommitConsoleHeight}
                      pipelineResult={pipelineResult}
                      latestAgentResult={latestAgentResult}
                      latestCompleted={latestCompleted}
                      now={now}
                    />
                  )}
                </div>
              </div>
            ) : (
              <>
                {tab === 'overview' && (
                  <OverviewSection
                    boardItem={boardItem}
                    workspaces={workspaces}
                    focusedProjectPath={focusedProjectPath}
                  />
                )}
                {tab === 'run' && (
                  <RunSection
                    boardItem={boardItem}
                    agentConsole={agentConsole}
                    consoleHeight={consoleHeight}
                    onConsoleHeight={onConsoleHeight}
                    onCommitConsoleHeight={onCommitConsoleHeight}
                    pipelineResult={pipelineResult}
                    latestAgentResult={latestAgentResult}
                    latestCompleted={latestCompleted}
                    now={now}
                  />
                )}
                {tab === 'history' && (
                  <HistorySection
                    boardItem={boardItem}
                    activity={activity}
                    loopHistory={loopHistory}
                    detailBusy={detailBusy}
                    displayNames={displayNames}
                    activityByIteration={activityByIteration}
                    liveWaitLabel={
                      now.visible && (now.jobStatus === 'pending' || now.jobStatus === 'running')
                        ? `${now.waitReason}${now.elapsedLabel ? ` · ${now.elapsedLabel}` : ''}`
                        : null
                    }
                  />
                )}
                {tab === 'files' && <FilesSection boardItem={boardItem} deliverables={deliverables} />}
              </>
            )}
          </div>

          <footer className="board-detail-footer">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => onEdit(boardItem)}
              disabled={detailBusy.busy}
              title={detailBusy.busy ? detailBusy.message : 'Edit work item'}
            >
              <Pencil size={14} /> Edit
            </button>
            <label className="work-item-move">
              <ArrowRightLeft size={14} />
              <select
                className="input input--sm"
                value={boardItem.status}
                aria-label={`Move ${boardItem.key}`}
                onChange={(e) => onMove(boardItem, e.target.value as WorkItemStatus)}
              >
                {COLUMNS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            {canPipeline && canLifecycle && (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => onRunPipeline(boardItem)}
                disabled={detailBusy.busy || pipelinePending || lifecyclePending}
                title={detailBusy.busy ? detailBusy.message : 'Run Grok → Copilot pipeline only'}
              >
                <GitBranch size={14} /> Pipeline only
              </button>
            )}
            <button
              type="button"
              className="btn btn--ghost btn--sm btn--danger"
              onClick={() => onDelete(boardItem)}
            >
              <Trash2 size={14} /> Delete
            </button>
          </footer>
        </div>
      </aside>
    </div>
  );
}

function HistorySection({
  boardItem,
  activity,
  loopHistory,
  detailBusy,
  displayNames,
  activityByIteration,
  liveWaitLabel,
}: {
  boardItem: WorkItem;
  activity?: WorkItemActivity[];
  loopHistory?: WorkItemLoopHistory;
  detailBusy: { busy: boolean; message: string };
  displayNames: Record<string, string>;
  activityByIteration: Array<{ iteration: number; entries: WorkItemActivity[] }>;
  liveWaitLabel?: string | null;
}) {
  return (
    <div className="board-detail-section">
      <WorkItemAgentHistory
        workItem={boardItem}
        activity={activity}
        loopHistory={loopHistory}
        isBusy={detailBusy.busy}
        agentNames={displayNames}
        liveWaitLabel={liveWaitLabel}
      />
      <details className="agent-history-raw-details">
        <summary>Raw activity log</summary>
        <div className="activity-feed">
          {activity?.length === 0 && <p className="text-muted">No activity yet.</p>}
          {activityByIteration.map(({ iteration, entries }) => (
            <div key={entries[0]?.id ?? `iteration-${iteration}`} className="activity-iteration-group">
              {iteration > 0 && <div className="activity-iteration-header">Iteration {iteration}</div>}
              {entries.map((a) => {
                const output = activityContent(a);
                const error = typeof a.metadata?.error === 'string' ? a.metadata.error : undefined;
                const workDir = activityWorkDir(a);
                return (
                  <div key={a.id} className="activity-row activity-row--stacked">
                    <div className="activity-row-main">
                      <span className="activity-type">{a.activityType}</span>
                      <span>
                        {typeof a.metadata?.pipelinePhase === 'string' && (
                          <span className="pipeline-phase">{a.metadata.pipelinePhase} · </span>
                        )}
                        {a.summary}
                      </span>
                      {a.agentType && <span className="kanban-agent">{a.agentType}</span>}
                      <time>{new Date(a.createdAt).toLocaleString()}</time>
                    </div>
                    {output && <pre className="activity-output-preview">{output}</pre>}
                    {error && <p className="activity-error">{error}</p>}
                    {activityEvalResults(a)?.map((e) => (
                      <div key={e.evalId} className={`eval-row ${e.passed ? 'eval-pass' : 'eval-fail'}`}>
                        {e.passed ? '✓' : '✗'} <strong>{e.evalId}</strong> ({e.type}): {e.details}
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
  );
}
