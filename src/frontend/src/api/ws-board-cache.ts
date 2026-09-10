import type { QueryClient } from '@tanstack/react-query';
import type {
  LoopStatus,
  WorkBoard,
  WorkItem,
  WorkItemActivity,
  WorkItemStatus,
  WSMessage,
} from '../types';
import { queryKeys } from './hooks';

const BOARD_STATUSES: WorkItemStatus[] = ['backlog', 'todo', 'in_progress', 'in_review', 'done'];

function isWorkItem(value: unknown): value is WorkItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<WorkItem>;
  return typeof item.id === 'string' && typeof item.status === 'string' && typeof item.key === 'string';
}

function emptyColumns(board: WorkBoard): Record<WorkItemStatus, WorkItem[]> {
  return {
    backlog: [...(board.columns.backlog ?? [])],
    todo: [...(board.columns.todo ?? [])],
    in_progress: [...(board.columns.in_progress ?? [])],
    in_review: [...(board.columns.in_review ?? [])],
    done: [...(board.columns.done ?? [])],
  };
}

function recount(columns: Record<WorkItemStatus, WorkItem[]>): { items: number; points: number } {
  let items = 0;
  let points = 0;
  for (const status of BOARD_STATUSES) {
    for (const item of columns[status] ?? []) {
      items += 1;
      if (item.storyPoints) points += item.storyPoints;
    }
  }
  return { items, points };
}

export function upsertBoardItem(board: WorkBoard, item: WorkItem): WorkBoard {
  const sprintFilter = board.sprint?.id;
  const belongs = !sprintFilter || item.sprintId === sprintFilter;
  const columns = emptyColumns(board);
  for (const status of BOARD_STATUSES) {
    columns[status] = (columns[status] ?? []).filter((row) => row.id !== item.id);
  }
  if (belongs) {
    const col = item.status;
    columns[col] = [item, ...(columns[col] ?? []).filter((row) => row.id !== item.id)];
  }
  return { ...board, columns, totals: recount(columns) };
}

export function removeBoardItem(board: WorkBoard, itemId: string): WorkBoard {
  const columns = emptyColumns(board);
  for (const status of BOARD_STATUSES) {
    columns[status] = (columns[status] ?? []).filter((row) => row.id !== itemId);
  }
  return { ...board, columns, totals: recount(columns) };
}

export function patchBoardItemFields(
  board: WorkBoard,
  itemId: string,
  patch: Partial<WorkItem>
): WorkBoard {
  for (const status of BOARD_STATUSES) {
    const idx = (board.columns[status] ?? []).findIndex((row) => row.id === itemId);
    if (idx < 0) continue;
    const current = board.columns[status][idx]!;
    const next = { ...current, ...patch, id: current.id };
    return upsertBoardItem(board, next);
  }
  return board;
}

function patchAllBoards(qc: QueryClient, updater: (board: WorkBoard) => WorkBoard): void {
  qc.setQueriesData<WorkBoard>({ queryKey: ['work-items', 'board'] }, (board) =>
    board ? updater(board) : board
  );
}

/**
 * Apply a work-item WebSocket event to React Query caches.
 * Returns true when the message was handled without a full `work-items` invalidate.
 */
export function applyWorkItemSocketMessage(qc: QueryClient, msg: WSMessage): boolean {
  if (msg.type === 'work_item:update') {
    if (msg.payload.deleted === true && typeof msg.payload.id === 'string') {
      const id = msg.payload.id;
      patchAllBoards(qc, (board) => removeBoardItem(board, id));
      return true;
    }
    if (isWorkItem(msg.payload.item)) {
      patchAllBoards(qc, (board) => upsertBoardItem(board, msg.payload.item as WorkItem));
      return true;
    }
    if (typeof msg.payload.id === 'string') {
      const id = msg.payload.id;
      const patch: Partial<WorkItem> = {};
      if (typeof msg.payload.status === 'string') patch.status = msg.payload.status as WorkItemStatus;
      if (typeof msg.payload.title === 'string') patch.title = msg.payload.title;
      if (typeof msg.payload.loopStatus === 'string') patch.loopStatus = msg.payload.loopStatus as LoopStatus;
      if (typeof msg.payload.loopIteration === 'number') patch.loopIteration = msg.payload.loopIteration;
      patchAllBoards(qc, (board) => patchBoardItemFields(board, id, patch));
      return true;
    }
    return false;
  }

  if (msg.type === 'work_item:loop_update') {
    const workItemId = typeof msg.payload.workItemId === 'string' ? msg.payload.workItemId : null;
    if (!workItemId) return false;
    const patch: Partial<WorkItem> = {};
    if (typeof msg.payload.loopStatus === 'string') patch.loopStatus = msg.payload.loopStatus as LoopStatus;
    if (typeof msg.payload.loopIteration === 'number') patch.loopIteration = msg.payload.loopIteration;
    if (typeof msg.payload.maxLoopIterations === 'number') {
      patch.maxLoopIterations = msg.payload.maxLoopIterations;
    }
    patchAllBoards(qc, (board) => patchBoardItemFields(board, workItemId, patch));
    return true;
  }

  if (msg.type === 'work_item:activity') {
    const workItemId = typeof msg.payload.workItemId === 'string' ? msg.payload.workItemId : null;
    const activity = msg.payload.activity as WorkItemActivity | undefined;
    if (!workItemId || !activity || typeof activity.id !== 'string') return false;
    qc.setQueryData<WorkItemActivity[]>(queryKeys.workItemActivity(workItemId), (rows) => {
      if (!rows) return [activity];
      if (rows.some((row) => row.id === activity.id)) return rows;
      return [activity, ...rows];
    });
    return true;
  }

  if (msg.type === 'loop:job') {
    const jobId = typeof msg.payload.jobId === 'string' ? msg.payload.jobId : null;
    const workItemId = typeof msg.payload.workItemId === 'string' ? msg.payload.workItemId : null;
    const status = typeof msg.payload.status === 'string' ? msg.payload.status : '';
    if (jobId) {
      qc.setQueryData(['work-items', 'jobs', jobId], (current: Record<string, unknown> | undefined) => ({
        ...(current ?? {}),
        id: jobId,
        workItemId,
        status,
        error: msg.payload.error,
      }));
    }
    if (
      workItemId &&
      (status === 'completed' || status === 'failed' || status === 'cancelled')
    ) {
      qc.invalidateQueries({ queryKey: queryKeys.workItemLoop(workItemId) });
      qc.invalidateQueries({ queryKey: queryKeys.workItemDeliverables(workItemId) });
      qc.invalidateQueries({ queryKey: queryKeys.workItemActivity(workItemId) });
    }
    return true;
  }

  if (msg.type === 'work_item:pipeline_step') {
    return true;
  }

  return false;
}
