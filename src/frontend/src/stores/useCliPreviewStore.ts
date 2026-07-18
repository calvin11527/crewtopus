import { create } from 'zustand';
import type { WSMessage } from '../types';
import { stripAnsi, formatCliOutputLines } from '../utils/work-item-console';

const MAX_PREVIEW_LINES = 4;
const MAX_TRACKED_ITEMS = 24;

interface CliPreviewState {
  previews: Record<string, string[]>;
  ingestMessage: (msg: WSMessage) => void;
  clearPreview: (workItemId: string) => void;
}

function trimPreview(lines: string[]): string[] {
  return lines.filter((l) => l.trim().length > 0).slice(-MAX_PREVIEW_LINES);
}

export const useCliPreviewStore = create<CliPreviewState>((set) => ({
  previews: {},

  ingestMessage: (msg) => {
    if (msg.type !== 'work_item:cli_output') return;
    const workItemId = msg.payload.workItemId;
    if (typeof workItemId !== 'string') return;

    const formatted = formatCliOutputLines(msg).map(stripAnsi);
    if (formatted.length === 0) return;

    set((state) => {
      const existing = state.previews[workItemId] ?? [];
      const merged = trimPreview([...existing, ...formatted]);
      const keys = Object.keys(state.previews);
      const next: Record<string, string[]> = { ...state.previews, [workItemId]: merged };
      if (keys.length >= MAX_TRACKED_ITEMS && !state.previews[workItemId]) {
        const oldest = keys[0];
        delete next[oldest];
      }
      return { previews: next };
    });
  },

  clearPreview: (workItemId) =>
    set((state) => {
      if (!state.previews[workItemId]) return state;
      const next = { ...state.previews };
      delete next[workItemId];
      return { previews: next };
    }),
}));