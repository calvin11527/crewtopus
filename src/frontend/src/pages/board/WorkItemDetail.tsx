import type { PointerEvent } from 'react';
import {
  ArrowRightLeft,
  Bot,
  FileText,
  GitBranch,
  GripVertical,
  Layers,
  Lock,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Square,
  Trash2,
} from 'lucide-react';
import AgentConsole from '../../components/AgentConsole';
import StatusBadge from '../../components/StatusBadge';
import WorkItemAgentHistory from '../../components/WorkItemAgentHistory';
import type { PipelineStepResult } from '../../api/hooks';
import type { useWorkItemAgentConsole } from '../../hooks/useWorkItemAgentConsole';
import { workItemLifecycleChip } from '../../utils/work-item-agent-history';
import { displayWorkItemTitle, isOversizedTitle, titleOverflowBody } from '../../utils/work-item-display';
import type {
  AgentType,
  AuditEntry,
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
  detailWidth: number;
  onResizePointerDown: (e: PointerEvent, width: number) => void;
  onResizePointerMove: (e: PointerEvent) => void;
  onResizePointerUp: (e: PointerEvent) => void;
  onClose: () => void;
  onSetWidth: (width: number) => void;
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
}

export default function WorkItemDetail({
  boardItem,
  detailWidth,
  onResizePointerDown,
  onResizePointerMove,
  onResizePointerUp,
  onClose,
  onSetWidth,
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
}: WorkItemDetailProps) {
  const chip = workItemLifecycleChip(boardItem);
  const activityByIteration = (() => {
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
  })();

  return (
    <>
      <button type="button" className="board-detail-backdrop" aria-label="Close work item detail" onClick={onClose} />
      <aside id="work-item-detail" className="card work-item-detail board-detail-pane" style={{ width: detailWidth }}>
        <div
          className="board-detail-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize work item detail panel"
          onPointerDown={(e) => onResizePointerDown(e, detailWidth)}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          onPointerCancel={onResizePointerUp}
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
                  onClick={() => onRerunReview(boardItem)}
                  disabled={detailBusy.busy || rerunPending}
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
                  onClick={() => onRunLifecycle(boardItem)}
                  disabled={detailBusy.busy || lifecyclePending || pipelinePending}
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
                  onClick={() => onRunPipeline(boardItem)}
                  disabled={detailBusy.busy || pipelinePending || lifecyclePending}
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
                  onClick={() => onCancelLoop(boardItem.id)}
                  disabled={cancelPending}
                  title="Cancel running loop and kill CLI processes"
                >
                  <Square size={14} /> Cancel loop
                </button>
              )}
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
                  onChange={(e) =>
                    onMove(boardItem, e.target.value as WorkItemStatus)
                  }
                >
                  {COLUMNS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn btn--ghost btn--sm btn--danger"
                onClick={() => onDelete(boardItem)}
              >
                <Trash2 size={14} /> Delete
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                title="Narrow panel"
                onClick={() => onSetWidth(380)}
              >
                <PanelRightClose size={14} />
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                title="Wide panel"
                onClick={() => onSetWidth(640)}
              >
                <PanelRightOpen size={14} />
              </button>
              <button type="button" className="btn btn--ghost" onClick={onClose}>
                Close
              </button>
            </div>
          </div>

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
                No agent output yet. Use Run (single agent) or the pipeline button (Grok → Copilot).
              </p>
            ) : null}

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
        </div>
      </aside>
    </>
  );
}
