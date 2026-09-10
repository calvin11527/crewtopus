import { Bot, GitBranch, Layers, Lock, Pencil, Play, Trash2 } from 'lucide-react';
import KanbanCliPreview from '../../components/KanbanCliPreview';
import { isWorkItemBusy, workItemBusyMessage } from '../../utils/work-item-busy';
import { workItemLifecycleChip } from '../../utils/work-item-agent-history';
import { displayWorkItemTitle } from '../../utils/work-item-display';
import type { WorkItem, WorkItemStatus } from '../../types';
import { COLUMNS, LOOP_STATUS_LABEL, TYPE_COLORS, loopBadgeLabel } from './constants';

interface WorkItemCardProps {
  item: WorkItem;
  selected: boolean;
  cardHasJob: boolean;
  displayNames: Record<string, string>;
  cliPreview?: string[];
  runPending: boolean;
  onOpen: (item: WorkItem) => void;
  onRunAgent: (item: WorkItem) => void;
  onRunPipeline: (item: WorkItem) => void;
  onRunLifecycle: (item: WorkItem) => void;
  onEdit: (item: WorkItem) => void;
  onDelete: (item: WorkItem) => void;
  onMove: (item: WorkItem, toStatus: WorkItemStatus) => void;
  dragging?: boolean;
}

export default function WorkItemCard({
  item,
  selected,
  cardHasJob,
  displayNames,
  cliPreview,
  runPending,
  onOpen,
  onRunAgent,
  onRunPipeline,
  onRunLifecycle,
  onEdit,
  onDelete,
  onMove,
  dragging = false,
}: WorkItemCardProps) {
  const cardBusy = isWorkItemBusy(item, cardHasJob);
  const busyTitle = cardBusy ? workItemBusyMessage(item, cardHasJob) : undefined;
  const desc = item.description?.trim() ?? '';
  const chip = workItemLifecycleChip(item);

  return (
    <div
      id={`card-${item.key}`}
      className={`kanban-card${selected ? ' kanban-card--selected' : ''}${item.loopStatus === 'escalated' ? ' kanban-card--escalated' : ''}${item.loopStatus === 'running' ? ' kanban-card--loop-running' : ''}${cardBusy ? ' kanban-card--busy' : ''}${dragging ? ' kanban-card--dragging' : ''}`}
      draggable={!cardBusy}
      onDragStart={(e) => {
        if (cardBusy) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.setData('text/plain', `crewtopus-item:${item.id}`);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={() => onOpen(item)}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(item)}
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
          {chip ? (
            <span className={`lifecycle-chip lifecycle-chip--${chip.phase}`} title={chip.label}>
              {chip.short}
            </span>
          ) : null}
        </div>
      </div>
      <h4 className="kanban-title">{displayWorkItemTitle(item.title)}</h4>
      {desc ? <p className="kanban-desc">{desc}</p> : null}
      {cardBusy && (
        <p className="kanban-busy-hint">
          <Lock size={12} /> Agents working — run and edit locked
        </p>
      )}
      {item.loopStatus === 'running' && cliPreview?.length ? (
        <KanbanCliPreview lines={cliPreview} />
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
            onClick={() => onRunAgent(item)}
            disabled={cardBusy || runPending}
            title={busyTitle ?? 'Run single agent'}
          >
            <Play size={12} /> Run
          </button>
        )}
        {item.status !== 'done' && (
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={() => onRunPipeline(item)}
            disabled={cardBusy || runPending}
            title={busyTitle ?? 'Grok → Copilot loop until approved'}
          >
            <GitBranch size={12} />
          </button>
        )}
        {item.status !== 'done' && item.type === 'story' && (
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={() => onRunLifecycle(item)}
            disabled={cardBusy || runPending}
            title={busyTitle ?? 'Full lifecycle: BA → PM → developer pipeline (from current phase)'}
          >
            <Layers size={12} />
          </button>
        )}
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          onClick={() => onEdit(item)}
          disabled={cardBusy}
          title={busyTitle ?? 'Edit'}
        >
          <Pencil size={12} />
        </button>
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          onClick={() => onDelete(item)}
          title="Delete"
        >
          <Trash2 size={12} />
        </button>
        <select
          className="input input--sm kanban-move-select"
          value={item.status}
          onChange={(e) => onMove(item, e.target.value as WorkItemStatus)}
          aria-label={`Move ${item.key} (or drag the card)`}
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
}
